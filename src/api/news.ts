import axios, { AxiosInstance } from 'axios';
import { classifyHeadline } from '../analysis/catalyst';
import type { NewsItem, PolygonNewsArticle } from '../types';

// ── TTL cache (inline copy — same logic as polygon.ts) ────────

class TTLCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expiresAt) { this.store.delete(key); return undefined; }
    return e.value;
  }
}

// ── Simple concurrency limiter ─────────────────────────────────

class Limiter {
  private queue: Array<() => void> = [];
  private running = 0;
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const exec = async () => {
        this.running++;
        try { resolve(await fn()); } catch (e) { reject(e); }
        finally {
          this.running--;
          const next = this.queue.shift();
          if (next) next();
        }
      };
      if (this.running < this.max) exec();
      else this.queue.push(exec);
    });
  }
}

// ── Cache TTLs ─────────────────────────────────────────────────
const NEWS_TTL_MS  = 2 * 60 * 1000;           // 2 minutes
const S3_TTL_MS    = 365 * 24 * 60 * 60 * 1000; // effectively session-permanent

// ── NewsClient ─────────────────────────────────────────────────

export class NewsClient {
  private readonly http: AxiosInstance;
  private readonly newsCache = new TTLCache<NewsItem[]>();
  private readonly s3Cache   = new TTLCache<boolean>();
  private readonly limiter   = new Limiter(6);

  constructor(private readonly apiKey: string) {
    this.http = axios.create({
      baseURL: 'https://api.polygon.io',
      timeout: 10_000,
    });
  }

  // ── Fetch up to `limit` articles for one ticker ───────────

  async getTickerNews(ticker: string, limit = 3): Promise<NewsItem[]> {
    const cached = this.newsCache.get(ticker);
    if (cached !== undefined) return cached;

    return this.limiter.run(async () => {
      try {
        // 48-hour lookback
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const res = await this.http.get<{ results: PolygonNewsArticle[] }>(
          '/v2/reference/news',
          {
            params: {
              ticker,
              limit,
              order: 'desc',
              sort: 'published_utc',
              'published_utc.gte': since,
              apiKey: this.apiKey,
            },
          },
        );
        const items = (res.data.results ?? []).map(a => this.mapArticle(a));
        this.newsCache.set(ticker, items, NEWS_TTL_MS);
        return items;
      } catch {
        this.newsCache.set(ticker, [], NEWS_TTL_MS);
        return [];
      }
    });
  }

  // ── Batch fetch ───────────────────────────────────────────

  async batchGetNews(tickers: string[]): Promise<Record<string, NewsItem[]>> {
    const unique = [...new Set(tickers)];
    await Promise.all(unique.map(t => this.getTickerNews(t)));
    const result: Record<string, NewsItem[]> = {};
    for (const t of unique) {
      result[t] = this.newsCache.get(t) ?? [];
    }
    return result;
  }

  // ── SEC EDGAR S-3 shelf registration check ────────────────
  // Searches EDGAR full-text index for S-3/S-3A filings mentioning ticker.
  // Returns false on any error (graceful degradation).

  async hasShelfRegistration(ticker: string): Promise<boolean> {
    const cached = this.s3Cache.get(ticker);
    if (cached !== undefined) return cached;

    return this.limiter.run(async () => {
      try {
        const end   = new Date().toISOString().split('T')[0];
        const start = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0];

        const res = await axios.get<{ hits: { total: { value: number } } }>(
          'https://efts.sec.gov/LATEST/search-index',
          {
            params: {
              q: `"${ticker}"`,
              forms: 'S-3,S-3/A',
              dateRange: 'custom',
              startdt: start,
              enddt: end,
            },
            timeout: 6_000,
            headers: {
              'User-Agent': 'ross-scanner/1.0 contact@example.com',
              Accept: 'application/json',
            },
          },
        );

        const hasS3 = (res.data?.hits?.total?.value ?? 0) > 0;
        this.s3Cache.set(ticker, hasS3, S3_TTL_MS);
        return hasS3;
      } catch {
        // Gracefully degrade — never flag S3 on error
        this.s3Cache.set(ticker, false, NEWS_TTL_MS); // short TTL so it retries
        return false;
      }
    });
  }

  // ── Batch S3 check ────────────────────────────────────────

  async batchCheckS3(tickers: string[]): Promise<string[]> {
    const unique = [...new Set(tickers)];
    const results = await Promise.all(
      unique.map(async t => ({ t, has: await this.hasShelfRegistration(t) })),
    );
    // Deduplicate result array
    return [...new Set(results.filter(r => r.has).map(r => r.t))];
  }

  // ── Map Polygon article → NewsItem ────────────────────────

  private mapArticle(raw: PolygonNewsArticle): NewsItem {
    // Truncate description to keep SSE payload lean
    const description = (raw.description ?? '').slice(0, 250);
    return {
      id:           raw.id,
      publishedUtc: raw.published_utc,
      title:        raw.title,
      description,
      articleUrl:   raw.article_url,
      imageUrl:     raw.image_url ?? null,
      publisher:    raw.publisher?.name ?? '',
      tickers:      raw.tickers ?? [],
      catalyst:     classifyHeadline(raw.title, description),
    };
  }
}
