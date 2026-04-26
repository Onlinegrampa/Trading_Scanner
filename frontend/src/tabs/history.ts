interface HistoryEntry {
  timestamp: string;
  ticker: string;
  source: string;
  price: number;
  gapPercent: number | null;
  changePercent: number | null;
  relativeVolume: number | null;
  qualityScore: number | null;
}

interface SummaryResponse {
  freq: Array<{ ticker: string; count: number; sources: string }>;
  range: { firstDate: string; lastDate: string; totalEntries: number };
  todayTotal: number;
  weekStart: string;
  today: string;
}

export async function loadHistorySummary() {
  try {
    const res = await fetch('/api/history/summary');
    if (!res.ok) return;
    const data = await res.json() as SummaryResponse;
    const el = document.getElementById('historySummary');
    if (!el) return;
    const { firstDate, lastDate, totalEntries } = data.range;
    el.textContent = `${totalEntries.toLocaleString()} records · ${firstDate} → ${lastDate}`;
    el.style.display = '';
  } catch {}
}

function localDateStr(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildParams(period: string, tickerFilter?: string, from?: string, to?: string): URLSearchParams {
  const p = new URLSearchParams();
  if (tickerFilter) p.set('ticker', tickerFilter);

  if (period === 'today') {
    p.set('today', '');
  } else if (period === 'week') {
    const d = new Date();
    const dow = d.getDay();
    const monOff = dow === 0 ? 6 : dow - 1;
    d.setDate(d.getDate() - monOff);
    p.set('from', localDateStr(d));
    p.set('to', localDateStr(new Date()));
  } else if (period === 'range' && from && to) {
    p.set('from', from);
    p.set('to', to);
  }
  // 'all' — no date filter

  p.set('limit', '500');
  return p;
}

export async function loadHistoryData(period: string, tickerFilter?: string, from?: string, to?: string) {
  const container = document.getElementById('historyTableContainer')!;
  container.innerHTML = '<div class="empty-state" style="padding:16px">Loading...</div>';

  try {
    const params = buildParams(period, tickerFilter, from, to);
    const res = await fetch('/api/history?' + params.toString());
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json() as HistoryEntry[];

    const totalBadge = document.getElementById('historyTotalBadge');
    if (totalBadge) totalBadge.textContent = String(data.length);

    if (!data || data.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:16px">No history found for this period.</div>';
      return;
    }

    const srcBadge = (src: string) => {
      const cls = src === 'gap' ? 'badge-gap' : src === 'momentum' ? 'badge-breakout' : src === 'reversal' ? 'badge-lf-bounce' : 'badge-new-high';
      return `<span class="${cls}">${src.toUpperCase()}</span>`;
    };

    const fmtNum = (v: number | null, decimals = 2, suffix = '%') =>
      v == null ? '—' : (v >= 0 ? `+${v.toFixed(decimals)}` : v.toFixed(decimals)) + suffix;

    let html = `<table class="scanner-table"><thead><tr>
      <th class="left">Time</th>
      <th class="left">Ticker</th>
      <th class="left">Source</th>
      <th>Price</th>
      <th>Gap %</th>
      <th>Chg %</th>
      <th>RelVol</th>
      <th>Quality</th>
    </tr></thead><tbody>`;

    for (const r of data) {
      const ts   = new Date(r.timestamp);
      const time = ts.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const gapCls = r.gapPercent != null && r.gapPercent >= 0 ? 'chg-pos' : 'chg-neg';
      const chgCls = r.changePercent != null && r.changePercent >= 0 ? 'chg-pos' : 'chg-neg';

      html += `<tr>
        <td class="left" style="color:var(--text-dim)">${time}</td>
        <td class="left"><span class="ticker">${r.ticker}</span></td>
        <td class="left">${srcBadge(r.source)}</td>
        <td>${r.price != null ? '$' + r.price.toFixed(2) : '—'}</td>
        <td class="${gapCls}">${fmtNum(r.gapPercent)}</td>
        <td class="${chgCls}">${fmtNum(r.changePercent)}</td>
        <td>${r.relativeVolume != null ? r.relativeVolume.toFixed(1) + 'x' : '—'}</td>
        <td>${r.qualityScore != null ? r.qualityScore : '—'}</td>
      </tr>`;
    }
    container.innerHTML = html + '</tbody></table>';
  } catch {
    container.innerHTML = '<div class="empty-state" style="padding:16px;color:var(--red)">Failed to load history.</div>';
  }
}

function setActiveFilter(el: HTMLElement) {
  document.querySelectorAll('.hist-filter').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

export function historyFilterToday(el: HTMLElement) {
  setActiveFilter(el);
  loadHistoryData('today');
}

export function historyFilterWeek(el: HTMLElement) {
  setActiveFilter(el);
  loadHistoryData('week');
}

export function historyFilterAll(el: HTMLElement) {
  setActiveFilter(el);
  loadHistoryData('all');
}

export function historyFilterRange() {
  const from = (document.getElementById('histFrom') as HTMLInputElement)?.value;
  const to   = (document.getElementById('histTo')   as HTMLInputElement)?.value;
  if (from && to) loadHistoryData('range', undefined, from, to);
}

export function historyFilterTicker() {
  const ticker = (document.getElementById('histTickerFilter') as HTMLInputElement)?.value.trim().toUpperCase();
  if (ticker) loadHistoryData('all', ticker);
}
