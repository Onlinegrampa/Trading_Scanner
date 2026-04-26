import { isLikelyListedStock, buildEnrichedTicker, PolygonClient } from '../api/polygon';
import type { PolygonSnapshotTicker, PennyResult } from '../types';

// Price < $2.00
// Sub-categories: HOD (near high), 52wk-High (near 52-week high), Squeeze (up ≥ 10%)

function passesPreFilter(snap: PolygonSnapshotTicker): boolean {
  if (!isLikelyListedStock(snap.ticker)) return false;
  const price = snap.lastTrade?.p || snap.min?.c || snap.day?.c || 0;
  if (price <= 0 || price >= 2.00) return false;
  const volume = snap.min?.av ?? snap.day?.v ?? 0;
  if (volume < 100_000) return false;  // pennnies need liquidity
  return true;
}

export async function runPennyScanner(
  snapshots: PolygonSnapshotTicker[],
  client: PolygonClient,
): Promise<PennyResult[]> {
  const candidates = snapshots.filter(passesPreFilter);

  candidates.sort(
    (a, b) => Math.abs(b.todaysChangePerc ?? 0) - Math.abs(a.todaysChangePerc ?? 0),
  );

  const top = candidates.slice(0, 40);
  const enrichMap = await client.enrichTickers(top.map(s => s.ticker));

  // Fetch daily candles to compute 52-week high (session-cached)
  const dailyMap = await client.batchGetDailyCandles(top.map(s => s.ticker));

  const results: PennyResult[] = [];
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;

  for (const snap of top) {
    const e = enrichMap.get(snap.ticker) ?? { float: null, avgVolume: null, exchange: null, isOTC: false };
    if (e.isOTC) continue;
    const t = buildEnrichedTicker(snap, e);

    if (t.float !== null && t.float > 10_000_000) continue;

    // Compute 52-week high from daily candles
    const candles = (dailyMap.get(t.ticker) ?? []).filter(c => c.t >= cutoff);
    const week52High = candles.length > 0
      ? Math.max(...candles.map(c => c.h))
      : null;

    const distTo52wHigh = week52High && week52High > 0
      ? ((week52High - t.currentPrice) / week52High) * 100
      : null;

    const distFromHigh = t.highOfDay > 0
      ? ((t.highOfDay - t.currentPrice) / t.highOfDay) * 100
      : 100;

    // Classify
    let category: PennyResult['category'];
    if (t.changePercent >= 10) {
      category = 'SQUEEZE';
    } else if (distTo52wHigh !== null && distTo52wHigh <= 5) {
      category = '52WK';
    } else if (distFromHigh <= 3) {
      category = 'HOD';
    } else {
      continue;  // doesn't fit any category
    }

    results.push({
      ticker:         t.ticker,
      price:          t.currentPrice,
      changePercent:  t.changePercent,
      gapPercent:     t.gapPercent,
      relativeVolume: t.relativeVolume,
      float:          t.float,
      volume:         t.volume,
      highOfDay:      t.highOfDay,
      week52High,
      distTo52wHigh,
      category,
      exchange:       t.exchange,
    });
  }

  // Sort: SQUEEZE first, then by change %
  const catOrder: Record<PennyResult['category'], number> = { SQUEEZE: 0, HOD: 1, '52WK': 2 };
  results.sort((a, b) =>
    catOrder[a.category] !== catOrder[b.category]
      ? catOrder[a.category] - catOrder[b.category]
      : Math.abs(b.changePercent) - Math.abs(a.changePercent),
  );

  return results;
}
