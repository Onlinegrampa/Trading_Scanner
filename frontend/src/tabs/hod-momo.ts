import { fmtPrice, fmtSign, fmtRelVol, fmtVol, fmtFloat, floatClass, volClass } from '../format';
import type { HodMomoResult } from '../types';
import { sortState, sortRows, th, reRenderRegistry } from '../sort';

let _lastData: HodMomoResult[] = [];

function tosBtnHtml(ticker: string): string {
  return `<button class="tos-btn" data-tos="${ticker}"><span>TOS</span></button>`;
}

function renderTierTable(rows: HodMomoResult[], tableId: string): string {
  if (rows.length === 0) return '<div class="empty-state">No candidates matching criteria.</div>';
  const s = sortState[tableId] ?? { col: 'distanceFromHigh', dir: 1 };
  const sorted = sortRows(rows as unknown as Record<string, unknown>[], s.col, s.dir) as unknown as HodMomoResult[];

  let html = `<table class="scanner-table"><thead><tr>
    ${th(tableId,'ticker','Ticker','left')}
    ${th(tableId,'price','Price')}
    ${th(tableId,'changePercent','Chg %')}
    ${th(tableId,'relativeVolume','RelVol')}
    ${th(tableId,'float','Float')}
    ${th(tableId,'volume','Volume')}
    ${th(tableId,'highOfDay','HOD')}
    ${th(tableId,'distanceFromHigh','Dist HOD')}
    ${th(tableId,'aboveVWAP','VWAP')}
    <th data-nosort></th>
  </tr></thead><tbody>`;

  for (const r of sorted) {
    const vc = volClass(r.relativeVolume);
    const fc = floatClass(r.float);
    const chgCls = r.changePercent >= 0 ? 'chg-pos' : 'chg-neg';
    const vwapCls = r.aboveVWAP ? 'vwap-above' : 'vwap-below';
    const distCls = r.distanceFromHigh <= 1 ? 'gap-up-4' : r.distanceFromHigh <= 3 ? 'gap-up-3' : 'chg-neg';

    html += `<tr>
      <td class="left"><span class="ticker">${r.ticker}</span></td>
      <td>${fmtPrice(r.price)}</td>
      <td class="${chgCls}">${fmtSign(r.changePercent)}</td>
      <td class="${vc}">${fmtRelVol(r.relativeVolume)}</td>
      <td class="${fc}">${fmtFloat(r.float)}</td>
      <td class="${vc}">${fmtVol(r.volume)}</td>
      <td>${fmtPrice(r.highOfDay)}</td>
      <td class="${distCls}">${r.distanceFromHigh.toFixed(1)}%</td>
      <td class="${vwapCls}">${r.aboveVWAP ? '▲ ABOVE' : '▼ BELOW'} ${fmtPrice(r.vwap)}</td>
      <td>${tosBtnHtml(r.ticker)}</td>
    </tr>`;
  }

  return html + '</tbody></table>';
}

export function renderHodMomoTab(data: HodMomoResult[]): void {
  _lastData = data;
  const small  = data.filter(r => r.tier === 'SMALL_CAP');
  const mid    = data.filter(r => r.tier === 'MID_CAP');
  const penny  = data.filter(r => r.tier === 'PENNY');

  const $ = (id: string) => document.getElementById(id)!;
  $('tableHodSmall').innerHTML  = renderTierTable(small,  'hod-small');
  $('tableHodMid').innerHTML    = renderTierTable(mid,    'hod-mid');
  $('tableHodPenny').innerHTML  = renderTierTable(penny,  'hod-penny');
  $('countHodSmall').textContent = String(small.length);
  $('countHodMid').textContent   = String(mid.length);
  $('countHodPenny').textContent = String(penny.length);
  $('tabHodCount').textContent   = String(data.length);
}

reRenderRegistry['hod-small']  = () => { const $ = (id: string) => document.getElementById(id)!; $('tableHodSmall').innerHTML = renderTierTable(_lastData.filter(r => r.tier === 'SMALL_CAP'), 'hod-small'); };
reRenderRegistry['hod-mid']    = () => { const $ = (id: string) => document.getElementById(id)!; $('tableHodMid').innerHTML   = renderTierTable(_lastData.filter(r => r.tier === 'MID_CAP'),   'hod-mid'); };
reRenderRegistry['hod-penny']  = () => { const $ = (id: string) => document.getElementById(id)!; $('tableHodPenny').innerHTML = renderTierTable(_lastData.filter(r => r.tier === 'PENNY'),     'hod-penny'); };
