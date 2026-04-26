import { fmtPrice, fmtSign, fmtRelVol, fmtVol, fmtFloat, floatClass, volClass } from '../format';
import type { PennyResult } from '../types';
import { sortState, sortRows, th, reRenderRegistry } from '../sort';

let _lastData: PennyResult[] = [];

function categoryBadge(cat: PennyResult['category']): string {
  if (cat === 'HOD')    return '<span class="penny-hod">HOD</span>';
  if (cat === '52WK')   return '<span class="penny-52wk">52wk-HIGH</span>';
  if (cat === 'SQUEEZE') return '<span class="penny-squeeze">SQUEEZE</span>';
  return '';
}

function tosBtnHtml(ticker: string): string {
  return `<button class="tos-btn" data-tos="${ticker}"><span>TOS</span></button>`;
}

function renderTable(data: PennyResult[]): string {
  if (data.length === 0) return '<div class="empty-state">No penny stocks meeting criteria right now.</div>';
  const s = sortState['penny'] ?? { col: 'changePercent', dir: -1 };
  const sorted = sortRows(data as unknown as Record<string, unknown>[], s.col, s.dir) as unknown as PennyResult[];

  let html = `<table class="scanner-table"><thead><tr>
    ${th('penny','ticker','Ticker','left')}
    <th class="left" data-nosort>Type</th>
    ${th('penny','price','Price')}
    ${th('penny','changePercent','Chg %')}
    ${th('penny','gapPercent','Gap %')}
    ${th('penny','relativeVolume','RelVol')}
    ${th('penny','float','Float')}
    ${th('penny','volume','Volume')}
    ${th('penny','highOfDay','HOD')}
    ${th('penny','week52High','52wk High')}
    ${th('penny','distTo52wHigh','Dist 52wk')}
    <th data-nosort></th>
  </tr></thead><tbody>`;

  for (const r of sorted) {
    const chgCls = r.changePercent >= 0 ? 'chg-pos' : 'chg-neg';
    const gapCls = r.gapPercent >= 0    ? 'chg-pos' : 'chg-neg';
    const fc     = floatClass(r.float);
    const vc     = volClass(r.relativeVolume);
    const distCls = (r.distTo52wHigh ?? 100) <= 5 ? 'gap-up-3' : 'chg-pos';

    html += `<tr>
      <td class="left"><span class="ticker">${r.ticker}</span></td>
      <td class="left">${categoryBadge(r.category)}</td>
      <td>${fmtPrice(r.price)}</td>
      <td class="${chgCls}">${fmtSign(r.changePercent)}</td>
      <td class="${gapCls}">${fmtSign(r.gapPercent)}</td>
      <td class="${vc}">${fmtRelVol(r.relativeVolume)}</td>
      <td class="${fc}">${fmtFloat(r.float)}</td>
      <td class="${vc}">${fmtVol(r.volume)}</td>
      <td>${fmtPrice(r.highOfDay)}</td>
      <td>${r.week52High ? fmtPrice(r.week52High) : '—'}</td>
      <td class="${distCls}">${r.distTo52wHigh != null ? r.distTo52wHigh.toFixed(1) + '%' : '—'}</td>
      <td>${tosBtnHtml(r.ticker)}</td>
    </tr>`;
  }

  return html + '</tbody></table>';
}

export function renderPennyTab(data: PennyResult[]): void {
  _lastData = data;
  const $ = (id: string) => document.getElementById(id)!;
  $('countPenny').textContent    = String(data.length);
  $('tabPennyCount').textContent = String(data.length);
  $('tablePenny').innerHTML      = renderTable(data);
}

reRenderRegistry['penny'] = () => {
  const el = document.getElementById('tablePenny');
  if (el) el.innerHTML = renderTable(_lastData);
};
