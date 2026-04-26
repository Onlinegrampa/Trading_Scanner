import chalk from 'chalk';
import Table from 'cli-table3';
import { readTodayHistory, readRecentHistory, tickerFrequency } from '../data/scanHistory';
import type { ScanResults, GapResult, MomentumResult, ReversalResult, NewsItem, DailyGrade, EMAArrow, StockType, MomoInfo } from '../types';
import type { CatalystStrength } from '../analysis/catalyst';

// ── Formatting helpers ────────────────────────────────────────

function fmtPrice(p: number): string {
  return `$${p.toFixed(2)}`;
}

function fmtPct(p: number, showSign = true): string {
  const sign = p > 0 && showSign ? '+' : '';
  return `${sign}${p.toFixed(2)}%`;
}

function fmtVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}

function fmtFloat(f: number | null): string {
  if (f === null) return 'N/A';
  if (f >= 1_000_000_000) return `${(f / 1_000_000_000).toFixed(1)}B`;
  if (f >= 1_000_000) return `${(f / 1_000_000).toFixed(1)}M`;
  return `${(f / 1_000).toFixed(0)}K`;
}

function fmtRelVol(rv: number): string {
  return `${rv.toFixed(1)}x`;
}

function fmtScore(score: number): string {
  const bars = Math.round((score / 100) * 8);
  const filled = '█'.repeat(bars);
  const empty = '░'.repeat(8 - bars);
  return `${filled}${empty} ${score}`;
}

// ── Color helpers ─────────────────────────────────────────────

function gapColor(pct: number, dir: 'UP' | 'DOWN'): chalk.Chalk {
  const abs = Math.abs(pct);
  if (dir === 'UP') {
    if (abs >= 50) return chalk.bold.greenBright;
    if (abs >= 30) return chalk.greenBright;
    if (abs >= 20) return chalk.green;
    if (abs >= 10) return chalk.hex('#00cc44');
    return chalk.hex('#66bb6a');
  } else {
    if (abs >= 50) return chalk.bold.redBright;
    if (abs >= 30) return chalk.redBright;
    if (abs >= 20) return chalk.red;
    if (abs >= 10) return chalk.hex('#cc2222');
    return chalk.hex('#ef5350');
  }
}

function volColor(rv: number): chalk.Chalk {
  if (rv >= 10) return chalk.bold.whiteBright;
  if (rv >= 5) return chalk.white;
  if (rv >= 2) return chalk.hex('#cccccc');
  return chalk.hex('#888888');
}

function floatStr(float: number | null): string {
  const str = fmtFloat(float);
  if (float !== null && float < 10_000_000) {
    return chalk.bold.yellow(`${str} *`);
  }
  return str;
}

function scoreStr(score: number): string {
  if (score >= 80) return chalk.bold.greenBright(fmtScore(score));
  if (score >= 65) return chalk.green(fmtScore(score));
  if (score >= 50) return chalk.hex('#ffcc00')(fmtScore(score));
  if (score >= 35) return chalk.hex('#ff9900')(fmtScore(score));
  return chalk.dim(fmtScore(score));
}

// ── Header banner ─────────────────────────────────────────────

function printBanner(results: ScanResults): void {
  const now = results.timestamp.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const dur = (results.meta.scanDurationMs / 1000).toFixed(1);
  const calls = results.meta.apiCallsThisCycle;

  const width = 100;
  const title = ' SCARLET TERMINAL ';
  const info = ` ${now}  |  Scan: ${dur}s  |  API Calls: ${calls}  |  Polygon.io `;

  const padding = width - title.length - info.length - 2;
  const pad = ' '.repeat(Math.max(0, padding));

  console.log(chalk.bold.hex('#ff8c00')('━'.repeat(width)));
  console.log(
    chalk.bold.bgHex('#1a0d00').hex('#ff8c00')('  ◆  ') +
    chalk.bold.hex('#ff8c00')(title) +
    chalk.dim(pad + info),
  );
  console.log(chalk.bold.hex('#ff8c00')('━'.repeat(width)));
  console.log();
}

// ── Daily chart helpers ───────────────────────────────────────

function dailyGradeStr(grade: DailyGrade | undefined): string {
  if (!grade) return chalk.dim('—');
  switch (grade) {
    case 'A+': return chalk.bold.cyanBright('A+');
    case 'A':  return chalk.bold.greenBright('A');
    case 'B':  return chalk.yellow('B');
    case 'C':  return chalk.hex('#ff9900')('C');
    case 'D':  return chalk.red('D');
  }
}

function emaArrowStr(arrow: EMAArrow | undefined): string {
  if (!arrow) return '';
  switch (arrow) {
    case 'UP':    return chalk.green(' ▲');
    case 'MIXED': return chalk.yellow(' →');
    case 'DOWN':  return chalk.red(' ▼');
  }
}

function ema200DistStr(dist: number | undefined): string {
  if (dist === undefined) return chalk.dim('—');
  const sign = dist >= 0 ? '+' : '';
  const str  = `${sign}$${Math.abs(dist).toFixed(2)}`;
  return dist >= 0 ? chalk.green(str) : chalk.red(str);
}

function stockTypeStr(type: StockType | undefined, momoInfo?: MomoInfo | null): string {
  if (!type) return chalk.dim('—');
  switch (type) {
    case 'BLUE_SKY':    return chalk.bold.cyanBright('BLUE SKY');
    case 'IPO':         return chalk.bold.greenBright('IPO');
    case 'R/S':         return chalk.yellow('R/S');
    case 'FORMER_MOMO': {
      const label = chalk.hex('#ce93d8')('MOMO');
      if (momoInfo) {
        const sign    = momoInfo.pct >= 0 ? '+' : '';
        const detail  = chalk.dim(` ${sign}${momoInfo.pct.toFixed(0)}% ${momoInfo.daysAgo}d ago`);
        return `${label}${detail}`;
      }
      return label;
    }
  }
}

// ── Catalyst cell ─────────────────────────────────────────────

function catalystCell(news: NewsItem | null | undefined, hasS3 = false): string {
  const s3Tag = hasS3 ? chalk.bold.red(' S3⚠') : '';

  if (!news) return hasS3 ? chalk.bold.red('S3⚠') : chalk.dim('No news');

  const { type, strength } = news.catalyst;
  const colorFn: chalk.Chalk =
    strength === 'strong'   ? chalk.bold.greenBright :
    strength === 'moderate' ? chalk.yellow :
    strength === 'negative' ? chalk.bold.red :
    chalk.dim;

  // Show type badge + first 18 chars of headline
  const badge    = colorFn(type.slice(0, 12).padEnd(12));
  const headline = chalk.dim(news.title.slice(0, 20));

  return `${badge} ${headline}${s3Tag}`;
}

// ── Gap Scanner table ─────────────────────────────────────────

function printGapTable(results: GapResult[], direction: 'UP' | 'DOWN'): void {
  if (results.length === 0) {
    console.log(chalk.dim(`  No ${direction === 'UP' ? 'gappers up' : 'gappers down'} found.\n`));
    return;
  }

  const arrow = direction === 'UP' ? '▲' : '▼';
  const color = direction === 'UP' ? chalk.bold.greenBright : chalk.bold.redBright;
  const label = direction === 'UP' ? 'GAPPERS UP' : 'GAPPERS DOWN';

  console.log(color(`${arrow} GAP SCANNER — ${label} (${results.length})`));

  const table = new Table({
    head: [
      chalk.bold('#'),
      chalk.bold('Ticker'),
      chalk.bold('Price'),
      chalk.bold('Gap %'),
      chalk.bold('Float'),
      chalk.bold('Volume'),
      chalk.bold('Rel.Vol'),
      chalk.bold('Chg/Open'),
      chalk.bold('Quality'),
      chalk.bold('Daily'),
      chalk.bold('200 EMA'),
      chalk.bold('Type'),
      chalk.bold('Catalyst'),
    ],
    style: {
      head: [],
      border: ['dim'],
    },
    colWidths: [4, 8, 9, 10, 9, 9, 9, 11, 18, 8, 11, 14, 36],
    colAligns: ['right', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'center', 'right', 'left', 'left'],
  });

  for (const r of results) {
    const gc = gapColor(r.gapPercent, direction);
    const vc = volColor(r.relativeVolume);

    const chgFromOpenStr =
      r.changeFromOpen >= 0
        ? chalk.green(fmtPct(r.changeFromOpen))
        : chalk.red(fmtPct(r.changeFromOpen));

    const dailyCell = `${dailyGradeStr(r.dailyGrade)}${emaArrowStr(r.emaArrow)}`;

    table.push([
      chalk.dim(r.rank.toString()),
      chalk.bold.white(r.ticker),
      fmtPrice(r.price),
      gc(fmtPct(r.gapPercent)),
      floatStr(r.float),
      vc(fmtVolume(r.volume)),
      vc(fmtRelVol(r.relativeVolume)),
      chgFromOpenStr,
      scoreStr(r.qualityScore),
      dailyCell,
      ema200DistStr(r.ema200Dist),
      stockTypeStr(r.stockType, r.momoInfo),
      catalystCell(r.latestNews, r.hasS3),
    ]);
  }

  console.log(table.toString());
  console.log();
}

// ── Momentum Scanner table ────────────────────────────────────

function printMomentumTable(results: MomentumResult[]): void {
  if (results.length === 0) {
    console.log(chalk.dim('  No momentum plays found.\n'));
    return;
  }

  console.log(chalk.bold.hex('#ffd700')(`⚡ HIGH DAY MOMENTUM (${results.length})`));

  const table = new Table({
    head: [
      chalk.bold('Ticker'),
      chalk.bold('Price'),
      chalk.bold('Chg %'),
      chalk.bold('Rel.Vol'),
      chalk.bold('Float'),
      chalk.bold('Volume'),
      chalk.bold('HoD Dist'),
      chalk.bold('VWAP'),
      chalk.bold('Trigger'),
    ],
    style: { head: [], border: ['dim'] },
    colWidths: [8, 9, 9, 9, 11, 9, 10, 10, 18],
    colAligns: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left'],
  });

  for (const r of results) {
    const chgColor = r.changePercent >= 0 ? chalk.greenBright : chalk.redBright;
    const vwapStr = r.aboveVWAP ? chalk.green('▲ ABOVE') : chalk.red('▼ BELOW');
    const hodStr = chalk.dim(`-${r.distanceFromHigh.toFixed(1)}%`);
    const vc = volColor(r.relativeVolume);

    let triggerLabel: string;
    switch (r.triggerType) {
      case 'NEW_HIGH':
        triggerLabel = chalk.bold.greenBright('🔥 NEW HIGH');
        break;
      case 'LOW_FLOAT_BOUNCE':
        triggerLabel = chalk.bold.cyan('💎 LF BOUNCE');
        break;
      default:
        triggerLabel = chalk.hex('#ffd700')('📈 BREAKOUT');
    }

    table.push([
      chalk.bold.white(r.ticker),
      fmtPrice(r.price),
      chgColor(fmtPct(r.changePercent)),
      vc(fmtRelVol(r.relativeVolume)),
      floatStr(r.float),
      vc(fmtVolume(r.volume)),
      hodStr,
      vwapStr,
      triggerLabel,
    ]);
  }

  console.log(table.toString());
  console.log();
}

// ── Reversal Scanner table ────────────────────────────────────

function printReversalTable(results: ReversalResult[]): void {
  if (results.length === 0) {
    console.log(chalk.dim('  No reversal signals.\n'));
    return;
  }

  console.log(chalk.bold.hex('#ff6600')(`🔄 REVERSAL ALERTS (${results.length})`));

  const table = new Table({
    head: [
      chalk.bold('Ticker'),
      chalk.bold('Price'),
      chalk.bold('Dir'),
      chalk.bold('Setup'),
      chalk.bold('5m Cndls'),
      chalk.bold('1m Cndls'),
      chalk.bold('RSI(2)'),
      chalk.bold('BB'),
      chalk.bold('Pattern'),
      chalk.bold('Multi-TF'),
    ],
    style: { head: [], border: ['dim'] },
    colWidths: [8, 9, 8, 14, 10, 10, 9, 9, 14, 10],
    colAligns: ['left', 'right', 'center', 'left', 'right', 'right', 'right', 'center', 'left', 'center'],
  });

  for (const r of results) {
    const dirStr =
      r.direction === 'TOP'
        ? chalk.red('⬇ TOP')
        : chalk.green('⬆ BOT');

    let setupStr: string;
    switch (r.setupType) {
      case 'MULTI_TF':
        setupStr = chalk.bold.magenta('MULTI-TF');
        break;
      case 'SETUP_1_5MIN':
        setupStr = chalk.hex('#ff9900')('5MIN-SETUP');
        break;
      default:
        setupStr = chalk.hex('#9966ff')('1MIN-SETUP');
    }

    const rsiColor =
      r.rsi2 >= 90
        ? chalk.bold.redBright
        : r.rsi2 <= 10
        ? chalk.bold.greenBright
        : chalk.white;

    const bbStr = r.outsideBand ? chalk.yellow('OUTSIDE') : chalk.dim('inside');
    const patternStr = r.candlePattern
      ? chalk.hex('#00ffff')(r.candlePattern.replace(/_/g, ' '))
      : chalk.dim('—');
    const multiStr = r.multiTimeframeAlignment ? chalk.bold.magenta('✓ YES') : chalk.dim('—');

    table.push([
      chalk.bold.white(r.ticker),
      fmtPrice(r.price),
      dirStr,
      setupStr,
      chalk.dim(r.consecutiveCandles5m.toString()),
      chalk.dim(r.consecutiveCandles1m.toString()),
      rsiColor(r.rsi2.toFixed(1)),
      bbStr,
      patternStr,
      multiStr,
    ]);
  }

  console.log(table.toString());
  console.log();
}

// ── Footer ────────────────────────────────────────────────────

function printFooter(nextRefreshSec: number): void {
  const bar = '─'.repeat(100);
  console.log(chalk.dim(bar));
  console.log(
    chalk.dim(`  ★ Cyan float = under 10M shares   |  `) +
    chalk.dim(`★ Quality score max 100   |  `) +
    chalk.dim(`Next refresh in ${nextRefreshSec}s   |  `) +
    chalk.dim(`Web UI: http://localhost:3000`),
  );
}

// ── Main render ───────────────────────────────────────────────

export function renderCLI(results: ScanResults, nextRefreshSec = 30): void {
  // Clear terminal
  process.stdout.write('\x1Bc');

  printBanner(results);
  printGapTable(results.gappersUp, 'UP');
  printGapTable(results.gappersDown, 'DOWN');
  printMomentumTable(results.momentum);
  printReversalTable(results.reversals);
  printFooter(nextRefreshSec);
  printHistorySidebar(15);
}

// ── Scan History Sidebar ──────────────────────────────────────

export function printHistorySidebar(maxResults = 20): void {
  const entries = readRecentHistory(maxResults);
  if (entries.length === 0) {
    return;
  }

  const width = 100;
  console.log(chalk.bold.hex('#ff8c00')('\n' + '━'.repeat(width)));
  console.log(chalk.bold.hex('#ff8c00')('  SCAN HISTORY'));

  const table = new Table({
    head: [
      chalk.bold('Time'),
      chalk.bold('Ticker'),
      chalk.bold('Source'),
      chalk.bold('Price'),
      chalk.bold('Gap%'),
      chalk.bold('Chg%'),
      chalk.bold('Vol'),
    ],
    style: { head: [], border: ['dim'] },
    colWidths: [20, 8, 12, 9, 10, 10, 10],
    colAligns: ['left', 'left', 'left', 'right', 'right', 'right', 'right'],
  });

  // Show today's frequency
  const today = new Date().toISOString().split('T')[0];
  const todayFreq = tickerFrequency(today, today);
  const todayTotal = todayFreq.reduce((sum, f) => sum + f.count, 0);

  for (const e of entries) {
    const gapPct = e.gapPercent != null
      ? (e.gapPercent >= 0 ? chalk.green(`+${e.gapPercent.toFixed(1)}%`) : chalk.red(`${e.gapPercent.toFixed(1)}%`))
      : chalk.dim('—');

    const chgPct = e.changePercent != null
      ? (e.changePercent >= 0 ? chalk.green(`+${e.changePercent.toFixed(1)}%`) : chalk.red(`${e.changePercent.toFixed(1)}%`))
      : chalk.dim('—');

    const vol = e.volume >= 1_000_000
      ? `${(e.volume / 1_000_000).toFixed(1)}M`
      : e.volume >= 1_000
        ? `${(e.volume / 1_000).toFixed(0)}K`
        : e.volume > 0 ? e.volume.toString() : chalk.dim('—');

    table.push([
      e.timestamp,
      chalk.bold.white(e.ticker),
      chalk.dim(e.source),
      `$${e.price.toFixed(2)}`,
      gapPct,
      chgPct,
      vol,
    ]);
  }

  console.log(table.toString());

  // Summary
  const todayTop5 = todayFreq.slice(0, 5);
  if (todayTop5.length > 0) {
    console.log(chalk.bold.hex('#ff8c00')(`  TODAY'S TOP SCANNED (${todayTotal} hits):`));
    for (const f of todayTop5) {
      console.log(`    ${chalk.bold.white(f.ticker)}  ${f.count}x  (${f.sources})`);
    }
    console.log();
  }

  console.log(chalk.dim(`  ${entries.length} recent entries shown | Use --history --help for full viewer`));
}

// ── Startup message ───────────────────────────────────────────

export function printStartup(webPort: number): void {
  console.log(chalk.bold.greenBright('\n  ██████╗  ██████╗ ███████╗███████╗'));
  console.log(chalk.bold.greenBright('  ██╔══██╗██╔═══██╗██╔════╝██╔════╝'));
  console.log(chalk.bold.greenBright('  ██████╔╝██║   ██║███████╗███████╗'));
  console.log(chalk.bold.greenBright('  ██╔══██╗██║   ██║╚════██║╚════██║'));
  console.log(chalk.bold.greenBright('  ██║  ██║╚██████╔╝███████║███████║'));
  console.log(chalk.bold.greenBright('  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝'));
  console.log(chalk.bold.white('        SCANNER  —  Powered by Polygon.io\n'));
  console.log(chalk.dim('  Starting scanners...'));
  console.log(chalk.dim(`  Web UI available at: `) + chalk.cyan(`http://localhost:${webPort}`));
  console.log(chalk.dim('  Press Ctrl+C to stop\n'));
}
