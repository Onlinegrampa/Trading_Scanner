import type { Candle, CandleColor, CandlePattern, BollingerBands } from '../types';
import type { PolygonAggBar } from '../types';

// ── Convert raw Polygon bars to candles ───────────────────────

export function barsToCandles(bars: PolygonAggBar[]): Candle[] {
  return bars.map(b => ({
    timestamp: b.t,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
    vwap: b.vw,
  }));
}

// ── Candle color ──────────────────────────────────────────────

export function candleColor(c: Candle): CandleColor {
  if (c.close > c.open) return 'green';
  if (c.close < c.open) return 'red';
  return 'doji';
}

// ── Consecutive same-color candles (from most recent) ─────────

export function countConsecutiveCandles(candles: Candle[]): {
  count: number;
  direction: 'UP' | 'DOWN' | null;
} {
  if (candles.length === 0) return { count: 0, direction: null };

  const last = candles[candles.length - 1];
  const baseColor = candleColor(last);
  if (baseColor === 'doji') return { count: 1, direction: null };

  let count = 1;
  for (let i = candles.length - 2; i >= 0; i--) {
    const color = candleColor(candles[i]);
    if (color === baseColor || color === 'doji') {
      count++;
    } else {
      break;
    }
  }

  return {
    count,
    direction: baseColor === 'green' ? 'UP' : 'DOWN',
  };
}

// ── RSI (Wilder's smoothed) ───────────────────────────────────

export function calcRSI(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;

  const changes = candles.slice(1).map((c, i) => c.close - candles[i].close);

  // Initial averages (simple)
  let avgGain =
    changes
      .slice(0, period)
      .filter(c => c > 0)
      .reduce((s, c) => s + c, 0) / period;
  let avgLoss =
    changes
      .slice(0, period)
      .filter(c => c < 0)
      .reduce((s, c) => s + Math.abs(c), 0) / period;

  // Wilder smoothing for remaining
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── SMA ───────────────────────────────────────────────────────

export function calcSMA(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const slice = values.slice(i - period + 1, i + 1);
      result.push(slice.reduce((s, v) => s + v, 0) / period);
    }
  }
  return result;
}

// ── EMA ───────────────────────────────────────────────────────

export function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = new Array(values.length).fill(NaN);
  let started = false;
  let prev = 0;

  for (let i = 0; i < values.length; i++) {
    if (!started) {
      if (i === period - 1) {
        const seed = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
        result[i] = seed;
        prev = seed;
        started = true;
      }
    } else {
      const ema = values[i] * k + prev * (1 - k);
      result[i] = ema;
      prev = ema;
    }
  }
  return result;
}

// ── Bollinger Bands ───────────────────────────────────────────

export function calcBollingerBands(
  candles: Candle[],
  period = 20,
  stdDevMult = 2,
): BollingerBands | null {
  if (candles.length < period) return null;

  const closes = candles.slice(-period).map(c => c.close);
  const middle = closes.reduce((s, v) => s + v, 0) / period;

  const variance =
    closes.reduce((s, v) => s + Math.pow(v - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: middle + stdDevMult * stdDev,
    middle,
    lower: middle - stdDevMult * stdDev,
  };
}

// ── VWAP (cumulative, from start of session) ──────────────────

export function calcVWAP(candles: Candle[]): number {
  let cumulativeTpv = 0; // typical price * volume
  let cumulativeVol = 0;

  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeTpv += typicalPrice * c.volume;
    cumulativeVol += c.volume;
  }

  return cumulativeVol > 0 ? cumulativeTpv / cumulativeVol : 0;
}

// ── Candle pattern detection ──────────────────────────────────

export function detectCandlePattern(c: Candle): CandlePattern {
  const range = c.high - c.low;
  if (range === 0) return null;

  const body = Math.abs(c.close - c.open);
  const upperShadow = c.high - Math.max(c.open, c.close);
  const lowerShadow = Math.min(c.open, c.close) - c.low;

  const bodyRatio = body / range;
  const upperRatio = upperShadow / range;
  const lowerRatio = lowerShadow / range;

  // Doji: tiny body
  if (bodyRatio < 0.1) return 'doji';

  // Topping tail (shooting star / bearish): long upper shadow, small lower shadow
  if (upperRatio >= 0.6 && lowerRatio < 0.15 && bodyRatio < 0.3) {
    return 'topping_tail';
  }

  // Bottoming tail / hammer (bullish): long lower shadow, small upper shadow
  if (lowerRatio >= 0.6 && upperRatio < 0.15 && bodyRatio < 0.3) {
    return c.close > c.open ? 'hammer' : 'bottoming_tail';
  }

  // Pin bar: either shadow >= 2/3 of range with small body
  if ((upperRatio >= 0.5 || lowerRatio >= 0.5) && bodyRatio < 0.25) {
    return 'pin_bar';
  }

  return null;
}

// ── Convenience: last candle pattern ─────────────────────────

export function getLastCandlePattern(candles: Candle[]): CandlePattern {
  if (candles.length === 0) return null;
  return detectCandlePattern(candles[candles.length - 1]);
}

// ── Price outside Bollinger Bands ─────────────────────────────

export function isOutsideBands(price: number, bands: BollingerBands): boolean {
  return price > bands.upper || price < bands.lower;
}
