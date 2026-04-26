// ============================================================
// Scan History Viewer — CLI commands for browsing scan history
// Run with: npx ts-node src/index.ts --history [--today | --date YYYY-MM-DD | --range YYYY-MM-DD...YYYY-MM-DD | --ticker TICKER | --summary]
// ============================================================

import chalk from 'chalk';
import Table from 'cli-table3';
import * as fs from 'fs';
import * as path from 'path';
import {
  readTodayHistory,
  readDateHistory,
  readRangeHistory,
  readTickerHistory,
  readTickerRangeHistory,
  tickerFrequency,
  getLogRange,
  readHistory,
  entriesToCsv,
} from '../data/scanHistory';
import type { ScanHistoryEntry } from '../data/scanHistory';

// ── CLI argument parsing ─────────────────────────────────────

export interface HistoryOptions {
  mode: 'today' | 'date' | 'range' | 'ticker' | 'summary' | 'export' | 'stats' | 'recent';
  date?: string;
  startDate?: string;
  endDate?: string;
  ticker?: string;
  outputFile?: string;
  maxResults?: number;
}

export function parseHistoryArgs(args: string[]): HistoryOptions {
  // Remove the --history flag itself
  const filtered = args.filter(a => a !== '--history');
  const flags: Record<string, string | undefined> = {};
  let positionals: string[] = [];

  for (let i = 0; i < filtered.length; i++) {
    const arg = filtered[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < filtered.length && !filtered[i + 1].startsWith('--')) {
        flags[key] = filtered[++i];
      }
    } else {
      positionals.push(arg);
    }
  }

  if (flags.today !== undefined) return { mode: 'today' };
  if (flags.date) return { mode: 'date', date: flags.date };
  if (flags.range) {
    const parts = flags.range.split('...');
    if (parts.length !== 2) {
      console.error(chalk.red('  Invalid range. Expected: --range YYYY-MM-DD...YYYY-MM-DD'));
      process.exit(1);
    }
    return { mode: 'range', startDate: parts[0], endDate: parts[1] };
  }
  if (flags.ticker) return { mode: 'ticker', ticker: flags.ticker, startDate: flags.from, endDate: flags.to };
  if (flags.summary) return { mode: 'summary' };
  if (flags.export) {
    return { mode: 'export', outputFile: flags.output ?? 'scan-history-export.csv' };
  }
  if (flags.stats) return { mode: 'stats' };
  if (flags.recent) {
    const limit = parseInt(flags.recent, 10) || 50;
    return { mode: 'recent', maxResults: limit };
  }

  // Default: show recent
  return { mode: 'recent', maxResults: 50 };
}

// ── Table formatting ─────────────────────────────────────────

function historyTable(entries: ScanHistoryEntry[]): void {
  if (entries.length === 0) {
    console.log(chalk.yellow('\n  No scan history entries found.\n'));
    return;
  }

  const table = new Table({
    head: [
      chalk.bold('Time'),
      chalk.bold('Ticker'),
      chalk.bold('Source'),
      chalk.bold('Price'),
      chalk.bold('Chg%'),
      chalk.bold('Gap%'),
      chalk.bold('Volume'),
      chalk.bold('Float'),
      chalk.bold('Dir'),
      chalk.bold('Details'),
    ],
    style: { head: [], border: ['dim'] },
    colWidths: [20, 8, 12, 9, 9, 9, 10, 10, 7, 30],
    colAligns: ['left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'center', 'left'],
  });

  for (const e of entries) {
    const chgPct = e.changePercent != null
      ? (e.changePercent >= 0 ? chalk.green(`+${e.changePercent.toFixed(2)}%`) : chalk.red(`${e.changePercent.toFixed(2)}%`))
      : chalk.dim('—');

    const gapPct = e.gapPercent != null
      ? (e.gapPercent >= 0 ? chalk.green(`+${e.gapPercent.toFixed(2)}%`) : chalk.red(`${e.gapPercent.toFixed(2)}%`))
      : chalk.dim('—');

    const vol = e.volume >= 1_000_000
      ? `${(e.volume / 1_000_000).toFixed(1)}M`
      : e.volume >= 1_000
        ? `${(e.volume / 1_000).toFixed(0)}K`
        : e.volume > 0 ? e.volume.toString() : '—';

    const fl = e.floatShares != null
      ? e.floatShares >= 1_000_000
        ? `${(e.floatShares / 1_000_000).toFixed(1)}M`
        : `${(e.floatShares / 1_000).toFixed(0)}K`
      : '—';

    const details = buildDetails(e);

    table.push([
      e.timestamp,
      chalk.bold.white(e.ticker),
      chalk.dim(e.source),
      `$${e.price.toFixed(2)}`,
      chgPct,
      gapPct,
      vol,
      fl,
      e.direction,
      details,
    ]);
  }

  console.log(table.toString());
  console.log(chalk.dim(`  Total entries: ${entries.length}\n`));
}

function buildDetails(e: ScanHistoryEntry): string {
  const parts: string[] = [];

  if (e.source === 'gap') {
    if (e.qualityScore != null) parts.push(`Score: ${e.qualityScore}`);
    if (e.rank != null) parts.push(`Rank: #${e.rank}`);
    if (e.dailyGrade) parts.push(`Grade: ${e.dailyGrade}`);
    if (e.newsType) parts.push(`News: ${e.newsType}`);
  } else if (e.source === 'momentum') {
    if (e.triggerType) parts.push(e.triggerType.replace('_', ' '));
    if (e.distanceFromHigh != null) parts.push(`-${e.distanceFromHigh.toFixed(1)}% from high`);
    if (e.aboveVWAP) parts.push('Above VWAP');
  } else if (e.source === 'reversal') {
    if (e.rsi2 != null) parts.push(`RSI: ${e.rsi2.toFixed(1)}`);
    if (e.candlePattern) parts.push(e.candlePattern);
    if (e.outsideBollinger) parts.push('Outside BB');
  } else if (e.source === 'mike') {
    if (e.rsvsSPY != null) parts.push(`RS vs SPY: ${e.rsvsSPY.toFixed(2)}`);
    if (e.convictionScore != null) parts.push(`Conviction: ${e.convictionScore}`);
  }

  return parts.length > 0 ? parts.join(' | ') : chalk.dim('—');
}

// ── Summary view ─────────────────────────────────────────────

function summaryTable(startDate: string, endDate: string): void {
  const freq = tickerFrequency(startDate, endDate);

  if (freq.length === 0) {
    console.log(chalk.yellow(`\n  No scan history entries from ${startDate} to ${endDate}.\n`));
    return;
  }

  const totalScans = freq.reduce((sum, f) => sum + f.count, 0);
  const uniqueTickers = freq.length;

  console.log(chalk.bold.hex('#ff8c00')(
    `\n  SCAN HISTORY SUMMARY: ${startDate} → ${endDate}`,
  ));
  console.log(chalk.dim(
    `  ${uniqueTickers} unique tickers | ${totalScans} total hits\n`,
  ));

  const table = new Table({
    head: [
      chalk.bold('#'),
      chalk.bold('Ticker'),
      chalk.bold('Hits'),
      chalk.bold('Sources'),
    ],
    style: { head: [], border: ['dim'] },
    colWidths: [4, 8, 8, 30],
    colAligns: ['right', 'left', 'center', 'left'],
  });

  for (let i = 0; i < Math.min(freq.length, 50); i++) {
    const f = freq[i];
    const hitColor = f.count >= 10
      ? chalk.bold.redBright.bind(chalk)
      : f.count >= 5
        ? chalk.yellow.bind(chalk)
        : chalk.white;
    table.push([
      i + 1,
      chalk.bold.white(f.ticker),
      hitColor(f.count.toString()),
      chalk.dim(f.sources),
    ]);
  }

  if (freq.length > 50) {
    table.push([
      '',
      chalk.dim('...'),
      chalk.dim(`${freq.length - 50} more`),
      '',
    ]);
  }

  console.log(table.toString());
}

// ── Stats view ───────────────────────────────────────────────

function statsView(): void {
  const range = getLogRange();

  console.log(chalk.bold.hex('#ff8c00')('\n  SCAN HISTORY STATS'));

  const statLines = [
    ['First Entry', range.firstDate],
    ['Last Entry', range.lastDate],
    ['Total Entries', range.totalEntries.toLocaleString()],
    ['CSV File', 'data/scan-history.csv'],
    ['JSON File', 'data/scan-history.json'],
  ] as [string, string][];

  const table = new Table({
    style: { head: [], border: ['dim'] },
    colWidths: [18, 50],
  });

  table.push(...statLines);
  console.log(table.toString());

  // Top 5 this week
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayOffset);
  const weekStart = monday.toISOString().split('T')[0];
  const weekFreq = tickerFrequency(weekStart, today.toISOString().split('T')[0]);

  if (weekFreq.length > 0) {
    console.log(chalk.bold.greenBright(`\n  TOP 5 MOST SCANNED THIS WEEK (since ${weekStart}):`));
    for (let i = 0; i < Math.min(5, weekFreq.length); i++) {
      const f = weekFreq[i];
      console.log(`    ${i + 1}. ${chalk.bold.white(f.ticker)} — ${f.count} hits (${f.sources})`);
    }
    console.log();
  }
}

// ── Export ────────────────────────────────────────────────────

function exportHistory(outputFile: string): void {
  const entries = readHistory();
  if (entries.length === 0) {
    console.log(chalk.yellow('\n  No scan history to export.\n'));
    return;
  }

  const csv = entriesToCsv(entries);
  const outputPath = path.resolve(outputFile);
  fs.writeFileSync(outputPath, csv, 'utf-8');
  console.log(chalk.greenBright(`\n  Exported ${entries.length} entries to: ${outputPath}\n`));
}

// ── Main history viewer ───────────────────────────────────────

export function viewHistory(opts: HistoryOptions): void {
  switch (opts.mode) {
    case 'today': {
      const entries = readTodayHistory();
      const today = new Date().toISOString().split('T')[0];
      console.log(chalk.bold.hex('#ff8c00')(`\n  SCAN HISTORY — TODAY (${today})`));
      console.log();
      historyTable(entries);
      break;
    }
    case 'date': {
      const entries = readDateHistory(opts.date!);
      console.log(chalk.bold.hex('#ff8c00')(`\n  SCAN HISTORY — ${opts.date}`));
      console.log();
      historyTable(entries);
      break;
    }
    case 'range': {
      const entries = readRangeHistory(opts.startDate!, opts.endDate!);
      console.log(chalk.bold.hex('#ff8c00')(`\n  SCAN HISTORY — ${opts.startDate} to ${opts.endDate}`));
      console.log();
      historyTable(entries);
      break;
    }
    case 'ticker': {
      let entries: ScanHistoryEntry[];
      if (opts.startDate && opts.endDate) {
        entries = readTickerRangeHistory(opts.ticker!, opts.startDate, opts.endDate);
        console.log(chalk.bold.hex('#ff8c00')(`\n  SCAN HISTORY — ${opts.ticker!.toUpperCase()} (${opts.startDate} to ${opts.endDate})`));
      } else {
        entries = readTickerHistory(opts.ticker!);
        console.log(chalk.bold.hex('#ff8c00')(`\n  SCAN HISTORY — ${opts.ticker!.toUpperCase()} (all time)`));
      }
      console.log();
      historyTable(entries);
      break;
    }
    case 'summary': {
      const today = new Date().toISOString().split('T')[0];
      const weekStart = (() => {
        const d = new Date();
        const dow = d.getDay();
        const monOff = dow === 0 ? 6 : dow - 1;
        d.setDate(d.getDate() - monOff);
        return d.toISOString().split('T')[0];
      })();
      summaryTable(weekStart, today);
      break;
    }
    case 'stats': {
      statsView();
      break;
    }
    case 'export': {
      exportHistory(opts.outputFile!);
      break;
    }
    case 'recent': {
      const entries = readHistory().slice(-(opts.maxResults ?? 50)).reverse();
      console.log(chalk.bold.hex('#ff8c00')(`\n  SCAN HISTORY — LATEST ${entries.length} ENTRIES`));
      console.log();
      historyTable(entries);
      break;
    }
  }
}
