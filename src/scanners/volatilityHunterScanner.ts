import { isLikelyListedStock, buildEnrichedTicker, PolygonClient } from '../api/polygon';
import type { PolygonSnapshotTicker, VolatilityHunterResult } from '../types';

// Computes ATR expansion using daily candle highs/lows
// ATR(1d) ≈ (high - low) of each bar; expansion = today's range / avg of last 14

function computeAtrExpansion(candles: { h: number; l: number }[], todayHigh: number, todayLow: number): number {
  const ranges = candles.slice(-14).map(c => c.h - c.l);
  if (ranges.length === 0) return 1;
  const avgAtr = ranges.reduce((s, r) => s + r, 0) / ranges.length;
  if (avgAtr <= 0) return 1;
  const todayRange = todayHigh - todayLow;
  return todayRange / avgAtr;
}

function passesPreFilter(snap: PolygonSnapshotTicker): boolean {
  if (!isLikelyListedStock(snap.ticker)) return false;
  const price = snap.lastTrade?.p || snap.min?.c || snap.day?.c || 0;
  if (price < 1 || price > 500) return false;
  const volume = snap.min?.av ?? snap.day?.v ?? 0;
  if (volume < 50_000) return false;
  // Rough pre-filter: today's range > 3% of price suggests expansion
  const high = snap.day?.h ?? 0;
  const low  = snap.day?.l ?? 0;
  if (price > 0 && (high - low) / price < 0.03) return false;
  return true;
}

export async function runVolatilityHunterScanner(
  snapshots: PolygonSnapshotTicker[],
  client: PolygonClient,
): Promise<VolatilityHunterResult[]> {
  const candidates = snapshots.filter(passesPreFilter);

  // Sort by intraday range as % of price (proxy for ATR expansion)
  candidates.sort((a, b) => {
    const rangeA = (a.day.h - a.day.l) / (a.lastTrade?.p || a.day.c || 1);
    const rangeB = (b.day.h - b.day.l) / (b.lastTrade?.p || b.day.c || 1);
    return rangeB - rangeA;
  });

  const top = candidates.slice(0, 40);
  const enrichMap = await client.enrichTickers(top.map(s => s.ticker));

  // Fetch daily candles to compute ATR (session-cached)
  const dailyMap = await client.batchGetDailyCandles(top.map(s => s.ticker));

  const results: VolatilityHunterResult[] = [];

  for (const snap of top) {
    const e = enrichMap.get(snap.ticker) ?? { float: null, avgVolume: null, exchange: null, isOTC: false };
    if (e.isOTC) continue;
    const t = buildEnrichedTicker(snap, e);

    const candles = dailyMap.get(t.ticker) ?? [];
    // Exclude today's candle from historical (last bar may be today)
    const historical = candles.slice(0, -1);
    const atrExpansion = computeAtrExpansion(
      historical,
      snap.day?.h ?? t.currentPrice,
      snap.day?.l ?? t.currentPrice,
    );

    // Trigger: ATR expansion > 1.5 (50% above historical average)
    if (atrExpansion < 1.5) continue;

    results.push({
      ticker:         t.ticker,
      price:          t.currentPrice,
      changePercent:  t.changePercent,
      atrExpansion,
      relativeVolume: t.relativeVolume,
      float:          t.float,
      exchange:       t.exchange,
    });
  }

  results.sort((a, b) => b.atrExpansion - a.atrExpansion);
  return results.slice(0, 20);
}
