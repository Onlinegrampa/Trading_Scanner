import { isLikelyListedStock, buildEnrichedTicker, PolygonClient } from '../api/polygon';
import type { PolygonSnapshotTicker, EarningsResult, NewsItem } from '../types';

const EARNINGS_KEYWORDS = [
  'earnings', 'revenue', 'eps', 'q1', 'q2', 'q3', 'q4',
  'quarterly', 'annual report', 'guidance', 'beat', 'miss',
  'fiscal', 'profit', 'loss report', 'results',
];

function hasEarningsKeyword(article: NewsItem): string | null {
  const text = (article.title + ' ' + (article.description ?? '')).toLowerCase();
  return EARNINGS_KEYWORDS.find(kw => text.includes(kw)) ?? null;
}

function passesPreFilter(snap: PolygonSnapshotTicker): boolean {
  if (!isLikelyListedStock(snap.ticker)) return false;
  const price = snap.lastTrade?.p || snap.min?.c || snap.day?.c || 0;
  if (price < 50) return false;  // Large cap only
  const volume = snap.min?.av ?? snap.day?.v ?? 0;
  if (volume < 100_000) return false;
  return true;
}

export async function runEarningsScanner(
  snapshots: PolygonSnapshotTicker[],
  client: PolygonClient,
  newsMap: Record<string, NewsItem[]>,
): Promise<EarningsResult[]> {
  // Pre-filter: price > $50 + has any news
  const candidates = snapshots.filter(snap => {
    if (!passesPreFilter(snap)) return false;
    return (newsMap[snap.ticker] ?? []).length > 0;
  });

  candidates.sort(
    (a, b) => Math.abs(b.todaysChangePerc ?? 0) - Math.abs(a.todaysChangePerc ?? 0),
  );

  const top = candidates.slice(0, 40);
  const enrichMap = await client.enrichTickers(top.map(s => s.ticker));

  const results: EarningsResult[] = [];

  for (const snap of top) {
    const e = enrichMap.get(snap.ticker) ?? { float: null, avgVolume: null, exchange: null, isOTC: false };
    if (e.isOTC) continue;
    const t = buildEnrichedTicker(snap, e);

    // Find first article with an earnings keyword
    const articles = newsMap[t.ticker] ?? [];
    let matchedArticle: NewsItem | null = null;
    let matchedKeyword: string | null = null;

    for (const article of articles) {
      const kw = hasEarningsKeyword(article);
      if (kw) { matchedArticle = article; matchedKeyword = kw; break; }
    }

    if (!matchedArticle || !matchedKeyword) continue;

    results.push({
      ticker:          t.ticker,
      price:           t.currentPrice,
      gapPercent:      t.gapPercent,
      relativeVolume:  t.relativeVolume,
      volume:          t.volume,
      float:           t.float,
      latestNews:      matchedArticle,
      earningsKeyword: matchedKeyword,
      exchange:        t.exchange,
    });
  }

  results.sort((a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent));
  return results;
}
