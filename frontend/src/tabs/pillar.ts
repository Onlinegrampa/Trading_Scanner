import { fmtPrice, fmtSign, fmtRelVol, fmtVol, fmtFloat, floatClass, volClass } from '../format';
import type { FivePillarResult } from '../types';
import { soundHighPriority } from '../audio';
import { sortState, sortRows, th, reRenderRegistry } from '../sort';

const COOLDOWN_MS = 5 * 60 * 1000;
const pillarAlertHistory = new Map<string, number>();
let pillarInitialized = false;
const seenPillarTickers = new Set<string>();
let _lastData: FivePillarResult[] = [];

function pillarDotsHtml(pillars: FivePillarResult['pillars'], score: number): string {
  const keys: (keyof typeof pillars)[] = ['gap', 'float', 'price', 'relVol', 'news'];
  const labels = ['Gap', 'Float', 'Price', 'RelVol', 'News'];
  const dots = keys.map((k, i) =>
    `<span class="pillar-dot ${pillars[k] ? 'on' : ''}" title="${labels[i]}"></span>`,
  ).join('');
  return `<span class="pillar-dots pillar-score-${score}">${dots}</span>`;
}

function tosBtnHtml(ticker: string): string {
  return `<button class="tos-btn" data-tos="${ticker}"><span>TOS</span></button>`;
}

export function checkPillarAlerts(data: FivePillarResult[]): void {
  if (!pillarInitialized) {
    data.forEach(r => seenPillarTickers.add(r.ticker));
    pillarInitialized = true;
    return;
  }
  for (const r of data) {
    if (r.pillarScore < 5) continue;
    const key = `pillar:${r.ticker}`;
    const last = pillarAlertHistory.get(key) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) continue;
    pillarAlertHistory.set(key, Date.now());
    soundHighPriority();
    window.dispatchEvent(new CustomEvent('pillar-alert', { detail: r }));
  }
}

function renderTable(data: FivePillarResult[]): string {
  if (data.length === 0) return '<div class="empty-state">No tickers meeting 3+ pillars right now.</div>';
  const s = sortState['pillar'] ?? { col: 'pillarScore', dir: -1 };
  const sorted = sortRows(data as unknown as Record<string, unknown>[], s.col, s.dir) as unknown as FivePillarResult[];

  let html = `<table class="scanner-table"><thead><tr>
    ${th('pillar','ticker','Ticker','left')}
    ${th('pillar','price','Price')}
    ${th('pillar','gapPercent','Gap %')}
    ${th('pillar','float','Float')}
    ${th('pillar','relativeVolume','RelVol')}
    ${th('pillar','volume','Volume')}
    ${th('pillar','pillarScore','Pillars','left')}
    <th class="left" data-nosort>Catalyst</th>
    <th class="left" data-nosort>Headline</th>
    <th data-nosort></th>
  </tr></thead><tbody>`;

  for (const r of sorted) {
    const isFull = r.pillarScore === 5;
    const rowCls = isFull ? 'pillar-full' : '';
    const fc = floatClass(r.float);
    const vc = volClass(r.relativeVolume);
    const gapCls = r.gapPercent >= 0 ? 'chg-pos' : 'chg-neg';
    const catBadge = r.catalystType
      ? `<span class="cat-badge cat-strong">${r.catalystType}</span>`
      : '<span class="cat-badge cat-neutral">No News</span>';
    const headline = r.latestNews
      ? `<a class="cat-headline" href="${r.latestNews.articleUrl}" target="_blank" title="${r.latestNews.title}">${r.latestNews.title.slice(0, 55)}${r.latestNews.title.length > 55 ? '…' : ''}</a>`
      : '—';

    html += `<tr class="${rowCls}">
      <td class="left">
        <span class="ticker">${r.ticker}</span>
        ${isFull ? '<span class="pillar-alert" style="margin-left:5px">★ FULL</span>' : ''}
      </td>
      <td>${fmtPrice(r.price)}</td>
      <td class="${gapCls}">${fmtSign(r.gapPercent)}</td>
      <td class="${fc}">${fmtFloat(r.float)}</td>
      <td class="${vc}">${fmtRelVol(r.relativeVolume)}</td>
      <td class="${vc}">${fmtVol(r.volume)}</td>
      <td class="left">${pillarDotsHtml(r.pillars, r.pillarScore)} <span style="color:var(--text-muted);font-size:10px">${r.pillarScore}/5</span></td>
      <td class="left">${catBadge}</td>
      <td class="left">${headline}</td>
      <td>${tosBtnHtml(r.ticker)}</td>
    </tr>`;
  }

  return html + '</tbody></table>';
}

export function renderPillarTab(data: FivePillarResult[]): void {
  _lastData = data;
  const $ = (id: string) => document.getElementById(id)!;
  $('countPillar').textContent    = String(data.length);
  $('tabPillarCount').textContent = String(data.length);
  $('tablePillar').innerHTML      = renderTable(data);
}

reRenderRegistry['pillar'] = () => {
  const el = document.getElementById('tablePillar');
  if (el) el.innerHTML = renderTable(_lastData);
};
