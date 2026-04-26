// ============================================================
// TOS Alert Log File Watcher
// Monitors Thinkorswim's alert log for real-time fill notifications
// ============================================================

import fs   from 'fs';
import path from 'path';

const DATA_DIR      = path.join(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// ── App settings (non-secret) ─────────────────────────────────

export interface AppSettings {
  tosAlertLogPath:  string;
  schwabAutoSync:   boolean;
}

export function loadAppSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...defaultSettings(), ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    }
  } catch { /* ignore */ }
  return defaultSettings();
}

function defaultSettings(): AppSettings {
  return {
    tosAlertLogPath: process.env.TOS_ALERT_LOG_PATH || '',
    schwabAutoSync:  false,
  };
}

export function saveAppSettings(settings: AppSettings): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

// ── Alert parsing ─────────────────────────────────────────────

export interface ParsedTosAlert {
  side:      'BUY' | 'SELL';
  symbol:    string;
  qty:       number;
  price:     number;
  timestamp: string;
  rawLine:   string;
}

/**
 * Attempts to parse a TOS alert log line into a fill event.
 * TOS alert format varies by user configuration; we try several patterns.
 *
 * Common patterns:
 *   "Filled BUY 100 AAPL @ 13.50"
 *   "Order Filled - BUY 100 AAPL @ 13.50"
 *   "AAPL BUY 100 shares at 13.50 FILLED"
 */
export function parseTosAlertLine(line: string): ParsedTosAlert | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Pattern 1: "...BUY 100 AAPL @ 13.50..."
  const p1 = trimmed.match(/\b(BUY|SELL)\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,5})\s+@\s+([\d.]+)/i);
  if (p1) return make(p1[1], p1[3], p1[2], p1[4], trimmed);

  // Pattern 2: "...AAPL BUY 100 @ 13.50..." or "...AAPL BUY 100 shares at 13.50..."
  const p2 = trimmed.match(/\b([A-Z]{1,5})\s+(BUY|SELL)\s+(\d+(?:\.\d+)?)\s+(?:shares?\s+at\s+|@\s*)([\d.]+)/i);
  if (p2) return make(p2[2], p2[1], p2[3], p2[4], trimmed);

  // Pattern 3: "Bought/Sold 100 AAPL @ 13.50"
  const p3 = trimmed.match(/\b(bought|sold)\s+(\d+)\s+([A-Z]{1,5})\s+@\s+([\d.]+)/i);
  if (p3) {
    const side = p3[1].toLowerCase() === 'bought' ? 'BUY' : 'SELL';
    return make(side, p3[3], p3[2], p3[4], trimmed);
  }

  return null;
}

function make(side: string, symbol: string, qty: string, price: string, raw: string): ParsedTosAlert {
  return {
    side:      side.toUpperCase() as 'BUY' | 'SELL',
    symbol:    symbol.toUpperCase(),
    qty:       parseFloat(qty),
    price:     parseFloat(price),
    timestamp: new Date().toISOString(),
    rawLine:   raw,
  };
}

// ── File watcher ──────────────────────────────────────────────

let activeWatcher:  fs.FSWatcher | null = null;
let watchedPath   = '';
let watchedLastSize = 0;

export function startTosWatcher(
  logPath:  string,
  onAlert:  (alert: ParsedTosAlert) => void,
): { stop: () => void; path: string; active: boolean } {
  stopTosWatcher();
  if (!logPath || !logPath.trim()) return { stop: () => {}, path: '', active: false };

  const absPath = path.resolve(logPath.trim());

  try {
    watchedLastSize = fs.existsSync(absPath) ? fs.statSync(absPath).size : 0;
    watchedPath = absPath;

    activeWatcher = fs.watch(absPath, () => {
      try {
        const stat = fs.statSync(absPath);
        if (stat.size <= watchedLastSize) return;

        const newBytes = stat.size - watchedLastSize;
        const buf = Buffer.alloc(newBytes);
        const fd = fs.openSync(absPath, 'r');
        fs.readSync(fd, buf, 0, newBytes, watchedLastSize);
        fs.closeSync(fd);
        watchedLastSize = stat.size;

        const newLines = buf.toString('utf8').split('\n').filter(l => l.trim());
        for (const line of newLines) {
          const alert = parseTosAlertLine(line);
          if (alert) onAlert(alert);
        }
      } catch { /* ignore closed/renamed file */ }
    });

    console.log(`  [TOS Watcher] Monitoring: ${absPath}`);
    return { stop: stopTosWatcher, path: absPath, active: true };
  } catch (e) {
    console.error('[TOS Watcher] Failed to start:', (e as Error).message);
    return { stop: () => {}, path: absPath, active: false };
  }
}

export function stopTosWatcher(): void {
  if (activeWatcher) { activeWatcher.close(); activeWatcher = null; }
}

export function getTosWatcherStatus(): { active: boolean; path: string } {
  return { active: activeWatcher !== null, path: watchedPath };
}
