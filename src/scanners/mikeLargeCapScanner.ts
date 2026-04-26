import { MIKE_CONFIG } from '../config';
import { isLikelyListedStock, PolygonClient } from '../api/polygon';
import type { PolygonSnapshotTicker, PolygonAggBar, MikeLargeCapResult } from '../types';

// ── Technical helpers ─────────────────────────────────────────

function calcSMA(bars: PolygonAggBar[], period: number): number | null {
  if (bars.length < period) return null;
  const slice = bars.slice(-period);
  return slice.reduce((s, b) => s + b.c, 0) / period;
}

function calcEMA(bars: PolygonAggBar[], period: number): number | null {
  if (bars.length < period) return null;
  const k = 2 / (period + 1);
  let ema = bars.slice(0, period).reduce((s, b) => s + b.c, 0) / period;
  for (let i = period; i < bars.length; i++) {
    ema = bars[i].c * k + ema * (1 - k);
  }
  return ema;
}

function calcATRPct(bars: PolygonAggBar[], period: number, price: number): number {
  if (bars.length < period + 1 || price === 0) return 0;
  const trs: number[] = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    const prev = bars[i - 1].c;
    const tr = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - prev),
      Math.abs(bars[i].l - prev),
    );
    trs.push(tr);
  }
  const atr = trs.reduce((s, v) => s + v, 0) / period;
  return (atr / price) * 100;
}

function calcAvgVol20(bars: PolygonAggBar[]): number {
  if (bars.length === 0) return 0;
  const slice = bars.slice(-20);
  return slice.reduce((s, b) => s + b.v, 0) / slice.length;
}

function calcVWAP(bars: PolygonAggBar[]): number | null {
  if (bars.length === 0) return null;
  let sumPV = 0;
  let sumV = 0;
  for (const b of bars) {
    const typicalPrice = (b.h + b.l + b.c) / 3;
    sumPV += typicalPrice * b.v;
    sumV += b.v;
  }
  return sumV > 0 ? sumPV / sumV : null;
}

// ── Step 1: fast pre-filter ───────────────────────────────────

function filterMikeLargeCaps(snapshots: PolygonSnapshotTicker[]): PolygonSnapshotTicker[] {
  const cfg = MIKE_CONFIG;
  return snapshots.filter(snap => {
    if (!isLikelyListedStock(snap.ticker)) return false;

    const price = snap.lastTrade?.p || snap.min?.c || snap.day?.c || 0;
    if (price < cfg.priceMin) return false;

    const volume = snap.min?.av ?? snap.day?.v ?? 0;
    if (volume < cfg.premarketVolMin) return false;

    const prevClose = snap.prevDay?.c ?? 0;
    const open = snap.day?.o ?? 0;
    if (prevClose === 0 || open === 0) return false;

    const gapPct = Math.abs(((open - prevClose) / prevClose) * 100);
    if (gapPct < cfg.gapPctMin) return false;

    return true;
  });
}

// ── Step 2: enrich + compute technical fields ─────────────────

async function enrichMikeLargeCaps(
  candidates: PolygonSnapshotTicker[],
  client: PolygonClient,
): Promise<MikeLargeCapResult[]> {
  const cfg = MIKE_CONFIG;

  const enrichMap = await client.enrichTickers(candidates.map(s => s.ticker));
  const dailyMap  = await client.batchGetDailyCandles(candidates.map(s => s.ticker));

  const results: MikeLargeCapResult[] = [];

  for (const snap of candidates) {
    const e = enrichMap.get(snap.ticker);
    if (!e || e.isOTC) continue;

    const float = e.float;
    if (float !== null && float > cfg.floatMax) continue;

    const price = snap.lastTrade?.p || snap.min?.c || snap.day?.c || 0;
    const prevClose = snap.prevDay?.c ?? 0;
    const open = snap.day?.o ?? 0;
    const volume = snap.min?.av ?? snap.day?.v ?? 0;

    const gapPct = prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : 0;

    const bars = dailyMap.get(snap.ticker) ?? [];

    const avgVol20d = calcAvgVol20(bars);
    if (avgVol20d < cfg.avgVolMin) continue;

    const relativeVolume = avgVol20d > 0 ? volume / avgVol20d : 0;
    if (relativeVolume < cfg.relVolMin) continue;

    const atrPct = calcATRPct(bars, cfg.atrPeriod, price);
    if (atrPct < cfg.atrPctMin) continue;

    const sma200 = calcSMA(bars, cfg.smaPeriod200);
    const sma100 = calcSMA(bars, cfg.smaPeriod100);
    const ema20  = calcEMA(bars, cfg.emaPeriod20);

    results.push({
      ticker:           snap.ticker,
      price,
      gapPercent:       gapPct,
      float,
      volume,
      relativeVolume,
      avgVol20d,
      atrPct,
      isSweetSpot:      price >= cfg.priceSweetMin && price <= cfg.priceSweetMax,
      aboveDailySMA200: sma200 !== null ? price > sma200 : false,
      aboveDailySMA100: sma100 !== null ? price > sma100 : false,
      aboveDailyEMA20:  ema20  !== null ? price > ema20  : false,
      rsvsSPY:          0,   // filled in addRelativeStrengthVsSPY
      spyGapPct:        0,   // filled in addRelativeStrengthVsSPY
      leadsSpyLong:     false,
      leadsSpyShort:    false,
      convictionScore:  0,   // filled in scoreResults
      exchange:         e.exchange,
      vwap:             null,
      vwapPosition:     null,
      vwapSignal:       null,
    });
  }

  return results;
}

// ── Step 3: relative strength vs SPY ─────────────────────────

function addRelativeStrengthVsSPY(
  results: MikeLargeCapResult[],
  snapshots: PolygonSnapshotTicker[],
): void {
  const spySnap = snapshots.find(s => s.ticker === 'SPY');
  const spyGapPct =
    spySnap && spySnap.prevDay?.c && spySnap.day?.o
      ? ((spySnap.day.o - spySnap.prevDay.c) / spySnap.prevDay.c) * 100
      : 0;

  for (const r of results) {
    r.spyGapPct    = spyGapPct;
    r.rsvsSPY      = r.gapPercent - spyGapPct;
    r.leadsSpyLong  = r.gapPercent > 0 && r.rsvsSPY > 0;
    r.leadsSpyShort = r.gapPercent < 0 && r.rsvsSPY < 0;
  }
}

// ── Step 4: VWAP status (top N only) ─────────────────────────

async function addVWAPStatus(
  results: MikeLargeCapResult[],
  client: PolygonClient,
): Promise<void> {
  const cfg = MIKE_CONFIG;
  const topN = results.slice(0, cfg.topNForVwap);

  await Promise.all(
    topN.map(async r => {
      try {
        const bars = await client.getIntradayCandles(r.ticker, 1, 'minute');
        const vwap = calcVWAP(bars);
        if (vwap === null) return;

        r.vwap = vwap;
        r.vwapPosition = r.price >= vwap ? 'ABOVE' : 'BELOW';
        if (r.vwapPosition === 'ABOVE') {
          r.vwapSignal = r.leadsSpyLong ? 'LONG CONFIRM' : 'ABOVE VWAP';
        } else {
          r.vwapSignal = r.leadsSpyShort ? 'SHORT CONFIRM' : 'BELOW VWAP';
        }
      } catch {
        // leave nulls
      }
    }),
  );
}

// ── Step 5: conviction scoring ────────────────────────────────

function scoreResults(results: MikeLargeCapResult[]): void {
  for (const r of results) {
    let score = 0;
    if (r.relativeVolume > 5)    score++;
    if (r.isSweetSpot)           score++;
    if (r.aboveDailySMA200)      score++;
    if (r.leadsSpyLong || r.leadsSpyShort) score++;
    if (Math.abs(r.gapPercent) > 7) score++;
    r.convictionScore = score;
  }
}

// ── Master scanner ────────────────────────────────────────────

export async function runMikeLargeCapScanner(
  snapshots: PolygonSnapshotTicker[],
  client: PolygonClient,
): Promise<MikeLargeCapResult[]> {
  // Step 1: fast pre-filter
  const candidates = filterMikeLargeCaps(snapshots);
  if (candidates.length === 0) return [];

  // Step 2: enrich + technical filters
  let results = await enrichMikeLargeCaps(candidates, client);
  if (results.length === 0) return [];

  // Step 3: sort by |gap%| descending before RS/VWAP
  results.sort((a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent));

  // Step 4: relative strength vs SPY (free — uses existing snapshots)
  addRelativeStrengthVsSPY(results, snapshots);

  // Step 5: conviction scoring (before VWAP so topN is by score-ready rank)
  scoreResults(results);

  // Re-sort by conviction desc, then gap% desc
  results.sort((a, b) =>
    b.convictionScore !== a.convictionScore
      ? b.convictionScore - a.convictionScore
      : Math.abs(b.gapPercent) - Math.abs(a.gapPercent),
  );

  // Step 6: VWAP for top N (intraday API calls)
  await addVWAPStatus(results, client);

  return results;
}
