// ============================================================
// Scan History — persists every scan hit with full data points
// Mirrors auditLog patterns but captures ALL scanner fields
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import type {
  ScanResults,
  GapResult,
  MomentumResult,
  ReversalResult,
  MikeLargeCapResult,
} from '../types';

const DATA_DIR = path.join(__dirname, '../../data');
const LOG_JSON = path.join(DATA_DIR, 'scan-history.json');
const LOG_CSV  = path.join(DATA_DIR, 'scan-history.csv');

// ── Unified history entry ─────────────────────────────────────

export interface ScanHistoryEntry {
  id: string;
  timestamp: string;        // "YYYY-MM-DD HH:MM:SS"
  ticker: string;
  source: string;           // "gap", "momentum", "reversal", "mike"
  direction: string;        // "UP" / "DOWN" / "NEUTRAL" / "TOP" / "BOTTOM"
  price: number;
  volume: number;
  floatShares: number | null;
  exchange: string | null;

  // Gap-specific
  gapPercent: number | null;
  changeFromOpen: number | null;
  qualityScore: number | null;
  rank: number | null;

  // Momentum-specific
  changePercent: number | null;
  distanceFromHigh: number | null;
  highOfDay: number | null;
  triggerType: string | null;

  // VWAP
  vwap: number | null;
  aboveVWAP: boolean | null;

  // Daily chart analysis (gap scanner)
  dailyGrade: string | null;
  ema200Dist: number | null;
  emaArrow: string | null;
  stockType: string | null;

  // Reversal-specific
  rsi2: number | null;
  outsideBollinger: boolean | null;
  candlePattern: string | null;

  // Mike large-cap specific
  avgVolume: number | null;
  relativeVolume: number | null;
  atrPct: number | null;
  rsvsSPY: number | null;
  convictionScore: number | null;

  // News / catalyst
  newsType: string | null;
  newsStrength: string | null;
  hasS3: boolean | null;
}

// ── Formatting utilities ──────────────────────────────────────

function formatTimestamp(date: Date): string {
  // "YYYY-MM-DD HH:MM:SS" — human-readable and Excel-friendly
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function safe(val: number | boolean | string | null | undefined, decimals = 2): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return Number.isInteger(val) ? val.toString() : val.toFixed(decimals);
  return String(val);
}

// ── Convert result objects to unified entries ─────────────────

function gapEntry(r: GapResult, ts: string): ScanHistoryEntry {
  return {
    id: `${ts}-${r.ticker}-gap`,
    timestamp: ts,
    ticker: r.ticker,
    source: 'gap',
    direction: r.direction,
    price: r.price,
    volume: r.volume,
    floatShares: r.float,
    exchange: r.exchange,
    gapPercent: r.gapPercent,
    changeFromOpen: r.changeFromOpen,
    qualityScore: r.qualityScore,
    rank: r.rank,
    changePercent: null,
    distanceFromHigh: null,
    highOfDay: null,
    triggerType: null,
    vwap: null,
    aboveVWAP: null,
    dailyGrade: r.dailyGrade ?? null,
    ema200Dist: r.ema200Dist ?? null,
    emaArrow: r.emaArrow ?? null,
    stockType: r.stockType ?? null,
    rsi2: null,
    outsideBollinger: null,
    candlePattern: null,
    avgVolume: null,
    relativeVolume: r.relativeVolume,
    atrPct: null,
    rsvsSPY: null,
    convictionScore: null,
    newsType: r.latestNews?.catalyst?.type ?? null,
    newsStrength: r.latestNews?.catalyst?.strength ?? null,
    hasS3: r.hasS3 ?? null,
  };
}

function momentumEntry(r: MomentumResult, ts: string): ScanHistoryEntry {
  return {
    id: `${ts}-${r.ticker}-momentum`,
    timestamp: ts,
    ticker: r.ticker,
    source: 'momentum',
    direction: r.changePercent >= 0 ? 'UP' : 'DOWN',
    price: r.price,
    volume: r.volume,
    floatShares: r.float,
    exchange: r.exchange,
    gapPercent: null,
    changeFromOpen: null,
    qualityScore: null,
    rank: null,
    changePercent: r.changePercent,
    distanceFromHigh: r.distanceFromHigh,
    highOfDay: r.highOfDay,
    triggerType: r.triggerType,
    vwap: r.vwap,
    aboveVWAP: r.aboveVWAP,
    dailyGrade: null,
    ema200Dist: null,
    emaArrow: null,
    stockType: null,
    rsi2: null,
    outsideBollinger: null,
    candlePattern: null,
    avgVolume: null,
    relativeVolume: r.relativeVolume,
    atrPct: null,
    rsvsSPY: null,
    convictionScore: null,
    newsType: null,
    newsStrength: null,
    hasS3: null,
  };
}

function reversalEntry(r: ReversalResult, ts: string): ScanHistoryEntry {
  return {
    id: `${ts}-${r.ticker}-reversal`,
    timestamp: ts,
    ticker: r.ticker,
    source: 'reversal',
    direction: r.direction,
    price: r.price,
    volume: 0,
    floatShares: null,
    exchange: null,
    gapPercent: null,
    changeFromOpen: null,
    qualityScore: null,
    rank: null,
    changePercent: r.changePercent,
    distanceFromHigh: null,
    highOfDay: null,
    triggerType: r.setupType,
    vwap: null,
    aboveVWAP: null,
    dailyGrade: null,
    ema200Dist: null,
    emaArrow: null,
    stockType: null,
    rsi2: r.rsi2,
    outsideBollinger: r.outsideBand,
    candlePattern: r.candlePattern,
    avgVolume: null,
    relativeVolume: null,
    atrPct: null,
    rsvsSPY: null,
    convictionScore: null,
    newsType: null,
    newsStrength: null,
    hasS3: null,
  };
}

function mikeEntry(r: MikeLargeCapResult, ts: string): ScanHistoryEntry {
  return {
    id: `${ts}-${r.ticker}-mike`,
    timestamp: ts,
    ticker: r.ticker,
    source: 'mike',
    direction: r.gapPercent >= 0 ? 'UP' : 'DOWN',
    price: r.price,
    volume: r.volume,
    floatShares: r.float,
    exchange: r.exchange,
    gapPercent: r.gapPercent,
    changeFromOpen: null,
    qualityScore: null,
    rank: null,
    changePercent: null,
    distanceFromHigh: null,
    highOfDay: null,
    triggerType: null,
    vwap: r.vwap,
    aboveVWAP: r.vwapPosition === 'ABOVE',
    dailyGrade: null,
    ema200Dist: null,
    emaArrow: null,
    stockType: null,
    rsi2: null,
    outsideBollinger: null,
    candlePattern: null,
    avgVolume: r.avgVol20d,
    relativeVolume: r.relativeVolume,
    atrPct: r.atrPct,
    rsvsSPY: r.rsvsSPY,
    convictionScore: r.convictionScore,
    newsType: null,
    newsStrength: null,
    hasS3: null,
  };
}

// ── File I/O ──────────────────────────────────────────────────

function loadLog(): ScanHistoryEntry[] {
  try {
    const raw = fs.readFileSync(LOG_JSON, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── CSV column definitions ────────────────────────────────────

const CSV_COLUMNS: (keyof ScanHistoryEntry)[] = [
  'id', 'timestamp', 'ticker', 'source', 'direction',
  'price', 'volume', 'floatShares', 'exchange',
  'gapPercent', 'changeFromOpen', 'qualityScore', 'rank',
  'changePercent', 'distanceFromHigh', 'highOfDay', 'triggerType',
  'vwap', 'aboveVWAP',
  'dailyGrade', 'ema200Dist', 'emaArrow', 'stockType',
  'rsi2', 'outsideBollinger', 'candlePattern',
  'avgVolume', 'relativeVolume', 'atrPct', 'rsvsSPY', 'convictionScore',
  'newsType', 'newsStrength', 'hasS3',
];

const CSV_HEADER = CSV_COLUMNS.join(',');

function entryToCsv(entry: ScanHistoryEntry): string {
  return CSV_COLUMNS.map(col => {
    const val = (entry as unknown as Record<string, unknown>)[col];
    if (val === null || val === undefined || val === '') {
      return '';
    }
    if (typeof val === 'string') {
      // Escape strings that might contain commas
      const escaped = val.replace(/"/g, '""');
      return `"${escaped}"`;
    }
    return String(val);
  }).join(',');
}

/** Rewrite the entire CSV file from the current JSON log + new entries. */
function syncCsvFromJson(log: ScanHistoryEntry[]): void {
  const lines = [CSV_HEADER, ...log.map(entryToCsv)];
  fs.writeFileSync(LOG_CSV, lines.join('\n') + '\n', 'utf-8');
}

// ── Public API ────────────────────────────────────────────────

/**
 * Append scan results to the history log.
 * Always appends to existing entries — never overwrites.
 * Syncs a CSV file in data/scan-history.csv for Excel import.
 */
export function appendScanHistory(results: ScanResults): void {
  const existing = loadLog();
  const ts = formatTimestamp(results.timestamp);

  const newEntries: ScanHistoryEntry[] = [];

  for (const r of results.gappersUp) newEntries.push(gapEntry(r, ts));
  for (const r of results.gappersDown) newEntries.push(gapEntry(r, ts));
  for (const r of results.momentum) newEntries.push(momentumEntry(r, ts));
  for (const r of results.reversals) newEntries.push(reversalEntry(r, ts));
  for (const r of results.mikeLargeCaps ?? []) newEntries.push(mikeEntry(r, ts));

  // Merge: if a ticker already exists in this scan's new entries from multiple scanners,
  // keep as separate entries (one per scanner source).
  const all = [...existing, ...newEntries];

  // Cap at 10000 entries (~3–4 weeks at 30s refresh)
  const capped = all.slice(-10000);

  fs.writeFileSync(LOG_JSON, JSON.stringify(capped, null, 2), 'utf-8');
  syncCsvFromJson(capped);
}

// ── Read-only helpers for CLI viewer ──────────────────────────

/** Read the most recent N entries (newest first). */
export function readRecentHistory(n = 50): ScanHistoryEntry[] {
  const log = loadLog();
  return log.slice(-n).reverse();
}

/** Read entries for today only. */
export function readTodayHistory(): ScanHistoryEntry[] {
  const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
  return loadLog().filter(e => e.timestamp.startsWith(today));
}

/** Read entries for a specific date (YYYY-MM-DD). */
export function readDateHistory(date: string): ScanHistoryEntry[] {
  return loadLog().filter(e => e.timestamp.startsWith(date));
}

/** Read entries within a date range (inclusive, YYYY-MM-DD). */
export function readRangeHistory(startDate: string, endDate: string): ScanHistoryEntry[] {
  return loadLog().filter(e => {
    const d = e.timestamp.slice(0, 10);
    return d >= startDate && d <= endDate;
  });
}

/** Read all entries for a specific ticker (case-insensitive). */
export function readTickerHistory(ticker: string): ScanHistoryEntry[] {
  const upper = ticker.toUpperCase();
  return loadLog().filter(e => e.ticker.toUpperCase() === upper);
}

/** Read entries for a ticker within a date range. */
export function readTickerRangeHistory(ticker: string, startDate: string, endDate: string): ScanHistoryEntry[] {
  const upper = ticker.toUpperCase();
  return loadLog().filter(e => {
    const d = e.timestamp.slice(0, 10);
    return e.ticker.toUpperCase() === upper && d >= startDate && d <= endDate;
  });
}

// ── Summary helpers ───────────────────────────────────────────

/** Count how many times each ticker appeared, for a given date range. */
export function tickerFrequency(startDate: string, endDate: string): { ticker: string; count: number; sources: string }[] {
  const entries = readRangeHistory(startDate, endDate);
  const freq = new Map<string, { count: number; sources: Set<string> }>();

  for (const e of entries) {
    const entry = freq.get(e.ticker) ?? { count: 0, sources: new Set<string>() };
    entry.count++;
    entry.sources.add(e.source);
    freq.set(e.ticker, entry);
  }

  return Array.from(freq.entries())
    .map(([ticker, data]) => ({
      ticker,
      count: data.count,
      sources: Array.from(data.sources).join(', '),
    }))
    .sort((a, b) => b.count - a.count);
}

/** Get the date range of the entire log. */
export function getLogRange(): { firstDate: string; lastDate: string; totalEntries: number } {
  const log = loadLog();
  if (log.length === 0) return { firstDate: 'N/A', lastDate: 'N/A', totalEntries: 0 };
  return {
    firstDate: log[0].timestamp.slice(0, 10),
    lastDate: log[log.length - 1].timestamp.slice(0, 10),
    totalEntries: log.length,
  };
}

// ── CSV export on-demand (e.g., if user wants to export a specific range) ─

export function entriesToCsv(entries: ScanHistoryEntry[]): string {
  return [CSV_HEADER, ...entries.map(entryToCsv)].join('\n') + '\n';
}

/** Read the entire log. */
export function readHistory(): ScanHistoryEntry[] {
  return loadLog();
}
