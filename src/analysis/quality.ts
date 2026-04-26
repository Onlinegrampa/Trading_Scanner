import { QUALITY_SCORE_CONFIG } from '../config';
import type { EnrichedTicker } from '../types';

// ── Quality Score (0–100) for gap scanner stocks ──────────────
// OTC stocks always score 0.

interface QualityBreakdown {
  total: number;
  gapPts: number;
  floatPts: number;
  preMarketVolPts: number;
  pricePts: number;
  relVolPts: number;
}

export function calcQualityScore(ticker: EnrichedTicker): QualityBreakdown {
  if (ticker.isOTC) {
    return { total: 0, gapPts: 0, floatPts: 0, preMarketVolPts: 0, pricePts: 0, relVolPts: 0 };
  }

  const absGap = Math.abs(ticker.gapPercent);

  // ── Gap size (0-25 pts) ──────────────────────────────────────
  let gapPts = 0;
  for (const [threshold, points] of QUALITY_SCORE_CONFIG.gap.levels) {
    if (absGap >= threshold) {
      gapPts = points;
      break;
    }
  }

  // ── Float (0-25 pts) ─────────────────────────────────────────
  let floatPts = 0;
  if (ticker.float !== null) {
    for (const [maxShares, points] of QUALITY_SCORE_CONFIG.float.levels) {
      if (ticker.float <= maxShares) {
        floatPts = points;
        break;
      }
    }
    // float > 50M → 0 pts (already initialised to 0)
  }

  // ── Pre-market volume proxy (0-20 pts) ────────────────────────
  // We use today's accumulated volume as a proxy since we don't have
  // dedicated pre-market aggregates in the snapshot endpoint.
  let preMarketVolPts = 0;
  const vol = ticker.volume;
  for (const [minVol, points] of QUALITY_SCORE_CONFIG.preMarketVolume.levels) {
    if (vol >= minVol) {
      preMarketVolPts = points;
      break;
    }
  }

  // ── Price range (0-15 pts) ────────────────────────────────────
  let pricePts = 0;
  const price = ticker.currentPrice;
  const { premium, standard } = QUALITY_SCORE_CONFIG.priceRange;
  if (price >= premium.min && price <= premium.max) {
    pricePts = premium.points;
  } else if (price >= standard.min && price <= standard.max) {
    pricePts = standard.points;
  }

  // ── Relative volume (0-15 pts) ────────────────────────────────
  let relVolPts = 0;
  for (const [minRatio, points] of QUALITY_SCORE_CONFIG.relativeVolume.levels) {
    if (ticker.relativeVolume >= minRatio) {
      relVolPts = points;
      break;
    }
  }

  const total = Math.min(100, gapPts + floatPts + preMarketVolPts + pricePts + relVolPts);

  return { total, gapPts, floatPts, preMarketVolPts, pricePts, relVolPts };
}

export function getScoreTotal(ticker: EnrichedTicker): number {
  return calcQualityScore(ticker).total;
}

// ── Score tier label ──────────────────────────────────────────

export function scoreTier(score: number): string {
  if (score >= 80) return 'A+';
  if (score >= 65) return 'A';
  if (score >= 50) return 'B';
  if (score >= 35) return 'C';
  return 'D';
}
