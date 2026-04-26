import { SCANNER_CONFIG } from '../config';
import { isLikelyListedStock, buildEnrichedTicker, PolygonClient } from '../api/polygon';
import { getScoreTotal } from '../analysis/quality';
import { analyzeDailyChart, dailyGradeBonus } from '../analysis/dailyChart';
import type { PolygonSnapshotTicker, GapResult, EnrichedTicker } from '../types';

// ── Filters ───────────────────────────────────────────────────

function passesPreFilter(snap: PolygonSnapshotTicker): boolean {
  const cfg = SCANNER_CONFIG.gap;

  if (!isLikelyListedStock(snap.ticker)) return false;

  const price = snap.lastTrade?.p || snap.min?.c || snap.day?.c || 0;
  if (price < cfg.minPrice) return false;

  const volume = snap.min?.av ?? snap.day?.v ?? 0;
  if (volume < cfg.minVolume) return false;

  const prevClose = snap.prevDay?.c ?? 0;
  const open = snap.day?.o ?? 0;
  if (prevClose === 0 || open === 0) return false;

  const gapPct = ((open - prevClose) / prevClose) * 100;
  if (Math.abs(gapPct) < cfg.minGapPercent) return false;

  return true;
}

// ── Main scanner ──────────────────────────────────────────────

export async function runGapScanner(
  snapshots: PolygonSnapshotTicker[],
  client: PolygonClient,
): Promise<{ gappersUp: GapResult[]; gappersDown: GapResult[] }> {
  const cfg = SCANNER_CONFIG.gap;

  // Step 1: fast pre-filter (no API calls)
  const candidates = snapshots.filter(passesPreFilter);

  // Step 2: sort by absolute gap, take top N*2 for enrichment
  candidates.sort((a, b) => {
    const gapA = Math.abs(((a.day.o - a.prevDay.c) / a.prevDay.c) * 100);
    const gapB = Math.abs(((b.day.o - b.prevDay.c) / b.prevDay.c) * 100);
    return gapB - gapA;
  });

  const topCandidates = candidates.slice(0, SCANNER_CONFIG.api.enrichTopN * 2);

  // Step 3: enrich top candidates with float, avg volume, exchange
  const enrichMap = await client.enrichTickers(topCandidates.map(s => s.ticker));

  // Step 4: build EnrichedTicker objects, filter out OTC
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

  // Step 5: compute quality scores and split by direction
  const gappersUp: GapResult[] = [];
  const gappersDown: GapResult[] = [];

  for (const t of enriched) {
    const direction = t.gapPercent >= 0 ? 'UP' : 'DOWN';
    const result: GapResult = {
      rank: 0,
      ticker: t.ticker,
      price: t.currentPrice,
      gapPercent: t.gapPercent,
      float: t.float,
      volume: t.volume,
      relativeVolume: t.relativeVolume,
      changeFromOpen: t.changeFromOpen,
      qualityScore: getScoreTotal(t),
      direction,
      prevClose: t.prevClose,
      openPrice: t.openPrice,
      exchange: t.exchange,
    };

    if (direction === 'UP') gappersUp.push(result);
    else gappersDown.push(result);
  }

  // Step 6: sort and rank
  const sortAndRank = (arr: GapResult[]) => {
    arr.sort((a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent));
    return arr.slice(0, cfg.topN).map((r, i) => ({ ...r, rank: i + 1 }));
  };

  const rankedUp   = sortAndRank(gappersUp);
  const rankedDown = sortAndRank(gappersDown);
  const allRanked  = [...rankedUp, ...rankedDown];

  // Step 7: fetch daily candles for all ranked tickers (session-cached after first fetch)
  const dailyMap = await client.batchGetDailyCandles(allRanked.map(r => r.ticker));

  for (const r of allRanked) {
    const candles = dailyMap.get(r.ticker) ?? [];
    const d = analyzeDailyChart(candles, r.price);
    r.dailyGrade      = d.grade;
    r.ema200          = d.ema200;
    r.ema200Dist      = d.ema200Dist;
    r.ema9            = d.ema9;
    r.ema20           = d.ema20;
    r.emaArrow        = d.emaArrow;
    r.stockType       = d.stockType;
    r.momoInfo        = d.momoInfo;
    r.dailyCandleCount = d.candleCount;
    // Apply daily grade bonus/penalty to quality score
    r.qualityScore = Math.max(0, r.qualityScore + dailyGradeBonus(d.grade));
  }

  return { gappersUp: rankedUp, gappersDown: rankedDown };
}
