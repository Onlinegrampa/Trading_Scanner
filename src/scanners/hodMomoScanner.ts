import { isLikelyListedStock, buildEnrichedTicker, PolygonClient } from '../api/polygon';
import type { PolygonSnapshotTicker, HodMomoResult, EnrichedTicker } from '../types';

// ── Tier definitions ──────────────────────────────────────────

type Tier = 'SMALL_CAP' | 'MID_CAP' | 'PENNY';

interface TierCfg {
  tier:       Tier;
  minPrice:   number;
  maxPrice:   number;
  minFloat:   number | null;
  maxFloat:   number | null;
  minRelVol:  number;
}

const TIERS: TierCfg[] = [
  {
    tier: 'PENNY',
    minPrice: 0.01, maxPrice: 2.00,
    minFloat: null, maxFloat: 10_000_000,
    minRelVol: 5.0,
  },
  {
    tier: 'SMALL_CAP',
    minPrice: 2.00, maxPrice: 20.00,
    minFloat: null, maxFloat: 20_000_000,
    minRelVol: 2.0,
  },
  {
    tier: 'MID_CAP',
    minPrice: 20.00, maxPrice: 50.00,
    minFloat: 20_000_000, maxFloat: 100_000_000,
    minRelVol: 2.0,
  },
];

// ── Pre-filter: any tier candidate ────────────────────────────

function passesPreFilter(snap: PolygonSnapshotTicker): boolean {
  if (!isLikelyListedStock(snap.ticker)) return false;
  const price = snap.lastTrade?.p || snap.min?.c || snap.day?.c || 0;
  if (price <= 0 || price > 50) return false;
  if (Math.abs(snap.todaysChangePerc ?? 0) < 5) return false;
  const volume = snap.min?.av ?? snap.day?.v ?? 0;
  if (volume < 10_000) return false;
  return true;
}

// ── Classify into tier (null = doesn't qualify) ───────────────

function classifyTier(t: EnrichedTicker): Tier | null {
  for (const cfg of TIERS) {
    if (t.currentPrice < cfg.minPrice || t.currentPrice > cfg.maxPrice) continue;
    if (cfg.minFloat !== null && (t.float === null || t.float < cfg.minFloat)) continue;
    if (cfg.maxFloat !== null && t.float !== null && t.float > cfg.maxFloat) continue;
    if (t.relativeVolume < cfg.minRelVol) continue;
    return cfg.tier;
  }
  return null;
}

// ── Main scanner ──────────────────────────────────────────────

export async function runHodMomoScanner(
  snapshots: PolygonSnapshotTicker[],
  client: PolygonClient,
): Promise<HodMomoResult[]> {
  const candidates = snapshots.filter(passesPreFilter);

  candidates.sort(
    (a, b) => Math.abs(b.todaysChangePerc ?? 0) - Math.abs(a.todaysChangePerc ?? 0),
  );

  const top = candidates.slice(0, 60);
  const enrichMap = await client.enrichTickers(top.map(s => s.ticker));

  const results: HodMomoResult[] = [];

  for (const snap of top) {
    const e = enrichMap.get(snap.ticker) ?? { float: null, avgVolume: null, exchange: null, isOTC: false };
    if (e.isOTC) continue;
    const t = buildEnrichedTicker(snap, e);

    const tier = classifyTier(t);
    if (!tier) continue;

    // Require near high-of-day (within 5%)
    const distFromHigh = t.highOfDay > 0
      ? ((t.highOfDay - t.currentPrice) / t.highOfDay) * 100
      : 100;
    if (distFromHigh > 5) continue;

    results.push({
      ticker:          t.ticker,
      price:           t.currentPrice,
      changePercent:   t.changePercent,
      relativeVolume:  t.relativeVolume,
      float:           t.float,
      volume:          t.volume,
      highOfDay:       t.highOfDay,
      distanceFromHigh: distFromHigh,
      aboveVWAP:       t.aboveVWAP,
      vwap:            t.vwap,
      tier,
      exchange:        t.exchange,
    });
  }

  results.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
  return results;
}
