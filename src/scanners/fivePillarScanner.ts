import { isLikelyListedStock, buildEnrichedTicker, PolygonClient } from '../api/polygon';
import type { PolygonSnapshotTicker, FivePillarResult, NewsItem } from '../types';

// ── Ross 5-Pillar criteria ────────────────────────────────────
// 1. Gap > 4%
// 2. Float < 20M shares
// 3. Price $2–$20
// 4. RelVol > 2.0
// 5. News catalyst within last 12 hours

const NEWS_WINDOW_MS = 12 * 60 * 60 * 1000;

function passesPreFilter(snap: PolygonSnapshotTicker): boolean {
  if (!isLikelyListedStock(snap.ticker)) return false;
  const price = snap.lastTrade?.p || snap.min?.c || snap.day?.c || 0;
  if (price < 2 || price > 20) return false;
  const prevClose = snap.prevDay?.c ?? 0;
  const open = snap.day?.o ?? 0;
  if (prevClose <= 0 || open <= 0) return false;
  const gap = ((open - prevClose) / prevClose) * 100;
  if (gap < 4) return false;
  return true;
}

export async function runFivePillarScanner(
  snapshots: PolygonSnapshotTicker[],
  client: PolygonClient,
  newsMap: Record<string, NewsItem[]>,
): Promise<FivePillarResult[]> {
  const candidates = snapshots.filter(passesPreFilter);

  candidates.sort((a, b) => {
    const gA = ((a.day.o - a.prevDay.c) / a.prevDay.c) * 100;
    const gB = ((b.day.o - b.prevDay.c) / b.prevDay.c) * 100;
    return gB - gA;
  });

  const top = candidates.slice(0, 50);
  const enrichMap = await client.enrichTickers(top.map(s => s.ticker));
  const now = Date.now();

  const results: FivePillarResult[] = [];

  for (const snap of top) {
    const e = enrichMap.get(snap.ticker) ?? { float: null, avgVolume: null, exchange: null, isOTC: false };
    if (e.isOTC) continue;
    const t = buildEnrichedTicker(snap, e);

    const gapOk   = t.gapPercent >= 4;
    const floatOk = t.float !== null && t.float < 20_000_000;
    const priceOk = t.currentPrice >= 2 && t.currentPrice <= 20;
    const rvolOk  = t.relativeVolume >= 2.0;

    // News catalyst check: any article in last 12 hours
    const articles = newsMap[t.ticker] ?? [];
    const recentArticle = articles.find(a => {
      const age = now - new Date(a.publishedUtc).getTime();
      return age >= 0 && age <= NEWS_WINDOW_MS;
    }) ?? null;
    const newsOk = recentArticle !== null;

    const pillars = { gap: gapOk, float: floatOk, price: priceOk, relVol: rvolOk, news: newsOk };
    const pillarScore = Object.values(pillars).filter(Boolean).length;

    // Only include tickers with at least 3 pillars
    if (pillarScore < 3) continue;

    results.push({
      ticker:          t.ticker,
      price:           t.currentPrice,
      gapPercent:      t.gapPercent,
      float:           t.float,
      relativeVolume:  t.relativeVolume,
      volume:          t.volume,
      hasNewsCatalyst: newsOk,
      catalystType:    recentArticle?.catalyst?.type ?? null,
      pillarScore,
      pillars,
      latestNews:      recentArticle,
      exchange:        t.exchange,
    });
  }

  // Sort: full 5-pillar first, then by gap %
  results.sort((a, b) =>
    b.pillarScore !== a.pillarScore
      ? b.pillarScore - a.pillarScore
      : b.gapPercent - a.gapPercent,
  );

  return results;
}
