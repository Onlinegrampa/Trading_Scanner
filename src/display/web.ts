import express from 'express';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import type { ScanResults } from '../types';
import { SCANNER_CONFIG } from '../config';
import { SchwabClient, pairFillsIntoTrades } from '../integrations/schwab';
import { readHistory, tickerFrequency, getLogRange, entriesToCsv } from '../data/scanHistory';
import {
  loadAppSettings, saveAppSettings,
  startTosWatcher, stopTosWatcher, getTosWatcherStatus,
  type ParsedTosAlert,
} from '../integrations/tosWatcher';

// ── Journal persistence ───────────────────────────────────────

const DATA_DIR     = path.join(process.cwd(), 'data');
const JOURNAL_FILE = path.join(DATA_DIR, 'journal.json');

interface JournalTrade {
  id:            string;
  timestamp:     string;
  ticker:        string;
  direction:     'LONG' | 'SHORT';
  entryPrice:    number;
  exitPrice:     number;
  shares:        number;
  setupType:     string;
  scannerSource: string;
  notes:         string;
  pnlDollar:     number;
  pnlPercent:    number;
  rMultiple?:    number | null;
  stopPrice?:    number | null;
  float?:        number | null;
  externalId?:   string | null;  // Schwab orderId or TOS import reference
}

function readJournal(): JournalTrade[] {
  try {
    if (!fs.existsSync(JOURNAL_FILE)) return [];
    return JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8')) ?? [];
  } catch { return []; }
}

function writeJournal(trades: JournalTrade[]): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(JOURNAL_FILE, JSON.stringify(trades, null, 2), 'utf8');
}

// ── Schwab singleton ──────────────────────────────────────────

const schwabClient = new SchwabClient(SchwabClient.loadConfig());
let schwabAutoSyncTimer: ReturnType<typeof setInterval> | null = null;
const schwabSyncListeners: Array<(status: string) => void> = [];

function notifySchwabStatus(status: string): void {
  for (const fn of schwabSyncListeners) { try { fn(status); } catch { /* noop */ } }
}

// ── TOS position tracker (for alert-log watcher) ──────────────
// Tracks open positions from TOS fills so we can close round trips.

interface OpenTosPosition {
  side:        'LONG' | 'SHORT';
  avgPrice:    number;
  qty:         number;
  openTime:    string;
}
const tosOpenPositions: Record<string, OpenTosPosition[]> = {};

function handleTosAlert(alert: ParsedTosAlert): void {
  console.log(`  [TOS Watcher] Fill: ${alert.side} ${alert.qty} ${alert.symbol} @ ${alert.price}`);

  const fills = [{ symbol: alert.symbol, side: alert.side, qty: alert.qty, price: alert.price, timestamp: alert.timestamp }];
  const trades = pairFillsIntoTrades(fills.concat(
    // Inject open positions as "virtual" opposing fills for pairing context
    // We handle this by using the external pairing logic per-symbol below
  ));
  // Simple approach: maintain our own open positions here
  if (!tosOpenPositions[alert.symbol]) tosOpenPositions[alert.symbol] = [];
  const pos = tosOpenPositions[alert.symbol];

  if (alert.side === 'BUY') {
    const short = pos.find(p => p.side === 'SHORT');
    if (short) {
      const closeQty = Math.min(alert.qty, short.qty);
      const pnlDollar = (short.avgPrice - alert.price) * closeQty;
      const trade: JournalTrade = {
        id:           `tos-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp:    alert.timestamp,
        ticker:       alert.symbol,
        direction:    'SHORT',
        entryPrice:   short.avgPrice,
        exitPrice:    alert.price,
        shares:       closeQty,
        setupType:    'Imported',
        scannerSource: 'TOS Watcher',
        notes:        `Auto-imported from TOS alert log`,
        pnlDollar,
        pnlPercent:   ((short.avgPrice - alert.price) / short.avgPrice) * 100,
      };
      const journal = readJournal();
      journal.push(trade);
      writeJournal(journal);
      short.qty -= closeQty;
      if (short.qty <= 0) tosOpenPositions[alert.symbol] = pos.filter(p => p !== short);
      console.log(`  [TOS Watcher] Logged SHORT trade: ${alert.symbol} P&L $${pnlDollar.toFixed(2)}`);
    } else {
      const existing = pos.find(p => p.side === 'LONG');
      if (existing) {
        const total = existing.qty + alert.qty;
        existing.avgPrice = (existing.avgPrice * existing.qty + alert.price * alert.qty) / total;
        existing.qty = total;
      } else {
        pos.push({ side: 'LONG', avgPrice: alert.price, qty: alert.qty, openTime: alert.timestamp });
      }
    }
  } else {
    const long = pos.find(p => p.side === 'LONG');
    if (long) {
      const closeQty = Math.min(alert.qty, long.qty);
      const pnlDollar = (alert.price - long.avgPrice) * closeQty;
      const trade: JournalTrade = {
        id:           `tos-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp:    alert.timestamp,
        ticker:       alert.symbol,
        direction:    'LONG',
        entryPrice:   long.avgPrice,
        exitPrice:    alert.price,
        shares:       closeQty,
        setupType:    'Imported',
        scannerSource: 'TOS Watcher',
        notes:        `Auto-imported from TOS alert log`,
        pnlDollar,
        pnlPercent:   ((alert.price - long.avgPrice) / long.avgPrice) * 100,
      };
      const journal = readJournal();
      journal.push(trade);
      writeJournal(journal);
      long.qty -= closeQty;
      if (long.qty <= 0) tosOpenPositions[alert.symbol] = pos.filter(p => p !== long);
      console.log(`  [TOS Watcher] Logged LONG trade: ${alert.symbol} P&L $${pnlDollar.toFixed(2)}`);
    } else {
      const existing = pos.find(p => p.side === 'SHORT');
      if (existing) {
        const total = existing.qty + alert.qty;
        existing.avgPrice = (existing.avgPrice * existing.qty + alert.price * alert.qty) / total;
        existing.qty = total;
      } else {
        pos.push({ side: 'SHORT', avgPrice: alert.price, qty: alert.qty, openTime: alert.timestamp });
      }
    }
  }
}

// Start TOS watcher if path is configured
const initialSettings = loadAppSettings();
if (initialSettings.tosAlertLogPath) {
  startTosWatcher(initialSettings.tosAlertLogPath, handleTosAlert);
}

// ── Schwab auto-sync helpers ──────────────────────────────────

function startSchwabAutoSync(): void {
  if (schwabAutoSyncTimer) return;
  if (!schwabClient.isConfigured) return;

  schwabAutoSyncTimer = setInterval(async () => {
    try {
      notifySchwabStatus('syncing');
      await doSchwabSync();
      notifySchwabStatus('synced');
    } catch (e) {
      console.error('[Schwab] Auto-sync error:', (e as Error).message);
      notifySchwabStatus('error');
    }
  }, 60_000);
  console.log('  [Schwab] Auto-sync enabled (every 60s)');
}

function stopSchwabAutoSync(): void {
  if (schwabAutoSyncTimer) { clearInterval(schwabAutoSyncTimer); schwabAutoSyncTimer = null; }
}

async function doSchwabSync(): Promise<{ imported: number; skipped: number }> {
  const fills = await schwabClient.getTodaysFills();
  const paired = pairFillsIntoTrades(fills);

  const existing = readJournal();
  const existingIds = new Set(existing.map(t => t.externalId).filter(Boolean));

  let imported = 0;
  let skipped  = 0;

  for (const trade of paired) {
    const extId = `schwab-${trade.entryOrderId}-${trade.exitOrderId}`;
    if (existingIds.has(extId)) { skipped++; continue; }

    const jTrade: JournalTrade = {
      id:            `schwab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp:     trade.exitTime,
      ticker:        trade.ticker,
      direction:     trade.direction,
      entryPrice:    trade.entryPrice,
      exitPrice:     trade.exitPrice,
      shares:        trade.shares,
      setupType:     'Imported',
      scannerSource: 'Schwab API',
      notes:         `Auto-synced from Schwab`,
      pnlDollar:     trade.pnlDollar,
      pnlPercent:    trade.pnlPercent,
      externalId:    extId,
    };
    existing.push(jTrade);
    existingIds.add(extId);
    imported++;
  }

  if (imported > 0) writeJournal(existing);
  return { imported, skipped };
}

// If auto-sync was enabled before restart, resume it
if (initialSettings.schwabAutoSync && schwabClient.isConfigured) {
  startSchwabAutoSync();
}

// ── Express app setup ─────────────────────────────────────────

let latestResults: ScanResults | null = null;

export function createWebServer() {
  const app = express();

  // Serve static files from public/
  app.use(
    express.static(path.join(__dirname, 'public'), { etag: false }),
  );

  // JSON API — latest scan results
  app.get('/api/scan-results', (_req, res) => {
    if (!latestResults) {
      res.status(503).json({ error: 'Scan in progress, try again shortly.' });
      return;
    }
    res.json({
      ...latestResults,
      timestamp: latestResults.timestamp.toISOString(),
      refreshIntervalSeconds: SCANNER_CONFIG.refresh.intervalSeconds,
    });
  });

  // SSE endpoint — push updates to connected browsers
  app.get('/api/stream', (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = () => {
      if (latestResults) {
        const payload = JSON.stringify({
          ...latestResults,
          timestamp: latestResults.timestamp.toISOString(),
          refreshIntervalSeconds: SCANNER_CONFIG.refresh.intervalSeconds,
        });
        res.write(`data: ${payload}\n\n`);
      }
    };

    send();
    updateListeners.push(send);

    _req.on('close', () => {
      const idx = updateListeners.indexOf(send);
      if (idx !== -1) updateListeners.splice(idx, 1);
    });
  });

  // SSE for Schwab sync status
  app.get('/api/schwab/stream', (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (status: string) => res.write(`data: ${JSON.stringify({ status })}\n\n`);
    schwabSyncListeners.push(send);
    _req.on('close', () => {
      const idx = schwabSyncListeners.indexOf(send);
      if (idx !== -1) schwabSyncListeners.splice(idx, 1);
    });
  });

  // TOS focus window
  app.get('/api/tos/:ticker', (req, res) => {
    const ticker = req.params.ticker.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 5);
    if (!ticker) { res.status(400).json({ error: 'invalid ticker' }); return; }

    const ps =
      `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; ` +
      `public class TosWin { ` +
      `[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n); ` +
      `[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); }'; ` +
      `$p = Get-Process | Where-Object { $_.ProcessName -like "*thinkorswim*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1; ` +
      `if ($p) { [void][TosWin]::ShowWindow($p.MainWindowHandle, 9); [void][TosWin]::SetForegroundWindow($p.MainWindowHandle); Write-Output 'ok' } ` +
      `else { Write-Output 'not_found' }`;

    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 6000 },
      (_err, stdout) => {
        const status = stdout?.trim() ?? 'error';
        res.json({ ok: status.includes('ok'), status });
      },
    );
  });

  // ── JSON body parser ─────────────────────────────────────────
  app.use(express.json({ limit: '512kb' }));

  // ── Journal endpoints ─────────────────────────────────────────
  app.post('/api/journal/trade', (req, res) => {
    const trade = req.body as JournalTrade;
    if (!trade?.ticker || !trade?.entryPrice) {
      res.status(400).json({ error: 'missing required fields' }); return;
    }
    const trades = readJournal();
    trades.push(trade);
    writeJournal(trades);
    res.json({ ok: true, id: trade.id });
  });

  // Batch import endpoint (used by CSV importer)
  app.post('/api/journal/import', (req, res) => {
    const incoming = req.body as JournalTrade[];
    if (!Array.isArray(incoming)) { res.status(400).json({ error: 'expected array' }); return; }

    const trades = readJournal();
    const existingIds = new Set(trades.map(t => t.id));
    let added = 0;
    for (const t of incoming) {
      if (!t?.ticker || !t?.entryPrice) continue;
      if (existingIds.has(t.id)) continue;
      trades.push(t);
      existingIds.add(t.id);
      added++;
    }
    writeJournal(trades);
    res.json({ ok: true, added });
  });

  app.get('/api/journal/trades', (req, res) => {
    let trades = readJournal();
    const { from, to } = req.query as { from?: string; to?: string };
    if (from) trades = trades.filter(t => t.timestamp >= from);
    if (to)   trades = trades.filter(t => t.timestamp <= to);
    res.json(trades);
  });

  app.delete('/api/journal/trade/:id', (req, res) => {
    const trades = readJournal().filter(t => t.id !== req.params.id);
    writeJournal(trades);
    res.json({ ok: true });
  });

  // ── Settings endpoints ────────────────────────────────────────
  app.get('/api/settings', (_req, res) => {
    const settings = loadAppSettings();
    const tosStatus = getTosWatcherStatus();
    res.json({
      tosAlertLogPath: settings.tosAlertLogPath,
      tosWatcherActive: tosStatus.active,
      tosWatcherPath:   tosStatus.path,
      schwabAutoSync:   settings.schwabAutoSync,
    });
  });

  app.post('/api/settings', (req, res) => {
    const body = req.body as { tosAlertLogPath?: string; schwabAutoSync?: boolean };
    const settings = loadAppSettings();

    if (typeof body.tosAlertLogPath === 'string') {
      settings.tosAlertLogPath = body.tosAlertLogPath;
      stopTosWatcher();
      if (body.tosAlertLogPath) startTosWatcher(body.tosAlertLogPath, handleTosAlert);
    }

    if (typeof body.schwabAutoSync === 'boolean') {
      settings.schwabAutoSync = body.schwabAutoSync;
      if (body.schwabAutoSync) startSchwabAutoSync();
      else stopSchwabAutoSync();
    }

    saveAppSettings(settings);
    res.json({ ok: true, settings });
  });

  // ── Schwab API endpoints ──────────────────────────────────────

  // Connection status
  app.get('/api/schwab/status', (_req, res) => {
    res.json({
      status:      schwabClient.connectionStatus,
      configured:  schwabClient.isConfigured,
      config:      schwabClient.getConfig(),
      autoSync:    schwabAutoSyncTimer !== null,
    });
  });

  // Save credentials (runtime update, no server restart needed)
  app.post('/api/schwab/credentials', (req, res) => {
    const { appKey, appSecret, callbackUrl, accountId } = req.body as Partial<{
      appKey: string; appSecret: string; callbackUrl: string; accountId: string;
    }>;

    if (!appKey && !appSecret && !callbackUrl && !accountId) {
      res.status(400).json({ error: 'no fields provided' }); return;
    }

    const updates: Record<string, string> = {};
    if (appKey)      updates.appKey      = appKey;
    if (appSecret)   updates.appSecret   = appSecret;
    if (callbackUrl) updates.callbackUrl = callbackUrl;
    if (accountId)   updates.accountId   = accountId;
    schwabClient.saveConfig(updates);
    res.json({ ok: true, status: schwabClient.connectionStatus });
  });

  // Disconnect / clear tokens
  app.post('/api/schwab/disconnect', (_req, res) => {
    schwabClient.clearTokens();
    stopSchwabAutoSync();
    res.json({ ok: true });
  });

  // Initiate OAuth flow
  app.get('/auth/schwab', (_req, res) => {
    if (!schwabClient.isConfigured) {
      res.status(400).send('Schwab credentials not configured. Go to Settings and enter your App Key and Secret first.');
      return;
    }
    res.redirect(schwabClient.getAuthUrl());
  });

  // OAuth callback
  app.get('/auth/schwab/callback', async (req, res) => {
    const { code, error } = req.query as { code?: string; error?: string };

    if (error) {
      res.status(400).send(`OAuth error: ${error}. <a href="/">Return to dashboard</a>`);
      return;
    }
    if (!code) {
      res.status(400).send('No code received.');
      return;
    }

    try {
      await schwabClient.exchangeCode(code);
      res.send('<html><body style="background:#0a0a0a;color:#00e676;font-family:monospace;padding:20px">' +
        '<h2>✅ Schwab Connected!</h2><p>You can close this window and return to the dashboard.</p>' +
        '<script>setTimeout(()=>window.close(),2000)</script></body></html>');
    } catch (e) {
      res.status(500).send(`Token exchange failed: ${(e as Error).message}. <a href="/">Return</a>`);
    }
  });

  // Refresh token manually
  app.post('/api/schwab/refresh-token', async (_req, res) => {
    try {
      await schwabClient.refreshAccessToken();
      res.json({ ok: true, status: schwabClient.connectionStatus });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Manual sync
  app.post('/api/schwab/sync', async (_req, res) => {
    if (!schwabClient.isConfigured) {
      res.status(400).json({ error: 'Schwab not configured' }); return;
    }
    if (schwabClient.connectionStatus !== 'connected') {
      res.status(401).json({ error: 'Not connected — please authenticate first' }); return;
    }
    try {
      notifySchwabStatus('syncing');
      const result = await doSchwabSync();
      notifySchwabStatus('synced');
      res.json({ ok: true, ...result });
    } catch (e) {
      notifySchwabStatus('error');
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── Scan History API endpoints ─────────────────────────────────
  app.get('/api/history', (req, res) => {
    const { ticker, today, from, to, limit } = req.query as Record<string, string | undefined>;
    let entries = readHistory();

    if (ticker) {
      const t = ticker.toUpperCase();
      entries = entries.filter(e => e.ticker.toUpperCase() === t);
    }
    if (today !== undefined) {
      const d = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      entries = entries.filter(e => e.timestamp.startsWith(todayStr));
    } else if (from && to) {
      entries = entries.filter(e => {
        const d = e.timestamp.slice(0, 10);
        return d >= from && d <= to;
      });
    }

    const limitNum = parseInt(limit ?? '200', 10);
    entries = entries.slice(-limitNum).reverse();
    res.json(entries);
  });

  app.get('/api/history/summary', (_req, res) => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const localDateStr = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    const today = localDateStr(new Date());
    const d = new Date();
    const dow = d.getDay();
    const monOff = dow === 0 ? 6 : dow - 1;
    d.setDate(d.getDate() - monOff);
    const weekStart = localDateStr(d);

    const freq = tickerFrequency(weekStart, today);
    const range = getLogRange();
    const todayTotal = readHistory().filter(e => e.timestamp.startsWith(today)).length;

    res.json({ freq: freq.slice(0, 50), range, todayTotal, weekStart, today });
  });

  app.get('/api/history/export', (_req, res) => {
    const csv = entriesToCsv(readHistory());
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="scan-history.csv"');
    res.send(csv);
  });

  return app;
}

const updateListeners: Array<() => void> = [];

export function pushResults(results: ScanResults): void {
  latestResults = results;
  for (const listener of updateListeners) {
    try { listener(); } catch { /* ignore closed connections */ }
  }
}

export function startWebServer(port: number): void {
  const app = createWebServer();
  const server = app.listen(port, () => {
    console.log(`  Web dashboard: http://localhost:${port}`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\n  ERROR: Port ${port} is already in use.\n` +
        `  Another scanner instance may still be running.\n` +
        `  Close it first, then restart.\n`,
      );
      process.exit(1);
    }
    throw err;
  });
}
