import type { PolygonAggBar, DailyGrade, EMAArrow, StockType, MomoInfo } from '../types';

// ── EMA calculator ────────────────────────────────────────────

function calcEMA(closes: number[], period: number): number[] {
  if (closes.length < period) return closes.map(() => 0);
  const k = 2 / (period + 1);
  // Seed with SMA of first `period` values
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result: number[] = new Array(period - 1).fill(0);
  result.push(ema);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// ── Grade ─────────────────────────────────────────────────────

function calcGrade(price: number, ema200: number, high52w: number): DailyGrade {
  const pctBelowHigh = high52w > 0 ? ((high52w - price) / high52w) * 100 : 100;
  if (pctBelowHigh <= 5)                    return 'A+';
  if (price > ema200 && price - ema200 > 5) return 'A';
  if (price > ema200)                       return 'B';
  if (price >= ema200 * 0.80)               return 'C';
  return 'D';
}

// ── Reverse split detection ───────────────────────────────────
// Looks for a candle where open is 3× or more above prior close
// AND volume is <20% of the average surrounding volume.

function detectReverseSplit(candles: PolygonAggBar[]): boolean {
  if (candles.length < 5) return false;
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].c;
    if (prevClose <= 0) continue;
    if (candles[i].o / prevClose < 3) continue;
    // Price jumped ≥3×; check if volume was suspiciously low
    const lo = Math.max(0, i - 5);
    const hi = Math.min(candles.length, i + 6);
    const surrounding = [
      ...candles.slice(lo, i),
      ...candles.slice(i + 1, hi),
    ];
    if (surrounding.length === 0) return true;
    const avgVol = surrounding.reduce((s, c) => s + c.v, 0) / surrounding.length;
    if (candles[i].v < avgVol * 0.2) return true;
  }
  return false;
}

// ── Former momentum detection ─────────────────────────────────
// Scans the last ~130 trading days (~6 months) for any single day where
// abs((close - open) / open) >= 50%.  Returns the MOST RECENT such day.

export function detectFormerMomoInfo(candles: PolygonAggBar[]): MomoInfo | null {
  const lookback = candles.slice(-130);
  // Walk newest-first so we surface the most recent qualifying day
  for (let i = lookback.length - 1; i >= 0; i--) {
    const bar = lookback[i];
    if (!bar.o || bar.o <= 0) continue;
    const pct = ((bar.c - bar.o) / bar.o) * 100;
    if (Math.abs(pct) >= 50) {
      const date    = new Date(bar.t).toISOString().split('T')[0];
      const daysAgo = Math.round((Date.now() - bar.t) / (1000 * 60 * 60 * 24));
      return { date, pct, daysAgo };
    }
  }
  return null;
}

// ── Main analyser ─────────────────────────────────────────────

export interface DailyAnalysisResult {
  grade: DailyGrade;
  ema200: number;
  ema200Dist: number;
  ema9: number;
  ema20: number;
  emaArrow: EMAArrow;
  high52w: number;
  stockType: StockType;
  momoInfo: MomoInfo | null;
  candleCount: number;
}

export function analyzeDailyChart(
  candles: PolygonAggBar[],
  currentPrice: number,
): DailyAnalysisResult {
  const candleCount = candles.length;

  if (candleCount < 10) {
    return {
      grade: 'C',
      ema200: 0,
      ema200Dist: 0,
      ema9: 0,
      ema20: 0,
      emaArrow: 'DOWN',
      high52w: currentPrice,
      stockType: 'IPO',
      momoInfo: null,
      candleCount,
    };
  }

  const closes = candles.map(c => c.c);
  const highs  = candles.map(c => c.h);

  // 52-week high — highest daily high in last 252 candles
  const lookback252 = highs.slice(-252);
  const high52w = Math.max(...lookback252);

  // EMAs (need enough candles; fall back gracefully)
  const ema200Arr = calcEMA(closes, 200);
  const ema9Arr   = calcEMA(closes, 9);
  const ema20Arr  = calcEMA(closes, 20);

  const ema200 = ema200Arr[ema200Arr.length - 1] ?? 0;
  const ema9   = ema9Arr[ema9Arr.length - 1]     ?? 0;
  const ema20  = ema20Arr[ema20Arr.length - 1]   ?? 0;

  const ema200Dist = currentPrice - ema200;

  const grade: DailyGrade = ema200 > 0
    ? calcGrade(currentPrice, ema200, high52w)
    : 'C';

  // EMA arrow: above both 9&20 = UP, one of them = MIXED, below both = DOWN
  let emaArrow: EMAArrow;
  const aboveEma9  = ema9  > 0 && currentPrice > ema9;
  const aboveEma20 = ema20 > 0 && currentPrice > ema20;
  if (aboveEma9 && aboveEma20)       emaArrow = 'UP';
  else if (aboveEma9 || aboveEma20)  emaArrow = 'MIXED';
  else                               emaArrow = 'DOWN';

  // Stock type — priority: BLUE_SKY > IPO > R/S > FORMER_MOMO
  const momoInfo = detectFormerMomoInfo(candles);
  let stockType: StockType = null;
  const pctBelowHigh = high52w > 0 ? ((high52w - currentPrice) / high52w) * 100 : 100;
  if (pctBelowHigh <= 5) {
    stockType = 'BLUE_SKY';
  } else if (candleCount < 250) {
    stockType = 'IPO';
  } else if (detectReverseSplit(candles)) {
    stockType = 'R/S';
  } else if (momoInfo) {
    stockType = 'FORMER_MOMO';
  }

  return { grade, ema200, ema200Dist, ema9, ema20, emaArrow, high52w, stockType, momoInfo, candleCount };
}

// ── Quality bonus for daily grade ────────────────────────────

export function dailyGradeBonus(grade: DailyGrade): number {
  switch (grade) {
    case 'A+': return 10;
    case 'A':  return 7;
    case 'B':  return 3;
    case 'D':  return -5;
    default:   return 0;
  }
}
