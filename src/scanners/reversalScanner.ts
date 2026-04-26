import { SCANNER_CONFIG } from '../config';
import { PolygonClient } from '../api/polygon';
import {
  barsToCandles,
  countConsecutiveCandles,
  calcRSI,
  calcBollingerBands,
  getLastCandlePattern,
  isOutsideBands,
} from '../analysis/technical';
import type { MomentumResult, ReversalResult } from '../types';

// ── Analyze a single ticker for reversal signals ───────────────

async function analyzeReversal(
  ticker: string,
  price: number,
  changePercent: number,
  client: PolygonClient,
): Promise<ReversalResult | null> {
  const cfg = SCANNER_CONFIG.reversal;

  // Fetch 5-min and 1-min candles concurrently
  const [bars5m, bars1m] = await Promise.all([
    client.getIntradayCandles(ticker, 5, 'minute', cfg.maxCandlesToFetch),
    client.getIntradayCandles(ticker, 1, 'minute', cfg.maxCandlesToFetch),
  ]);

  if (bars5m.length < 2 && bars1m.length < 2) return null;

  const candles5m = barsToCandles(bars5m);
  const candles1m = barsToCandles(bars1m);

  // Consecutive candle counts
  const c5m = countConsecutiveCandles(candles5m);
  const c1m = countConsecutiveCandles(candles1m);

  // Check setup thresholds
  const setup1Met = c5m.count >= cfg.setup1ConsecutiveCandles5m;
  const setup2Met = c1m.count >= cfg.setup2ConsecutiveCandles1m;
  const multiTF = setup1Met && setup2Met;

  if (!setup1Met && !setup2Met) return null;

  // Direction (based on most relevant setup)
  const primaryDirection =
    (multiTF || setup1Met) ? c5m.direction : c1m.direction;
  if (!primaryDirection) return null;

  // RSI(2)
  const allCandles = candles1m.length >= 10 ? candles1m : candles5m;
  const rsi2 = calcRSI(allCandles, cfg.rsiPeriod);

  // RSI filter: top reversal needs overbought, bottom reversal needs oversold
  const isTopReversal = primaryDirection === 'UP';
  const isBottomReversal = primaryDirection === 'DOWN';
  const rsiConfirms =
    (isTopReversal && rsi2 >= cfg.rsiOverbought) ||
    (isBottomReversal && rsi2 <= cfg.rsiOversold);

  // Bollinger Bands
  const bands = calcBollingerBands(allCandles, cfg.bollingerPeriod, cfg.bollingerStdDev);
  if (!bands) return null;

  const outsideBand = isOutsideBands(price, bands);

  // Candle pattern from last candle
  const lastCandles = candles5m.length > 0 ? candles5m : candles1m;
  const candlePattern = getLastCandlePattern(lastCandles);

  // Require at least one confirming signal: RSI extreme OR outside band OR reversal pattern
  const hasPattern =
    candlePattern !== null &&
    ['pin_bar', 'doji', 'topping_tail', 'bottoming_tail', 'hammer'].includes(
      candlePattern as string,
    );

  if (!rsiConfirms && !outsideBand && !hasPattern) return null;

  // Determine setup type
  let setupType: ReversalResult['setupType'];
  if (multiTF) setupType = 'MULTI_TF';
  else if (setup1Met) setupType = 'SETUP_1_5MIN';
  else setupType = 'SETUP_2_1MIN';

  return {
    ticker,
    price,
    direction: isTopReversal ? 'TOP' : 'BOTTOM',
    setupType,
    consecutiveCandles5m: c5m.count,
    consecutiveCandles1m: c1m.count,
    rsi2,
    bollingerBands: bands,
    outsideBand,
    candlePattern,
    multiTimeframeAlignment: multiTF,
    changePercent,
  };
}

// ── Main scanner ──────────────────────────────────────────────

export async function runReversalScanner(
  momentumResults: MomentumResult[],
  client: PolygonClient,
): Promise<ReversalResult[]> {
  const topCandidates = momentumResults.slice(
    0,
    SCANNER_CONFIG.reversal.topCandidatesForReversal,
  );

  if (topCandidates.length === 0) return [];

  const results = await Promise.all(
    topCandidates.map(m =>
      analyzeReversal(m.ticker, m.price, m.changePercent, client).catch(() => null),
    ),
  );

  return results.filter((r): r is ReversalResult => r !== null);
}
