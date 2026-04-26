import 'dotenv/config';
import chalk from 'chalk';
import { PolygonClient } from './api/polygon';
import { NewsClient } from './api/news';
import { runGapScanner } from './scanners/gapScanner';
import { runMomentumScanner } from './scanners/momentumScanner';
import { runReversalScanner } from './scanners/reversalScanner';
import { runMikeLargeCapScanner } from './scanners/mikeLargeCapScanner';
import { runHodMomoScanner } from './scanners/hodMomoScanner';
import { runFivePillarScanner } from './scanners/fivePillarScanner';
import { runPennyScanner } from './scanners/pennyScanner';
import { runTopListsScanner } from './scanners/topListsScanner';
import { runEarningsScanner } from './scanners/earningsScanner';
import { runVolatilityHunterScanner } from './scanners/volatilityHunterScanner';
import { renderCLI, printStartup } from './display/cli';
import { startWebServer, pushResults } from './display/web';
import { appendScanHistory } from './data/scanHistory';
import { parseHistoryArgs, viewHistory } from './display/historyViewer';
import { SCANNER_CONFIG } from './config';
import type { ScanResults } from './types';

// ── Validate env ──────────────────────────────────────────────

const API_KEY = process.env.POLYGON_API_KEY;
if (!API_KEY) {
  console.error(
    '\n  ERROR: POLYGON_API_KEY is not set.\n' +
    '  Copy .env.example to .env and add your key.\n' +
    '  Get a free key at https://polygon.io/dashboard\n',
  );
  process.exit(1);
}

// ── Parse CLI flags ───────────────────────────────────────────

const args = process.argv.slice(2);
const cliOnly = args.includes('--cli');
const webOnly = args.includes('--web');
const showCLI = !webOnly;
const showWeb = !cliOnly;

// ── Setup ─────────────────────────────────────────────────────

const client     = new PolygonClient(API_KEY);
const newsClient = new NewsClient(API_KEY);
let nextRefreshSecs: number = SCANNER_CONFIG.refresh.intervalSeconds;
let countdownTimer: ReturnType<typeof setInterval> | null = null;

// ── Main scan loop ────────────────────────────────────────────

async function runScan(): Promise<ScanResults> {
  const start = Date.now();
  client.resetCallCount();

  // Step 1: fetch all snapshots (1 API call)
  console.log('  [Scanner] Fetching snapshots...');
  const snapshots = await client.getAllSnapshots();
  const totalSnapshotTickers = snapshots.length;
  console.log(`  [Scanner] Got ${totalSnapshotTickers} tickers, running scanners...`);

  // Step 2: run gap and momentum scanners concurrently
  const [{ gappersUp, gappersDown }, momentum] = await Promise.all([
    runGapScanner(snapshots, client),
    runMomentumScanner(snapshots, client),
  ]);

  const filteredTickers = gappersUp.length + gappersDown.length + momentum.length;

  // Step 3: run reversal scanner on top momentum candidates
  const reversals = await runReversalScanner(momentum, client);

  // Step 3b: run Mike's large cap scanner (fail-silently)
  let mikeLargeCaps: ScanResults['mikeLargeCaps'] = [];
  let mikeSpyGapPct: number | undefined;
  let mikeScanDurationMs: number | undefined;
  try {
    const mikeStart = Date.now();
    mikeLargeCaps = await runMikeLargeCapScanner(snapshots, client);
    mikeScanDurationMs = Date.now() - mikeStart;
    mikeSpyGapPct = mikeLargeCaps[0]?.spyGapPct;
  } catch (err) {
    console.error('[Mike Scanner] Failed (non-fatal):', (err as Error).message);
  }

  // Step 3c: Phase 1 scanners (all fail-silently)
  let hodMomo:          ScanResults['hodMomo']          = [];
  let fivePillar:       ScanResults['fivePillar']       = [];
  let pennyResults:     ScanResults['pennyResults']     = [];
  let topLists:         ScanResults['topLists'];
  let earnings:         ScanResults['earnings']         = [];
  let volatilityHunter: ScanResults['volatilityHunter'] = [];

  // Step 4: collect unique tickers across all scanners for news fetch
  const newsTargets = [
    ...new Set([
      ...gappersUp.map(r => r.ticker),
      ...gappersDown.map(r => r.ticker),
      ...momentum.map(r => r.ticker),
    ]),
  ];

  // Step 5: fetch news + S3 concurrently (both gracefully degrade on failure)
  // S3 check is only run for gap tickers with quality > 50 to save API calls
  const s3Targets = [...gappersUp, ...gappersDown]
    .filter(r => r.qualityScore > 50)
    .map(r => r.ticker);

  const [newsMap, s3Flags] = await Promise.all([
    newsClient.batchGetNews(newsTargets),
    newsClient.batchCheckS3(s3Targets),
  ]);

  // Step 6: attach latestNews + hasS3 to gap results (non-destructive mutation)
  const s3Set = new Set(s3Flags);
  for (const r of [...gappersUp, ...gappersDown]) {
    r.latestNews = (newsMap[r.ticker] ?? [])[0] ?? null;
    r.hasS3      = s3Set.has(r.ticker);
  }

  // Step 7: run Phase 1 scanners concurrently (newsMap now available)
  await Promise.all([
    (async () => { try { hodMomo          = await runHodMomoScanner(snapshots, client); } catch (e) { console.error('[HOD Momo] Non-fatal:', (e as Error).message); } })(),
    (async () => { try { fivePillar       = await runFivePillarScanner(snapshots, client, newsMap); } catch (e) { console.error('[5-Pillar] Non-fatal:', (e as Error).message); } })(),
    (async () => { try { pennyResults     = await runPennyScanner(snapshots, client); } catch (e) { console.error('[Penny] Non-fatal:', (e as Error).message); } })(),
    (async () => { try { topLists         = await runTopListsScanner(snapshots, client); } catch (e) { console.error('[TopLists] Non-fatal:', (e as Error).message); } })(),
    (async () => { try { earnings         = await runEarningsScanner(snapshots, client, newsMap); } catch (e) { console.error('[Earnings] Non-fatal:', (e as Error).message); } })(),
    (async () => { try { volatilityHunter = await runVolatilityHunterScanner(snapshots, client); } catch (e) { console.error('[VolHunter] Non-fatal:', (e as Error).message); } })(),
  ]);

  const scanDurationMs = Date.now() - start;

  const results: ScanResults = {
    timestamp: new Date(),
    gappersUp,
    gappersDown,
    momentum,
    reversals,
    news:    newsMap,
    s3Flags,
    mikeLargeCaps,
    mikeSpyGapPct,
    mikeScanDurationMs,
    hodMomo,
    fivePillar,
    pennyResults,
    topLists,
    earnings,
    volatilityHunter,
    meta: {
      totalSnapshotTickers,
      filteredTickers,
      scanDurationMs,
      apiCallsThisCycle: client.callCount,
    },
  };

  console.log(
    `  [Scanner] Done in ${(scanDurationMs / 1000).toFixed(1)}s | ` +
    `API calls: ${client.callCount} | ` +
    `Gappers: ${gappersUp.length}↑ ${gappersDown.length}↓ | ` +
    `Momentum: ${momentum.length} | ` +
    `Reversals: ${reversals.length} | ` +
    `News: ${Object.values(newsMap).flat().length} articles`,
  );

  return results;
}

// ── Countdown display ─────────────────────────────────────────

function startCountdown(): void {
  if (countdownTimer) clearInterval(countdownTimer);
  nextRefreshSecs = SCANNER_CONFIG.refresh.intervalSeconds;
  countdownTimer = setInterval(() => {
    nextRefreshSecs = Math.max(0, nextRefreshSecs - 1);
  }, 1000);
}

// ── History mode (non-blocking viewer) ────────────────────────

const historyFlags = args.some(a => a === '--history');

if (historyFlags) {
  const historyOpts = parseHistoryArgs(args);
  viewHistory(historyOpts);
  // Show a brief hint and exit
  console.log(chalk.dim('  Tip: npx ts-node src/index.ts --history --help for all options'));
  process.exit(0);
}

// ── Main entry ────────────────────────────────────────────────

async function main(): Promise<void> {
  const webPort = SCANNER_CONFIG.web.port;

  // Print startup banner
  printStartup(webPort);

  // Start web server if needed
  if (showWeb) {
    startWebServer(webPort);
  }

  // Initial scan
  try {
    const results = await runScan();

    appendScanHistory(results);

    if (showCLI) renderCLI(results, SCANNER_CONFIG.refresh.intervalSeconds);
    if (showWeb) pushResults(results);

    startCountdown();
  } catch (err) {
    console.error('[Scanner] Initial scan failed:', (err as Error).message);
  }

  // Recurring scan
  setInterval(async () => {
    try {
      const results = await runScan();

      appendScanHistory(results);

      if (showCLI) renderCLI(results, SCANNER_CONFIG.refresh.intervalSeconds);
      if (showWeb) pushResults(results);

      startCountdown();
    } catch (err) {
      console.error('[Scanner] Scan error:', (err as Error).message);
    }
  }, SCANNER_CONFIG.refresh.intervalSeconds * 1000);
}

// ── Graceful shutdown ─────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n\n  Shutting down scanner...\n');
  process.exit(0);
});

process.on('uncaughtException', err => {
  console.error('[UNCAUGHT]', err);
});

process.on('unhandledRejection', reason => {
  console.error('[UNHANDLED REJECTION]', reason);
});

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
