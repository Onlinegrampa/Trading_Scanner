// ============================================================
// Shared TypeScript interfaces
// ============================================================

// ── Polygon API raw shapes ────────────────────────────────────

export interface PolygonSnapshotDay {
  o: number;   // open
  h: number;   // high
  l: number;   // low
  c: number;   // close
  v: number;   // volume
  vw: number;  // vwap
}

export interface PolygonSnapshotTicker {
  ticker: string;
  day: PolygonSnapshotDay;
  prevDay: PolygonSnapshotDay & { o: number };
  lastTrade: { p: number; s: number; t: number };
  lastQuote: { P: number; S: number; p: number; s: number };
  min: {
    av: number; // accumulated volume today
    c: number;
    h: number;
    l: number;
    o: number;
    v: number;
    vw: number;
  };
  todaysChange: number;
  todaysChangePerc: number;
  updated: number;
}

export interface PolygonAggBar {
  t: number;  // timestamp ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
  n?: number; // number of trades
}

export interface PolygonTickerDetails {
  ticker: string;
  name: string;
  market: string;
  locale: string;
  primary_exchange?: string;
  type?: string;
  active?: boolean;
  share_class_shares_outstanding?: number;
  weighted_shares_outstanding?: number;
  market_cap?: number;
}

// ── Enriched ticker ──────────────────────────────────────────

export interface EnrichedTicker {
  snapshot: PolygonSnapshotTicker;
  ticker: string;
  currentPrice: number;
  prevClose: number;
  openPrice: number;
  highOfDay: number;
  volume: number;            // today's accumulated volume
  gapPercent: number;        // (open - prevClose) / prevClose * 100
  changePercent: number;     // todaysChangePerc (current vs prevClose)
  changeFromOpen: number;    // (currentPrice - open) / open * 100
  float: number | null;
  avgVolume: number | null;  // 30-day average daily volume
  relativeVolume: number;    // volume / avgVolume (or vs prevDay if no avg)
  vwap: number;
  aboveVWAP: boolean;
  exchange: string | null;
  isOTC: boolean;
}

// ── Daily chart analysis ─────────────────────────────────────

export type DailyGrade = 'A+' | 'A' | 'B' | 'C' | 'D';
export type EMAArrow   = 'UP' | 'MIXED' | 'DOWN';
export type StockType  = 'BLUE_SKY' | 'IPO' | 'R/S' | 'FORMER_MOMO' | null;

export interface MomoInfo {
  date:    string;  // ISO date "YYYY-MM-DD" of the big-move day
  pct:     number;  // open→close % change on that day (e.g. 87.3 or -52.1)
  daysAgo: number;  // calendar days since that bar
}

// ── Scanner results ──────────────────────────────────────────

export interface GapResult {
  rank: number;
  ticker: string;
  price: number;
  gapPercent: number;
  float: number | null;
  volume: number;
  relativeVolume: number;
  changeFromOpen: number;
  qualityScore: number;
  direction: 'UP' | 'DOWN';
  prevClose: number;
  openPrice: number;
  exchange: string | null;
  // Populated post-scan in index.ts
  latestNews?: NewsItem | null;
  hasS3?: boolean;
  // Populated by daily chart analysis in gap scanner
  dailyGrade?: DailyGrade;
  ema200?: number;
  ema200Dist?: number;   // price − 200 EMA (positive = above)
  ema9?: number;
  ema20?: number;
  emaArrow?: EMAArrow;
  stockType?: StockType;
  momoInfo?: MomoInfo | null;
  dailyCandleCount?: number;
}

export interface MomentumResult {
  ticker: string;
  price: number;
  changePercent: number;
  relativeVolume: number;
  float: number | null;
  volume: number;
  distanceFromHigh: number;  // % below HoD
  highOfDay: number;
  aboveVWAP: boolean;
  vwap: number;
  triggerType: 'NEW_HIGH' | 'LOW_FLOAT_BOUNCE' | 'BREAKOUT';
  exchange: string | null;
  isMomo?: boolean;
  momoInfo?: MomoInfo | null;
}

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
}

export interface ReversalResult {
  ticker: string;
  price: number;
  direction: 'TOP' | 'BOTTOM';
  setupType: 'SETUP_1_5MIN' | 'SETUP_2_1MIN' | 'MULTI_TF';
  consecutiveCandles5m: number;
  consecutiveCandles1m: number;
  rsi2: number;
  bollingerBands: BollingerBands;
  outsideBand: boolean;
  candlePattern: string | null;
  multiTimeframeAlignment: boolean;
  changePercent: number;
}

// ── Phase 1 scanner result types ─────────────────────────────

export interface HodMomoResult {
  ticker:          string;
  price:           number;
  changePercent:   number;
  relativeVolume:  number;
  float:           number | null;
  volume:          number;
  highOfDay:       number;
  distanceFromHigh: number;
  aboveVWAP:       boolean;
  vwap:            number;
  tier:            'SMALL_CAP' | 'MID_CAP' | 'PENNY';
  exchange:        string | null;
}

export interface FivePillarResult {
  ticker:         string;
  price:          number;
  gapPercent:     number;
  float:          number | null;
  relativeVolume: number;
  volume:         number;
  hasNewsCatalyst: boolean;
  catalystType:   string | null;
  pillarScore:    number;  // 0–5
  pillars:        {
    gap:      boolean;
    float:    boolean;
    price:    boolean;
    relVol:   boolean;
    news:     boolean;
  };
  latestNews:     NewsItem | null;
  exchange:       string | null;
}

export interface PennyResult {
  ticker:         string;
  price:          number;
  changePercent:  number;
  gapPercent:     number;
  relativeVolume: number;
  float:          number | null;
  volume:         number;
  highOfDay:      number;
  week52High:     number | null;
  distTo52wHigh:  number | null;  // % below 52-week high
  category:       'HOD' | '52WK' | 'SQUEEZE';
  exchange:       string | null;
}

export interface TopListEntry {
  rank:           number;
  ticker:         string;
  price:          number;
  changePercent:  number;
  gapPercent:     number;
  relativeVolume: number;
  volume:         number;
  float:          number | null;
  exchange:       string | null;
}

export interface TopListsResult {
  topGappers:     TopListEntry[];
  topRvol:        TopListEntry[];
  afterHours:     TopListEntry[];
}

export interface EarningsResult {
  ticker:         string;
  price:          number;
  gapPercent:     number;
  relativeVolume: number;
  volume:         number;
  float:          number | null;
  latestNews:     NewsItem | null;
  earningsKeyword: string;
  exchange:       string | null;
}

export interface VolatilityHunterResult {
  ticker:         string;
  price:          number;
  changePercent:  number;
  atrExpansion:   number;   // ratio: current ATR / 14-period avg ATR
  relativeVolume: number;
  float:          number | null;
  exchange:       string | null;
}

export interface ScanResults {
  timestamp: Date;
  gappersUp: GapResult[];
  gappersDown: GapResult[];
  momentum: MomentumResult[];
  reversals: ReversalResult[];
  news: Record<string, NewsItem[]>;  // ticker → up to 3 articles
  s3Flags: string[];                  // tickers with active S-3 shelf registrations
  mikeLargeCaps?: MikeLargeCapResult[];
  mikeSpyGapPct?: number;
  mikeScanDurationMs?: number;
  // Phase 1 new scanners
  hodMomo?:          HodMomoResult[];
  fivePillar?:       FivePillarResult[];
  pennyResults?:     PennyResult[];
  topLists?:         TopListsResult;
  earnings?:         EarningsResult[];
  volatilityHunter?: VolatilityHunterResult[];
  meta: {
    totalSnapshotTickers: number;
    filteredTickers: number;
    scanDurationMs: number;
    apiCallsThisCycle: number;
  };
}

// ── Mike's Large Cap Scanner ──────────────────────────────────

export interface MikeLargeCapResult {
  ticker:           string;
  price:            number;
  gapPercent:       number;
  float:            number | null;
  volume:           number;
  relativeVolume:   number;
  avgVol20d:        number;
  atrPct:           number;
  isSweetSpot:      boolean;          // $40–$70 price range
  aboveDailySMA200: boolean;
  aboveDailySMA100: boolean;
  aboveDailyEMA20:  boolean;
  rsvsSPY:          number;           // stock gapPct − SPY gapPct
  spyGapPct:        number;           // SPY's own gap %
  leadsSpyLong:     boolean;          // gap > 0 AND rs > 0
  leadsSpyShort:    boolean;          // gap < 0 AND rs < 0
  convictionScore:  number;           // 0–5
  exchange:         string | null;
  vwap:             number | null;
  vwapPosition:     'ABOVE' | 'BELOW' | null;
  vwapSignal:       string | null;
}

// ── Technical analysis ───────────────────────────────────────

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
}

export type CandleColor = 'green' | 'red' | 'doji';

export type CandlePattern =
  | 'pin_bar'
  | 'doji'
  | 'topping_tail'
  | 'bottoming_tail'
  | 'hammer'
  | null;

// ── News & Catalyst ───────────────────────────────────────────

export type CatalystStrength = 'strong' | 'moderate' | 'negative' | 'neutral';

export interface CatalystInfo {
  type: string;
  strength: CatalystStrength;
}

export interface NewsItem {
  id: string;
  publishedUtc: string;   // ISO string — serializable
  title: string;
  description: string;
  articleUrl: string;
  imageUrl: string | null;
  publisher: string;
  tickers: string[];
  catalyst: CatalystInfo;
}

// ── Polygon news API raw shapes ───────────────────────────────

export interface PolygonNewsArticle {
  id: string;
  published_utc: string;
  title: string;
  description?: string;
  article_url: string;
  image_url?: string;
  publisher: { name: string };
  tickers: string[];
}
