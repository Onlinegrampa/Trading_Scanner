import { fmtPrice, fmtSign, fmtRelVol, fmtVol, fmtFloat, floatClass, volClass } from '../format';
import type { EarningsResult } from '../types';
import { sortState, sortRows, th, reRenderRegistry } from '../sort';

let _lastData: EarningsResult[] = [];

function tosBtnHtml(ticker: string): string {
  return `<button class="tos-btn" data-tos="${ticker}"><span>TOS</span></button>`;
}

function renderTable(data: EarningsResult[]): string {
  if (data.length === 0) return '<div class="empty-state">No large cap earnings plays detected. (Requires news catalyst with earnings keyword)</div>';
  const s = sortState['earnings'] ?? { col: 'gapPercent', dir: -1 };
  const sorted = sortRows(data as unknown as Record<string, unknown>[], s.col, s.dir) as unknown as EarningsResult[];

  let html = `<table class="scanner-table"><thead><tr>
    ${th('earnings','ticker','Ticker','left')}
    ${th('earnings','price','Price')}
    ${th('earnings','gapPercent','Gap %')}
    ${th('earnings','relativeVolume','RelVol')}
    ${th('earnings','float','Float')}
    ${th('earnings','volume','Volume')}
    ${th('earnings','earningsKeyword','Keyword','left')}
    <th class="left" data-nosort>Headline</th>
    <th data-nosort></th>
  </tr></thead><tbody>`;

  for (const r of sorted) {
    const gapCls = r.gapPercent >= 0 ? 'chg-pos' : 'chg-neg';
    const fc     = floatClass(r.float);
    const vc     = volClass(r.relativeVolume);
    const headline = r.latestNews
      ? `<a class="cat-headline" href="${r.latestNews.articleUrl}" target="_blank">${r.latestNews.title.slice(0, 70)}${r.latestNews.title.length > 70 ? '…' : ''}</a>`
      : '—';

    html += `<tr>
      <td class="left"><span class="ticker">${r.ticker}</span></td>
      <td>${fmtPrice(r.price)}</td>
      <td class="${gapCls}">${fmtSign(r.gapPercent)}</td>
      <td class="${vc}">${fmtRelVol(r.relativeVolume)}</td>
      <td class="${fc}">${fmtFloat(r.float)}</td>
      <td class="${vc}">${fmtVol(r.volume)}</td>
      <td class="left"><span class="earnings-kw">${r.earningsKeyword}</span></td>
      <td class="left">${headline}</td>
      <td>${tosBtnHtml(r.ticker)}</td>
    </tr>`;
  }

  return html + '</tbody></table>';
}

export function renderEarningsTab(data: EarningsResult[]): void {
  _lastData = data;
  const $ = (id: string) => document.getElementById(id)!;
  $('countEarnings').textContent    = String(data.length);
  $('tabEarningsCount').textContent = String(data.length);
  $('tableEarnings').innerHTML      = renderTable(data);
}

reRenderRegistry['earnings'] = () => {
  const el = document.getElementById('tableEarnings');
  if (el) el.innerHTML = renderTable(_lastData);
};
