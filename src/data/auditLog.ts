// ============================================================
// Scanner Audit Log — persists every scan hit for auditing
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import type { ScanResults } from '../types';

const LOG_FILE = path.join(__dirname, '../../data/audit-log.json');

export interface AuditEntry {
  id: string;
  scanTimestamp: string;   // ISO string when the scan ran
  ticker: string;
  scanners: string[];      // which scanners flagged this ticker
  direction: 'UP' | 'DOWN' | 'NEUTRAL' | 'TOP' | 'BOTTOM';
  gapPercent: number | null;
  changePercent: number | null;
  price: number;
  volume: number;
  float: number | null;
  qualityScore: number | null;
  rank: number | null;
}

/** Load existing audit log (returns empty array if missing/corrupt). */
function loadLog(): AuditEntry[] {
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Append entries and write back to disk. */
export function appendAuditLog(results: ScanResults): void {
  const existing = loadLog();
  const timestamp = results.timestamp.toISOString();
  const newEntries: AuditEntry[] = [];

  for (const r of results.gappersUp) {
    newEntries.push({
      id: `${Date.now()}-${r.ticker}-up`,
      scanTimestamp: timestamp,
      ticker: r.ticker,
      scanners: ['Gap Scanner'],
      direction: r.direction,
      gapPercent: r.gapPercent,
      changePercent: null,
      price: r.price,
      volume: r.volume,
      float: r.float,
      qualityScore: r.qualityScore,
      rank: r.rank,
    });
  }

  for (const r of results.gappersDown) {
    newEntries.push({
      id: `${Date.now()}-${r.ticker}-down`,
      scanTimestamp: timestamp,
      ticker: r.ticker,
      scanners: ['Gap Scanner'],
      direction: r.direction,
      gapPercent: r.gapPercent,
      changePercent: null,
      price: r.price,
      volume: r.volume,
      float: r.float,
      qualityScore: r.qualityScore,
      rank: r.rank,
    });
  }

  for (const r of results.momentum) {
    // Check if ticker already appears in this scan from gap scanner
    const idx = newEntries.findIndex(e => e.ticker === r.ticker);
    if (idx >= 0) {
      // Already captured — add momentum scanner to the array
      newEntries[idx].scanners.push('Momentum Scanner');
      newEntries[idx].changePercent = r.changePercent;
    } else {
      newEntries.push({
        id: `${Date.now()}-${r.ticker}-momo`,
        scanTimestamp: timestamp,
        ticker: r.ticker,
        scanners: ['Momentum Scanner'],
        direction: r.changePercent >= 0 ? 'UP' : 'DOWN',
        gapPercent: null,
        changePercent: r.changePercent,
        price: r.price,
        volume: r.volume,
        float: r.float,
        qualityScore: null,
        rank: null,
      });
    }
  }

  for (const r of results.reversals) {
    newEntries.push({
      id: `${Date.now()}-${r.ticker}-reversal`,
      scanTimestamp: timestamp,
      ticker: r.ticker,
      scanners: ['Reversal Scanner'],
      direction: r.direction,
      gapPercent: null,
      changePercent: r.changePercent,
      price: r.price,
      volume: 0,
      float: null,
      qualityScore: null,
      rank: null,
    });
  }

  if (newEntries.length > 0) {
    existing.push(...newEntries);
    // Keep log manageable — cap at last 5000 entries (~3 weeks at 30s refresh)
    const trimmed = existing.slice(-5000);
    fs.writeFileSync(LOG_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
  }
}
