// ============================================================
// SCANNER CONFIGURATION — edit thresholds here
// ============================================================

export const SCANNER_CONFIG = {
  // ── Gap Scanner ────────────────────────────────────────────
  gap: {
    minGapPercent: 5,        // minimum absolute gap % (up or down)
    minPrice: 0.50,          // minimum stock price
    minVolume: 5_000,        // minimum today's shares traded
    topN: 15,                // max results per direction
  },

  // ── High Day Momentum Scanner ──────────────────────────────
  momentum: {
    minChangePercent: 10,    // minimum intraday % move from prev close
    minRelativeVolume: 2,    // minimum relative volume vs 30-day avg
    maxFloat: 100_000_000,   // max float (100M shares)
    preferFloat: 10_000_000, // "prefer" float tier (10M)
    minPrice: 1.50,
    maxPrice: 20,
    newHighThreshold: 0.01,  // within 1% of HoD = NEW HIGH trigger
    bounceThreshold: 0.20,   // within 20% of HoD = BOUNCE trigger
  },

  // ── Reversal Scanner ──────────────────────────────────────
  reversal: {
    setup1ConsecutiveCandles5m: 5,   // consecutive 5-min candles for Setup 1
    setup2ConsecutiveCandles1m: 10,  // consecutive 1-min candles for Setup 2
    rsiOverbought: 90,
    rsiOversold: 10,
    rsiPeriod: 2,
    bollingerPeriod: 20,
    bollingerStdDev: 2,
    maxCandlesToFetch: 100,   // look-back window for candle analysis
    topCandidatesForReversal: 10, // only run reversal on top N momentum stocks
  },

  // ── System ────────────────────────────────────────────────
  refresh: {
    intervalSeconds: 30,
  },

  api: {
    cacheTTLMs: 5 * 60 * 1000,       // 5 min cache for float/avg volume
    maxConcurrentEnrich: 8,           // parallel enrichment calls
    avgVolumeDays: 30,                // days for average volume calc
    enrichTopN: 30,                   // enrich this many gap/momentum candidates
  },

  web: {
    port: parseInt(process.env.PORT ?? '3000', 10),
  },
} as const;

// ── Quality Score thresholds ──────────────────────────────────
export const QUALITY_SCORE_CONFIG = {
  gap: {
    // [threshold%, points]
    levels: [
      [50, 25],
      [30, 20],
      [20, 15],
      [10, 10],
      [5,  5],
    ] as [number, number][],
  },
  float: {
    // [max shares, points]
    levels: [
      [2_000_000,  25],
      [5_000_000,  22],
      [10_000_000, 18],
      [50_000_000, 10],
    ] as [number, number][],
  },
  preMarketVolume: {
    // [min shares, points]
    levels: [
      [1_000_000, 20],
      [500_000,   16],
      [100_000,   10],
    ] as [number, number][],
  },
  priceRange: {
    premium: { min: 1.50, max: 10,  points: 15 },
    standard: { min: 0.50, max: 20, points: 10 },
  },
  relativeVolume: {
    // [min ratio, points]
    levels: [
      [10, 15],
      [5,  12],
      [2,  10],
    ] as [number, number][],
  },
} as const;

// ── Mike's Large Cap Scanner ──────────────────────────────────
export const MIKE_CONFIG = {
  priceMin:        20,
  priceSweetMin:   40,
  priceSweetMax:   70,
  gapPctMin:       3.0,
  premarketVolMin: 100_000,
  relVolMin:       2.0,
  floatMax:        500_000_000,
  avgVolMin:       500_000,
  atrPctMin:       1.5,
  smaPeriod200:    200,
  smaPeriod100:    100,
  emaPeriod20:     20,
  atrPeriod:       14,
  topNForVwap:     5,
} as const;

// ── OTC / excluded exchange identifiers ───────────────────────
export const EXCLUDED_MARKETS = new Set(['otc']);

// Allowed primary exchanges (MIC codes used by Polygon)
export const LISTED_EXCHANGES = new Set([
  'XNYS', // NYSE
  'XNAS', // NASDAQ
  'XASE', // NYSE American (AMEX)
  'ARCX', // NYSE Arca
  'BATS', // Cboe BZX
  'XCBO', // Cboe
  'IEXG', // IEX
  'EPRL', // MIAX Pearl Equities
]);
