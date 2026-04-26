import { fmtPrice, fmtSign, fmtRelVol, fmtVol, fmtFloat, floatClass, volClass } from '../format';
import type { TopListsResult, TopListEntry } from '../types';
import { sortState, sortRows, th, reRenderRegistry } from '../sort';

let _lastData: TopListsResult | null = null;

function tosBtnHtml(ticker: string): string {
  return `<button class="tos-btn" data-tos="${ticker}"><span>TOS</span></button>`;
}

function renderTopTable(rows: TopListEntry[], tableId: string, showGap: boolean): string {
  if (rows.length === 0) return '<div class="empty-state">No data yet.</div>';
  const defaultCol = tableId === 'top-rvol' ? 'relativeVolume' : tableId === 'top-after' ? 'changePercent' : 'gapPercent';
  const s = sortState[tableId] ?? { col: defaultCol, dir: -1 };
  const sorted = sortRows(rows as unknown as Record<string, unknown>[], s.col, s.dir) as unknown as TopListEntry[];

  let html = `<table class="scanner-table"><thead><tr>
    ${th(tableId,'rank','#','left')}
    ${th(tableId,'ticker','Ticker','left')}
    ${th(tableId,'price','Price')}
    ${th(tableId,'changePercent','Chg %')}
    ${showGap ? th(tableId,'gapPercent','Gap %') : ''}
    ${th(tableId,'relativeVolume','RelVol')}
    ${th(tableId,'float','Float')}
    ${th(tableId,'volume','Volume')}
    <th data-nosort></th>
  </tr></thead><tbody>`;

  for (const r of sorted) {
    const chgCls = r.changePercent >= 0 ? 'chg-pos' : 'chg-neg';
    const gapCls = r.gapPercent >= 0    ? 'chg-pos' : 'chg-neg';
    const fc     = floatClass(r.float);
    const vc     = volClass(r.relativeVolume);

    html += `<tr>
      <td class="left"><span class="tl-rank">${r.rank}</span></td>
      <td class="left"><span class="ticker">${r.ticker}</span></td>
      <td>${fmtPrice(r.price)}</td>
      <td class="${chgCls}">${fmtSign(r.changePercent)}</td>
      ${showGap ? `<td class="${gapCls}">${fmtSign(r.gapPercent)}</td>` : ''}
      <td class="${vc}">${fmtRelVol(r.relativeVolume)}</td>
      <td class="${fc}">${fmtFloat(r.float)}</td>
      <td class="${vc}">${fmtVol(r.volume)}</td>
      <td>${tosBtnHtml(r.ticker)}</td>
    </tr>`;
  }

  return html + '</tbody></table>';
}

export function renderTopListsTab(data: TopListsResult): void {
  _lastData = data;
  const $ = (id: string) => document.getElementById(id)!;

  $('tableTopGap').innerHTML    = renderTopTable(data.topGappers, 'top-gap',   true);
  $('tableTopRvol').innerHTML   = renderTopTable(data.topRvol,    'top-rvol',  false);
  $('tableAfterHours').innerHTML = renderTopTable(data.afterHours, 'top-after', false);

  $('countTopGap').textContent     = String(data.topGappers.length);
  $('countTopRvol').textContent    = String(data.topRvol.length);
  $('countAfterHours').textContent = String(data.afterHours.length);
}

reRenderRegistry['top-gap']   = () => { if (_lastData) { const el = document.getElementById('tableTopGap');    if (el) el.innerHTML = renderTopTable(_lastData.topGappers, 'top-gap',   true); } };
reRenderRegistry['top-rvol']  = () => { if (_lastData) { const el = document.getElementById('tableTopRvol');   if (el) el.innerHTML = renderTopTable(_lastData.topRvol,    'top-rvol',  false); } };
reRenderRegistry['top-after'] = () => { if (_lastData) { const el = document.getElementById('tableAfterHours'); if (el) el.innerHTML = renderTopTable(_lastData.afterHours, 'top-after', false); } };
