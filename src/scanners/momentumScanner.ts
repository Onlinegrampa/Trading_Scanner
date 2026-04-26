import { SCANNER_CONFIG } from '../config';
import { isLikelyListedStock, buildEnrichedTicker, PolygonClient } from '../api/polygon';
import { detectFormerMomoInfo } from '../analysis/dailyChart';
import type { PolygonSnapshotTicker, MomentumResult, EnrichedTicker } from '../types';

// ── Determine trigger type ────────────────────────────────────

function getTriggerType(t: EnrichedTicker): MomentumResult['triggerType'] {
  const distFromHigh =
    t.highOfDay > 0 ? (t.highOfDay - t.currentPrice) / t.highOfDay : 1;

  if (distFromHigh <= SCANNER_CONFIG.momentum.newHighThreshold) {
    return 'NEW_HIGH';
  }
  if (
    t.float !== null &&
    t.float < 10_000_000 &&
    distFromHigh <= SCANNER_CONFIG.momentum.bounceThreshold
  ) {
    return 'LOW_FLOAT_BOUNCE';
  }
  return 'BREAKOUT';
}

// ── Pre-filter ────────────────────────────────────────────────

function passesPreFilter(snap: PolygonSnapshotTicker): boolean {
  const cfg = SCANNER_CONFIG.momentum;
  if (!isLikelyListedStock(snap.ticker)) return false;

  const price = snap.lastTrade?.p || snap.min?.c || snap.day?.c || 0;
  if (price < cfg.minPrice || price > cfg.maxPrice) return false;

  // Intraday change from prev close
  if (Math.abs(snap.todaysChangePerc ?? 0) < cfg.minChangePercent) return false;

  return true;
}

// ── Main scanner ──────────────────────────────────────────────

export async function runMomentumScanner(
  snapshots: PolygonSnapshotTicker[],
  client: PolygonClient,
): Promise<MomentumResult[]> {
  const cfg = SCANNER_CONFIG.momentum;

  const candidates = snapshots.filter(passesPreFilter);

  // Sort by change %, take top for enrichment
  candidates.sort(
    (a, b) =>
      Math.abs(b.todaysChangePerc ?? 0) - Math.abs(a.todaysChangePerc ?? 0),
  );
  const topCandidates = candidates.slice(0, SCANNER_CONFIG.api.enrichTopN);

  // Enrich
  const enrichMap = await client.enrichTickers(topCandidates.map(s => s.ticker));

  const enriched: EnrichedTicker[] = topCandidates
    .map(snap => {
      const e = enrichMap.get(snap.ticker) ?? {
        float: null,
        avgVolume: null,
        exchange: null,
        isOTC: false,
      };
      return buildEnrichedTicker(snap, e);
    })
    .filter(t => !t.isOTC);

  // Apply float and relative volume filters now that we have data
  const results: MomentumResult[] = [];

  for (const t of enriched) {
    if (t.float !== null && t.float > cfg.maxFloat) continue;
    if (t.relativeVolume < cfg.minRelativeVolume) continue;

    const distanceFromHigh =
      t.highOfDay > 0
        ? ((t.highOfDay - t.currentPrice) / t.highOfDay) * 100
        : 0;

    results.push({
      ticker: t.ticker,
      price: t.currentPrice,
      changePercent: t.changePercent,
      relativeVolume: t.relativeVolume,
      float: t.float,
      volume: t.volume,
      distanceFromHigh,
      highOfDay: t.highOfDay,
      aboveVWAP: t.aboveVWAP,
      vwap: t.vwap,
      triggerType: getTriggerType(t),
      exchange: t.exchange,
    });
  }

  // Sort by change % descending
  results.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

  // Fetch daily candles for former-momo detection (session-cached — essentially free after gap scanner warms them)
  const dailyMap = await client.batchGetDailyCandles(results.map(r => r.ticker));
  for (const r of results) {
    const candles  = dailyMap.get(r.ticker) ?? [];
    const momoInfo = detectFormerMomoInfo(candles);
    r.isMomo   = momoInfo !== null;
    r.momoInfo = momoInfo;
  }

  return results;
}
