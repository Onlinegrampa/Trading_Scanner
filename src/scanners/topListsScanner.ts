import { isLikelyListedStock, buildEnrichedTicker, PolygonClient } from '../api/polygon';
import type { PolygonSnapshotTicker, TopListsResult, TopListEntry } from '../types';

const AFTER_HOURS_START_UTC = 20 * 60; // 4:00 PM ET = 20:00 UTC

function isAfterHours(): boolean {
  const now = new Date();
  const minutesUTC = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutesUTC >= AFTER_HOURS_START_UTC || minutesUTC < 9 * 60; // after 4pm or before 9am ET
}

function passesPreFilter(snap: PolygonSnapshotTicker): boolean {
  if (!isLikelyListedStock(snap.ticker)) return false;
  const price = snap.lastTrade?.p || snap.min?.c || snap.day?.c || 0;
  if (price < 0.50) return false;
  const volume = snap.min?.av ?? snap.day?.v ?? 0;
  if (volume < 50_000) return false;
  return true;
}

export async function runTopListsScanner(
  snapshots: PolygonSnapshotTicker[],
  client: PolygonClient,
): Promise<TopListsResult> {
  const candidates = snapshots.filter(passesPreFilter);

  // Sort by change % (absolute) for initial cut
  const byChange = [...candidates].sort(
    (a, b) => Math.abs(b.todaysChangePerc ?? 0) - Math.abs(a.todaysChangePerc ?? 0),
  ).slice(0, 60);

  const enrichMap = await client.enrichTickers(byChange.map(s => s.ticker));

  const enriched = byChange
    .map(snap => {
      const e = enrichMap.get(snap.ticker) ?? { float: null, avgVolume: null, exchange: null, isOTC: false };
      return { snap, e, t: buildEnrichedTicker(snap, e) };
    })
    .filter(({ e }) => !e.isOTC);

  // ── Top Gappers: highest absolute gap %
  const topGappers: TopListEntry[] = enriched
    .filter(({ t }) => Math.abs(t.gapPercent) >= 5)
    .sort((a, b) => Math.abs(b.t.gapPercent) - Math.abs(a.t.gapPercent))
    .slice(0, 20)
    .map(({ t }, i) => toEntry(t, i + 1));

  // ── Top RVOL: highest relative volume
  const topRvol: TopListEntry[] = enriched
    .filter(({ t }) => t.relativeVolume >= 2)
    .sort((a, b) => b.t.relativeVolume - a.t.relativeVolume)
    .slice(0, 20)
    .map(({ t }, i) => toEntry(t, i + 1));

  // ── After-Hours Gainers: biggest movers; works even during market hours
  //    Uses todaysChangePerc which Polygon updates continuously
  const afterHours: TopListEntry[] = enriched
    .filter(({ t }) => t.changePercent > 0)
    .sort((a, b) => b.t.changePercent - a.t.changePercent)
    .slice(0, 20)
    .map(({ t }, i) => toEntry(t, i + 1));

  return { topGappers, topRvol, afterHours };
}

function toEntry(t: ReturnType<typeof buildEnrichedTicker>, rank: number): TopListEntry {
  return {
    rank,
    ticker:         t.ticker,
    price:          t.currentPrice,
    changePercent:  t.changePercent,
    gapPercent:     t.gapPercent,
    relativeVolume: t.relativeVolume,
    volume:         t.volume,
    float:          t.float,
    exchange:       t.exchange,
  };
}
