// Frontend mirror of backend types (serialized form — no Date objects)

export interface GapResult {
  rank: number; ticker: string; price: number; gapPercent: number;
  float: number | null; volume: number; relativeVolume: number;
  changeFromOpen: number; qualityScore: number; direction: 'UP' | 'DOWN';
  prevClose: number; openPrice: number; exchange: string | null;
  latestNews?: NewsItem | null; hasS3?: boolean;
  dailyGrade?: string; ema200?: number; ema200Dist?: number;
  ema9?: number; ema20?: number; emaArrow?: string;
  stockType?: string; momoInfo?: MomoInfo | null;
}

export interface MomentumResult {
  ticker: string; price: number; changePercent: number; relativeVolume: number;
  float: number | null; volume: number; distanceFromHigh: number;
  highOfDay: number; aboveVWAP: boolean; vwap: number;
  triggerType: 'NEW_HIGH' | 'LOW_FLOAT_BOUNCE' | 'BREAKOUT';
  exchange: string | null; isMomo?: boolean; momoInfo?: MomoInfo | null;
}

export interface ReversalResult {
  ticker: string; price: number; direction: 'TOP' | 'BOTTOM';
  setupType: string; consecutiveCandles5m: number; consecutiveCandles1m: number;
  rsi2: number; bollingerBands: { upper: number; middle: number; lower: number };
  outsideBand: boolean; candlePattern: string | null;
  multiTimeframeAlignment: boolean; changePercent: number;
}

export interface MikeLargeCapResult {
  ticker: string; price: number; gapPercent: number; float: number | null;
  volume: number; relativeVolume: number; avgVol20d: number; atrPct: number;
  isSweetSpot: boolean; aboveDailySMA200: boolean; aboveDailySMA100: boolean;
  aboveDailyEMA20: boolean; rsvsSPY: number; spyGapPct: number;
  leadsSpyLong: boolean; leadsSpyShort: boolean; convictionScore: number;
  exchange: string | null; vwap: number | null;
  vwapPosition: 'ABOVE' | 'BELOW' | null; vwapSignal: string | null;
}

export interface HodMomoResult {
  ticker: string; price: number; changePercent: number; relativeVolume: number;
  float: number | null; volume: number; highOfDay: number;
  distanceFromHigh: number; aboveVWAP: boolean; vwap: number;
  tier: 'SMALL_CAP' | 'MID_CAP' | 'PENNY'; exchange: string | null;
}

export interface FivePillarResult {
  ticker: string; price: number; gapPercent: number; float: number | null;
  relativeVolume: number; volume: number; hasNewsCatalyst: boolean;
  catalystType: string | null; pillarScore: number;
  pillars: { gap: boolean; float: boolean; price: boolean; relVol: boolean; news: boolean };
  latestNews: NewsItem | null; exchange: string | null;
}

export interface PennyResult {
  ticker: string; price: number; changePercent: number; gapPercent: number;
  relativeVolume: number; float: number | null; volume: number;
  highOfDay: number; week52High: number | null; distTo52wHigh: number | null;
  category: 'HOD' | '52WK' | 'SQUEEZE'; exchange: string | null;
}

export interface TopListEntry {
  rank: number; ticker: string; price: number; changePercent: number;
  gapPercent: number; relativeVolume: number; volume: number;
  float: number | null; exchange: string | null;
}

export interface TopListsResult {
  topGappers: TopListEntry[]; topRvol: TopListEntry[]; afterHours: TopListEntry[];
}

export interface EarningsResult {
  ticker: string; price: number; gapPercent: number; relativeVolume: number;
  volume: number; float: number | null; latestNews: NewsItem | null;
  earningsKeyword: string; exchange: string | null;
}

export interface VolatilityHunterResult {
  ticker: string; price: number; changePercent: number;
  atrExpansion: number; relativeVolume: number; float: number | null;
  exchange: string | null;
}

export interface MomoInfo { date: string; pct: number; daysAgo: number; }

export interface CatalystInfo { type: string; strength: string; }

export interface NewsItem {
  id: string; publishedUtc: string; title: string; description: string;
  articleUrl: string; imageUrl: string | null; publisher: string;
  tickers: string[]; catalyst: CatalystInfo;
}

export interface ScanData {
  timestamp: string;
  gappersUp:   GapResult[];
  gappersDown: GapResult[];
  momentum:    MomentumResult[];
  reversals:   ReversalResult[];
  news:        Record<string, NewsItem[]>;
  s3Flags:     string[];
  mikeLargeCaps?:   MikeLargeCapResult[];
  mikeSpyGapPct?:   number;
  mikeScanDurationMs?: number;
  hodMomo?:          HodMomoResult[];
  fivePillar?:       FivePillarResult[];
  pennyResults?:     PennyResult[];
  topLists?:         TopListsResult;
  earnings?:         EarningsResult[];
  volatilityHunter?: VolatilityHunterResult[];
  refreshIntervalSeconds: number;
  meta: {
    totalSnapshotTickers: number;
    filteredTickers: number;
    scanDurationMs: number;
    apiCallsThisCycle: number;
  };
}
