import { fmtPrice, fmtSign, fmtRelVol, fmtFloat, floatClass, volClass } from '../format';
import type { VolatilityHunterResult } from '../types';
import { sortState, sortRows, th, reRenderRegistry } from '../sort';

let _lastData: VolatilityHunterResult[] = [];

function tosBtnHtml(ticker: string): string {
  return `<button class="tos-btn" data-tos="${ticker}"><span>TOS</span></button>`;
}

function atrBarHtml(expansion: number): string {
  const pct = Math.min((expansion / 5) * 100, 100);
  return `<div class="atr-bar-wrap">
    <div class="atr-bar"><div class="atr-fill" style="width:${pct}%"></div></div>
    <span class="atr-val">${expansion.toFixed(2)}x</span>
  </div>`;
}

function renderTable(data: VolatilityHunterResult[]): string {
  if (data.length === 0) return '<div class="empty-state">No volatility expansions detected (&gt;1.5x ATR vs 14-day average).</div>';
  const s = sortState['vol'] ?? { col: 'atrExpansion', dir: -1 };
  const sorted = sortRows(data as unknown as Record<string, unknown>[], s.col, s.dir) as unknown as VolatilityHunterResult[];

  let html = `<table class="scanner-table"><thead><tr>
    ${th('vol','ticker','Ticker','left')}
    ${th('vol','price','Price')}
    ${th('vol','changePercent','Chg %')}
    ${th('vol','relativeVolume','RelVol')}
    ${th('vol','float','Float')}
    ${th('vol','atrExpansion','ATR Expansion')}
    <th data-nosort></th>
  </tr></thead><tbody>`;

  for (const r of sorted) {
    const chgCls = r.changePercent >= 0 ? 'chg-pos' : 'chg-neg';
    const fc     = floatClass(r.float);
    const vc     = volClass(r.relativeVolume);

    html += `<tr>
      <td class="left"><span class="ticker">${r.ticker}</span></td>
      <td>${fmtPrice(r.price)}</td>
      <td class="${chgCls}">${fmtSign(r.changePercent)}</td>
      <td class="${vc}">${fmtRelVol(r.relativeVolume)}</td>
      <td class="${fc}">${fmtFloat(r.float)}</td>
      <td>${atrBarHtml(r.atrExpansion)}</td>
      <td>${tosBtnHtml(r.ticker)}</td>
    </tr>`;
  }

  return html + '</tbody></table>';
}

export function renderVolatilityTab(data: VolatilityHunterResult[]): void {
  _lastData = data;
  const $ = (id: string) => document.getElementById(id)!;
  $('countVol').textContent    = String(data.length);
  $('tabVolCount').textContent = String(data.length);
  $('tableVol').innerHTML      = renderTable(data);
}

reRenderRegistry['vol'] = () => {
  const el = document.getElementById('tableVol');
  if (el) el.innerHTML = renderTable(_lastData);
};
