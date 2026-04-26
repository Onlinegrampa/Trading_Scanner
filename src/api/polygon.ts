import axios, { AxiosInstance } from 'axios';
import { SCANNER_CONFIG, EXCLUDED_MARKETS, LISTED_EXCHANGES } from '../config';
import type {
  PolygonSnapshotTicker,
  PolygonAggBar,
  PolygonTickerDetails,
  EnrichedTicker,
} from '../types';

// ── Simple in-memory cache ────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  clear(): void {
    this.store.clear();
  }
}

// ── Rate-limited request queue ────────────────────────────────

class RateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;
  private readonly maxConcurrent: number;
  private readonly minDelayMs: number;

  constructor(maxConcurrent = 8, minDelayMs = 120) {
    this.maxConcurrent = maxConcurrent;
    this.minDelayMs = minDelayMs;
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        this.running++;
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.running--;
          await this.delay(this.minDelayMs);
          this.dequeue();
        }
      };

      if (this.running < this.maxConcurrent) {
        run();
      } else {
        this.queue.push(() => run());
      }
    });
  }

  private dequeue(): void {
    const next = this.queue.shift();
    if (next) next();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ── Polygon client ────────────────────────────────────────────

export class PolygonClient {
  // Session-permanent TTL: daily candles are historical, won't change during trading day
  private static readonly SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

  private readonly http: AxiosInstance;
  private readonly floatCache = new TTLCache<number | null>();
  private readonly avgVolCache = new TTLCache<number>();
  private readonly detailsCache = new TTLCache<PolygonTickerDetails | null>();
  private readonly dailyCandleCache = new TTLCache<PolygonAggBar[]>();
  private readonly rateLimiter = new RateLimiter(
    SCANNER_CONFIG.api.maxConcurrentEnrich,
    130, // ~7-8 req/s → well within free tier after auth headers
  );
  private apiCallCount = 0;

  constructor(private readonly apiKey: string) {
    this.http = axios.create({
      baseURL: 'https://api.polygon.io',
      timeout: 15_000,
      params: { apiKey },
    });
  }

  get callCount(): number {
    return this.apiCallCount;
  }

  resetCallCount(): void {
    this.apiCallCount = 0;
  }

  // ── All tickers snapshot (1 API call) ─────────────────────

  async getAllSnapshots(): Promise<PolygonSnapshotTicker[]> {
    try {
      this.apiCallCount++;
      const res = await this.http.get<{
        status: string;
        tickers: PolygonSnapshotTicker[];
      }>('/v2/snapshot/locale/us/markets/stocks/tickers', {
        params: { apiKey: this.apiKey, include_otc: false },
      });

      return res.data.tickers ?? [];
    } catch (err) {
      console.error('[Polygon] getAllSnapshots error:', (err as Error).message);
      return [];
    }
  }

  // ── Ticker reference details (float) ─────────────────────

  async getTickerDetails(ticker: string): Promise<PolygonTickerDetails | null> {
    const cached = this.detailsCache.get(ticker);
    if (cached !== null) return cached;

    return this.rateLimiter.schedule(async () => {
      try {
        this.apiCallCount++;
        const res = await this.http.get<{ results: PolygonTickerDetails }>(
          `/v3/reference/tickers/${ticker}`,
        );
        const details = res.data.results ?? null;
        this.detailsCache.set(ticker, details, SCANNER_CONFIG.api.cacheTTLMs);
        return details;
      } catch {
        this.detailsCache.set(ticker, null, SCANNER_CONFIG.api.cacheTTLMs);
        return null;
      }
    });
  }

  // ── Float shares ──────────────────────────────────────────

  async getFloat(ticker: string): Promise<number | null> {
    const cached = this.floatCache.get(ticker);
    if (cached !== null) return cached;

    const details = await this.getTickerDetails(ticker);
    const float =
      details?.share_class_shares_outstanding ??
      details?.weighted_shares_outstanding ??
      null;

    this.floatCache.set(ticker, float, SCANNER_CONFIG.api.cacheTTLMs);
    return float;
  }

  // ── 30-day average daily volume ───────────────────────────

  async getAvgVolume(ticker: string): Promise<number | null> {
    const cached = this.avgVolCache.get(ticker);
    if (cached !== null) return cached;

    return this.rateLimiter.schedule(async () => {
      try {
        const { from, to } = this.getTradingDateRange(SCANNER_CONFIG.api.avgVolumeDays);
        this.apiCallCount++;
        const res = await this.http.get<{
          results: PolygonAggBar[];
          resultsCount: number;
        }>(`/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}`, {
          params: { adjusted: true, sort: 'desc', limit: 50 },
        });

        const bars = res.data.results ?? [];
        if (bars.length === 0) return null;

        const avg = bars.reduce((s, b) => s + b.v, 0) / bars.length;
        this.avgVolCache.set(ticker, avg, SCANNER_CONFIG.api.cacheTTLMs);
        return avg;
      } catch {
        return null;
      }
    });
  }

  // ── Daily candles (session-cached) ───────────────────────
  // Fetches up to 300 daily bars (≈1 year + buffer).
  // Result is cached for 8 hours — historical data doesn't change intraday.

  async getDailyCandles(ticker: string): Promise<PolygonAggBar[]> {
    const cached = this.dailyCandleCache.get(ticker);
    if (cached !== null) return cached;

    return this.rateLimiter.schedule(async () => {
      try {
        const to   = new Date().toISOString().split('T')[0];
        const from = new Date(Date.now() - 380 * 24 * 60 * 60 * 1000)
          .toISOString().split('T')[0];
        this.apiCallCount++;
        const res = await this.http.get<{ results: PolygonAggBar[] }>(
          `/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}`,
          { params: { adjusted: true, sort: 'asc', limit: 300 } },
        );
        const bars = res.data.results ?? [];
        this.dailyCandleCache.set(ticker, bars, PolygonClient.SESSION_TTL_MS);
        return bars;
      } catch {
        this.dailyCandleCache.set(ticker, [], PolygonClient.SESSION_TTL_MS);
        return [];
      }
    });
  }

  async batchGetDailyCandles(tickers: string[]): Promise<Map<string, PolygonAggBar[]>> {
    const map = new Map<string, PolygonAggBar[]>();
    await Promise.all(
      tickers.map(async t => { map.set(t, await this.getDailyCandles(t)); }),
    );
    return map;
  }

  // ── Intraday candles ──────────────────────────────────────

  async getIntradayCandles(
    ticker: string,
    multiplier: number,
    timespan: 'minute' | 'hour',
    limit = 200,
  ): Promise<PolygonAggBar[]> {
    return this.rateLimiter.schedule(async () => {
      try {
        const now = Date.now();
        const from = this.todayMarketOpen();
        this.apiCallCount++;
        const res = await this.http.get<{ results: PolygonAggBar[] }>(
          `/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${from}/${now}`,
          { params: { adjusted: true, sort: 'asc', limit } },
        );
        return res.data.results ?? [];
      } catch {
        return [];
      }
    });
  }

  // ── Helper: enrich top candidates ────────────────────────
  // Fetches float + avg volume in parallel, respecting concurrency limits.

  async enrichTickers(tickers: string[]): Promise<Map<string, { float: number | null; avgVolume: number | null; exchange: string | null; isOTC: boolean }>> {
    const results = new Map<string, { float: number | null; avgVolume: number | null; exchange: string | null; isOTC: boolean }>();

    await Promise.all(
      tickers.map(async ticker => {
        const [details, avgVolume] = await Promise.all([
          this.getTickerDetails(ticker),
          this.getAvgVolume(ticker),
        ]);

        const float =
          details?.share_class_shares_outstanding ??
          details?.weighted_shares_outstanding ??
          null;

        const exchange = details?.primary_exchange ?? null;
        const market = details?.market?.toLowerCase() ?? '';
        const isOTC =
          EXCLUDED_MARKETS.has(market) ||
          (exchange !== null && !LISTED_EXCHANGES.has(exchange));

        results.set(ticker, { float, avgVolume, exchange, isOTC });
      }),
    );

    return results;
  }

  // ── Date helpers ──────────────────────────────────────────

  private getTradingDateRange(days: number): { from: string; to: string } {
    const to = new Date();
    to.setDate(to.getDate() - 1); // yesterday
    const from = new Date(to);
    from.setDate(from.getDate() - Math.ceil(days * 1.5)); // buffer for weekends
    return {
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0],
    };
  }

  private todayMarketOpen(): number {
    const now = new Date();
    // Market opens at 9:30 AM ET — use UTC offset approximation
    const open = new Date(now);
    open.setUTCHours(13, 30, 0, 0); // 9:30 AM ET = 13:30 UTC (EST)
    if (open.getTime() > now.getTime()) {
      // Haven't opened yet; use previous session
      open.setDate(open.getDate() - 1);
    }
    return open.getTime();
  }
}

// ── Fast OTC pre-filter (no API call needed) ─────────────────
// Exclude tickers with dots, dashes, or plus signs (preferred, warrants, OTC).
// This is a heuristic; exchange validation happens post-enrichment.

export function isLikelyListedStock(ticker: string): boolean {
  if (/[^A-Z]/.test(ticker)) return false; // non-alpha chars
  if (ticker.length > 5) return false;      // very long ticker
  return true;
}

// ── Build EnrichedTicker from snapshot + enrichment data ─────

export function buildEnrichedTicker(
  snapshot: PolygonSnapshotTicker,
  enrichment: { float: number | null; avgVolume: number | null; exchange: string | null; isOTC: boolean },
): EnrichedTicker {
  const currentPrice =
    snapshot.lastTrade?.p ||
    snapshot.min?.c ||
    snapshot.day?.c ||
    0;

  const prevClose = snapshot.prevDay?.c ?? 0;
  const openPrice = snapshot.day?.o ?? 0;
  const highOfDay = snapshot.day?.h ?? currentPrice;
  const volume = snapshot.min?.av ?? snapshot.day?.v ?? 0;
  const vwap = snapshot.day?.vw ?? currentPrice;

  const gapPercent =
    prevClose > 0 ? ((openPrice - prevClose) / prevClose) * 100 : 0;

  const changePercent = snapshot.todaysChangePerc ?? 0;

  const changeFromOpen =
    openPrice > 0 ? ((currentPrice - openPrice) / openPrice) * 100 : 0;

  const avgVol = enrichment.avgVolume;
  const relativeVolume =
    avgVol && avgVol > 0
      ? volume / avgVol
      : snapshot.prevDay?.v > 0
      ? volume / snapshot.prevDay.v
      : 1;

  return {
    snapshot,
    ticker: snapshot.ticker,
    currentPrice,
    prevClose,
    openPrice,
    highOfDay,
    volume,
    gapPercent,
    changePercent,
    changeFromOpen,
    float: enrichment.float,
    avgVolume: enrichment.avgVolume,
    relativeVolume,
    vwap,
    aboveVWAP: currentPrice > vwap,
    exchange: enrichment.exchange,
    isOTC: enrichment.isOTC,
  };
}
