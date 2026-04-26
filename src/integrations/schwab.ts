// ============================================================
// Schwab API Integration — OAuth 2.0 + Trade Sync
// ============================================================

import fs   from 'fs';
import path from 'path';
import axios from 'axios';

const DATA_DIR     = path.join(process.cwd(), 'data');
const TOKENS_FILE  = path.join(DATA_DIR, 'schwab-tokens.json');
const CONFIG_FILE  = path.join(DATA_DIR, 'schwab-config.json');

// ── Types ─────────────────────────────────────────────────────

export interface SchwabTokens {
  accessToken:      string;
  refreshToken:     string;
  expiresAt:        number;  // ms since epoch
  refreshExpiresAt: number;
}

export interface SchwabConfig {
  appKey:      string;
  appSecret:   string;
  callbackUrl: string;
  accountId:   string;
}

export type SchwabConnectionStatus = 'connected' | 'expired' | 'not_configured';

interface SchwabOrderLeg {
  instruction: string;   // BUY | SELL | SELL_SHORT | BUY_TO_COVER
  quantity:    number;
  instrument:  { symbol: string; assetType: string };
}

interface SchwabExecLeg {
  price:    number;
  quantity: number;
  time:     string;
}

export interface SchwabRawOrder {
  orderId:                 number;
  status:                  string;
  closeTime?:              string;
  enteredTime?:            string;
  filledQuantity:          number;
  price?:                  number;
  orderLegCollection:      SchwabOrderLeg[];
  orderActivityCollection?: Array<{ executionLegs: SchwabExecLeg[] }>;
}

export interface SchwabFill {
  orderId:   number;
  symbol:    string;
  side:      'BUY' | 'SELL';  // normalised
  qty:       number;
  price:     number;
  timestamp: string;
  assetType: string;
}

// ── Client ────────────────────────────────────────────────────

export class SchwabClient {
  private tokens: SchwabTokens | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private config: SchwabConfig;

  constructor(config: SchwabConfig) {
    this.config = config;
    this.loadTokens();
  }

  // Load config: data/schwab-config.json takes precedence over .env
  static loadConfig(): SchwabConfig {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const saved: Partial<SchwabConfig> = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        return {
          appKey:      saved.appKey      || process.env.SCHWAB_APP_KEY      || '',
          appSecret:   saved.appSecret   || process.env.SCHWAB_APP_SECRET   || '',
          callbackUrl: saved.callbackUrl || process.env.SCHWAB_CALLBACK_URL || 'https://127.0.0.1:3000/auth/schwab/callback',
          accountId:   saved.accountId   || process.env.SCHWAB_ACCOUNT_ID   || '',
        };
      }
    } catch { /* ignore */ }
    return {
      appKey:      process.env.SCHWAB_APP_KEY      || '',
      appSecret:   process.env.SCHWAB_APP_SECRET   || '',
      callbackUrl: process.env.SCHWAB_CALLBACK_URL || 'https://127.0.0.1:3000/auth/schwab/callback',
      accountId:   process.env.SCHWAB_ACCOUNT_ID   || '',
    };
  }

  saveConfig(updates: Partial<SchwabConfig>): void {
    this.config = { ...this.config, ...updates };
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
  }

  getConfig(): Omit<SchwabConfig, 'appSecret'> & { appSecretMasked: string } {
    return {
      appKey:          this.config.appKey,
      appSecretMasked: this.config.appSecret ? '••••••••' : '',
      callbackUrl:     this.config.callbackUrl,
      accountId:       this.config.accountId,
    };
  }

  get isConfigured(): boolean {
    return !!(this.config.appKey && this.config.appSecret);
  }

  get connectionStatus(): SchwabConnectionStatus {
    if (!this.isConfigured) return 'not_configured';
    if (!this.tokens)       return 'not_configured';
    if (Date.now() > this.tokens.refreshExpiresAt) return 'expired';
    return 'connected';
  }

  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id:     this.config.appKey,
      redirect_uri:  this.config.callbackUrl,
      response_type: 'code',
      scope:         'readonly',
    });
    return `https://api.schwabapi.com/v1/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string): Promise<void> {
    const creds = Buffer.from(`${this.config.appKey}:${this.config.appSecret}`).toString('base64');
    const res = await axios.post<{ access_token: string; refresh_token: string; expires_in: number }>(
      'https://api.schwabapi.com/v1/oauth/token',
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.config.callbackUrl }),
      { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    this.setTokens(res.data);
  }

  async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refreshToken) throw new Error('No refresh token');
    const creds = Buffer.from(`${this.config.appKey}:${this.config.appSecret}`).toString('base64');
    const res = await axios.post<{ access_token: string; refresh_token: string; expires_in: number }>(
      'https://api.schwabapi.com/v1/oauth/token',
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.tokens.refreshToken }),
      { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    this.setTokens(res.data);
  }

  clearTokens(): void {
    this.tokens = null;
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    if (fs.existsSync(TOKENS_FILE)) fs.unlinkSync(TOKENS_FILE);
  }

  // Fetch today's filled equity orders, return normalised fills
  async getTodaysFills(): Promise<SchwabFill[]> {
    if (!this.tokens?.accessToken || !this.config.accountId) {
      throw new Error('Schwab not connected or accountId missing');
    }
    // Auto-refresh if within 2 min of expiry
    if (Date.now() > this.tokens.expiresAt - 2 * 60 * 1000) {
      await this.refreshAccessToken();
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const res = await axios.get<SchwabRawOrder[]>(
      `https://api.schwabapi.com/trader/v1/accounts/${this.config.accountId}/orders`,
      {
        headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
        params: {
          fromEnteredTime: today.toISOString(),
          toEnteredTime:   new Date().toISOString(),
          status:          'FILLED',
        },
      },
    );

    const orders: SchwabRawOrder[] = Array.isArray(res.data) ? res.data : [];
    const fills: SchwabFill[] = [];

    for (const order of orders) {
      const leg = order.orderLegCollection?.[0];
      if (!leg || leg.instrument.assetType !== 'EQUITY') continue;

      // Normalise instruction → BUY or SELL
      const rawInstruction = (leg.instruction || '').toUpperCase();
      const side: 'BUY' | 'SELL' =
        rawInstruction === 'BUY' || rawInstruction === 'BUY_TO_COVER' ? 'BUY' : 'SELL';

      // Weighted-avg execution price from activity collection
      const execLegs = order.orderActivityCollection?.flatMap(a => a.executionLegs) ?? [];
      let price = order.price ?? 0;
      if (execLegs.length > 0) {
        const totalQty = execLegs.reduce((s, e) => s + e.quantity, 0);
        price = totalQty > 0 ? execLegs.reduce((s, e) => s + e.price * e.quantity, 0) / totalQty : price;
      }

      const timestamp = order.closeTime || execLegs[0]?.time || order.enteredTime || new Date().toISOString();

      fills.push({
        orderId:   order.orderId,
        symbol:    leg.instrument.symbol.toUpperCase(),
        side,
        qty:       order.filledQuantity || leg.quantity,
        price,
        timestamp,
        assetType: leg.instrument.assetType,
      });
    }

    // Sort by time ascending for correct FIFO pairing
    fills.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return fills;
  }

  private setTokens(data: { access_token: string; refresh_token: string; expires_in: number }): void {
    this.tokens = {
      accessToken:      data.access_token,
      refreshToken:     data.refresh_token,
      expiresAt:        Date.now() + data.expires_in * 1000,
      refreshExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    this.saveTokens();
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(async () => {
      try { await this.refreshAccessToken(); }
      catch (e) { console.error('[Schwab] Token refresh failed:', (e as Error).message); }
    }, 25 * 60 * 1000);
  }

  private loadTokens(): void {
    try {
      if (fs.existsSync(TOKENS_FILE)) {
        this.tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')) as SchwabTokens;
        if (this.tokens && Date.now() < this.tokens.expiresAt - 60_000) {
          this.scheduleRefresh();
        }
      }
    } catch { /* ignore */ }
  }

  private saveTokens(): void {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(this.tokens, null, 2), 'utf8');
  }
}

// ── FIFO trade pairing (shared with CSV import logic) ─────────
// Accepts fills from either source and pairs them into round-trip trades.

export interface PairedTrade {
  ticker:      string;
  direction:   'LONG' | 'SHORT';
  entryPrice:  number;
  exitPrice:   number;
  shares:      number;
  pnlDollar:   number;
  pnlPercent:  number;
  entryTime:   string;
  exitTime:    string;
  entryOrderId?: number;
  exitOrderId?:  number;
}

interface OpenPosition {
  side:        'LONG' | 'SHORT';
  avgPrice:    number;
  remainingQty: number;
  openTime:    string;
  orderId?:    number;
}

export function pairFillsIntoTrades(
  fills: Array<{ symbol: string; side: 'BUY' | 'SELL'; qty: number; price: number; timestamp: string; orderId?: number }>,
): PairedTrade[] {
  const positions: Record<string, OpenPosition[]> = {};
  const trades: PairedTrade[] = [];

  for (const fill of fills) {
    const { symbol, side, qty, price, timestamp, orderId } = fill;
    if (!positions[symbol]) positions[symbol] = [];
    const pos = positions[symbol];

    if (side === 'BUY') {
      const shortIdx = pos.findIndex(p => p.side === 'SHORT');
      if (shortIdx >= 0) {
        // Closing a short position
        const short = pos[shortIdx];
        const closeQty = Math.min(qty, short.remainingQty);
        trades.push({
          ticker:      symbol,
          direction:   'SHORT',
          entryPrice:  short.avgPrice,
          exitPrice:   price,
          shares:      closeQty,
          pnlDollar:   (short.avgPrice - price) * closeQty,
          pnlPercent:  ((short.avgPrice - price) / short.avgPrice) * 100,
          entryTime:   short.openTime,
          exitTime:    timestamp,
          entryOrderId: short.orderId,
          exitOrderId:  orderId,
        });
        short.remainingQty -= closeQty;
        if (short.remainingQty <= 0) pos.splice(shortIdx, 1);

        const leftover = qty - closeQty;
        if (leftover > 0) addToPosition(pos, 'LONG', price, leftover, timestamp, orderId);
      } else {
        addToPosition(pos, 'LONG', price, qty, timestamp, orderId);
      }
    } else {
      const longIdx = pos.findIndex(p => p.side === 'LONG');
      if (longIdx >= 0) {
        // Closing a long position
        const long = pos[longIdx];
        const closeQty = Math.min(qty, long.remainingQty);
        trades.push({
          ticker:      symbol,
          direction:   'LONG',
          entryPrice:  long.avgPrice,
          exitPrice:   price,
          shares:      closeQty,
          pnlDollar:   (price - long.avgPrice) * closeQty,
          pnlPercent:  ((price - long.avgPrice) / long.avgPrice) * 100,
          entryTime:   long.openTime,
          exitTime:    timestamp,
          entryOrderId: long.orderId,
          exitOrderId:  orderId,
        });
        long.remainingQty -= closeQty;
        if (long.remainingQty <= 0) pos.splice(longIdx, 1);

        const leftover = qty - closeQty;
        if (leftover > 0) addToPosition(pos, 'SHORT', price, leftover, timestamp, orderId);
      } else {
        addToPosition(pos, 'SHORT', price, qty, timestamp, orderId);
      }
    }
  }

  return trades;
}

function addToPosition(
  pos: OpenPosition[], side: 'LONG' | 'SHORT',
  price: number, qty: number, openTime: string, orderId?: number,
): void {
  const existing = pos.find(p => p.side === side);
  if (existing) {
    const total = existing.remainingQty + qty;
    existing.avgPrice = (existing.avgPrice * existing.remainingQty + price * qty) / total;
    existing.remainingQty = total;
  } else {
    pos.push({ side, avgPrice: price, remainingQty: qty, openTime, orderId });
  }
}
