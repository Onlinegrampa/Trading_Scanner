import type { ScanData } from '../types';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

const STORAGE_KEY = 'rossCalcSettings';
const calcPriceMap = new Map<string, number>();
const scannerSourceMap = new Map<string, string>();

function calcUpdate() {
  const el = (id: string) => document.getElementById(id) as HTMLInputElement | null;
  const maxRisk  = parseFloat(el('calcMaxRiskTrade')?.value ?? '0') || 0;
  const maxDaily = parseFloat(el('calcMaxDailyRisk')?.value ?? '0') || 0;
  const todayPnl = parseFloat(el('calcTodayPnl')?.value   ?? '0') || 0;
  const entry    = parseFloat(el('calcEntry')?.value       ?? '0') || 0;
  const stop     = parseFloat(el('calcStop')?.value        ?? '0') || 0;

  const valid = entry > 0 && stop > 0 && entry > stop;

  if (!valid) {
    ['calcStopDist','calcMaxShares','calcPosValue','calcRiskAmount','calcPT2','calcPT3','calcProfit2','calcProfit3']
      .forEach(id => { const e = document.getElementById(id); if (e) e.textContent = '—'; });
    const rrWrap = document.getElementById('rrBarWrap');
    const rrEmpty = document.getElementById('rrEmpty');
    if (rrWrap)  rrWrap.style.display  = 'none';
    if (rrEmpty) rrEmpty.style.display = '';
    _updateTradesRemaining(maxDaily, maxRisk, todayPnl);
    return;
  }

  const stopDist  = entry - stop;
  const stopPct   = (stopDist / entry) * 100;
  const maxShares = maxRisk > 0 ? Math.floor(maxRisk / stopDist) : 0;
  const posValue  = maxShares * entry;
  const riskAmt   = maxShares * stopDist;
  const pt2 = entry + 2 * stopDist;
  const pt3 = entry + 3 * stopDist;

  const set = (id: string, v: string) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('calcStopDist',  `$${stopDist.toFixed(2)} (${stopPct.toFixed(1)}%)`);
  set('calcMaxShares', maxShares > 0 ? maxShares.toLocaleString() + ' shares' : '—');
  set('calcPosValue',  '$' + posValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  set('calcPT2', '$' + pt2.toFixed(2));
  set('calcPT3', '$' + pt3.toFixed(2));
  set('calcProfit2', maxShares > 0 ? `+$${(maxShares * 2 * stopDist).toFixed(2)}` : '');
  set('calcProfit3', maxShares > 0 ? `+$${(maxShares * 3 * stopDist).toFixed(2)}` : '');

  const riskEl = document.getElementById('calcRiskAmount');
  if (riskEl) {
    riskEl.textContent = '$' + riskAmt.toFixed(2);
    riskEl.className = 'calc-result-val ' + (riskAmt > maxRisk && maxRisk > 0 ? 'calc-val-warn' : 'calc-risk-val');
  }

  const rrWrap = document.getElementById('rrBarWrap');
  const rrEmpty = document.getElementById('rrEmpty');
  if (rrWrap)  rrWrap.style.display  = '';
  if (rrEmpty) rrEmpty.style.display = 'none';

  set('rrRiskLabel',   maxShares > 0 ? `-$${riskAmt.toFixed(0)}` : 'RISK');
  set('rrRewardLabel', maxShares > 0 ? `+$${(maxShares * 2 * stopDist).toFixed(0)}` : 'REWARD 2×');
  set('rrStopLabel',   '$' + stop.toFixed(2));
  set('rrTargetLabel', '$' + pt2.toFixed(2));

  _updateTradesRemaining(maxDaily, maxRisk, todayPnl);
}

function _updateTradesRemaining(maxDaily: number, maxRisk: number, todayPnl: number) {
  const remaining_el = document.getElementById('tradesRemaining');
  const bar_el = document.getElementById('tradesUsedBar') as HTMLElement | null;
  const info_el = document.getElementById('tradesPnlInfo');
  if (maxDaily <= 0 || maxRisk <= 0) {
    if (remaining_el) remaining_el.textContent = '—';
    if (bar_el) bar_el.style.width = '0%';
    if (info_el) info_el.textContent = '';
    return;
  }
  const capitalRemaining = maxDaily + Math.min(todayPnl, 0);
  const remaining = Math.max(0, Math.floor(capitalRemaining / maxRisk));
  const usedPct   = Math.min(100, Math.max(0, ((maxDaily - capitalRemaining) / maxDaily) * 100));
  if (remaining_el) {
    remaining_el.textContent = String(remaining);
    remaining_el.style.color = remaining >= 3 ? 'var(--green)' : remaining >= 1 ? 'var(--yellow)' : 'var(--red)';
  }
  if (bar_el) bar_el.style.width = usedPct + '%';
  if (info_el) {
    if (todayPnl < 0) {
      info_el.textContent = `Today's P&L: -$${Math.abs(todayPnl).toFixed(2)} · $${Math.max(0, capitalRemaining).toFixed(2)} budget left`;
      (info_el as HTMLElement).style.display = '';
    } else if (todayPnl > 0) {
      info_el.textContent = `Today's P&L: +$${todayPnl.toFixed(2)}`;
      (info_el as HTMLElement).style.display = '';
    } else {
      (info_el as HTMLElement).style.display = 'none';
    }
  }
}

function saveCalcSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      accountSize:  (document.getElementById('calcAccountSize')  as HTMLInputElement)?.value,
      maxDailyRisk: (document.getElementById('calcMaxDailyRisk') as HTMLInputElement)?.value,
      maxRiskTrade: (document.getElementById('calcMaxRiskTrade') as HTMLInputElement)?.value,
      todayPnl:     (document.getElementById('calcTodayPnl')     as HTMLInputElement)?.value,
    }));
  } catch {}
}

function loadCalcSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Record<string, string> | null;
    if (!saved) return;
    const set = (id: string, v: string | undefined) => {
      if (v != null) {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) el.value = v;
      }
    };
    set('calcAccountSize',  saved['accountSize']);
    set('calcMaxDailyRisk', saved['maxDailyRisk']);
    set('calcMaxRiskTrade', saved['maxRiskTrade']);
    set('calcTodayPnl',     saved['todayPnl']);
  } catch {}
}

// ── Public API ──────────────────────────────────────────────────

export function toggleCalc() {
  const drawer = document.getElementById('calcDrawer');
  if (!drawer) return;
  if (drawer.classList.contains('open')) closeCalc();
  else openCalc();
}

export function openCalc() {
  document.getElementById('calcDrawer')?.classList.add('open');
  document.getElementById('calcOverlay')?.classList.add('open');
  document.getElementById('calcBtn')?.classList.add('paused');
}

export function closeCalc() {
  document.getElementById('calcDrawer')?.classList.remove('open');
  document.getElementById('calcOverlay')?.classList.remove('open');
  document.getElementById('calcBtn')?.classList.remove('paused');
}

export function openCalcForTicker(ticker: string, price: number) {
  const t = document.getElementById('calcTicker') as HTMLInputElement | null;
  const e = document.getElementById('calcEntry')  as HTMLInputElement | null;
  const s = document.getElementById('calcStop')   as HTMLInputElement | null;
  if (t) t.value = ticker;
  if (e) e.value = price.toFixed(2);
  if (s) s.value = '';
  calcUpdate();
  openCalc();
  setTimeout(() => s?.focus(), 280);
}

export function syncPnlToCalc(pnl: number) {
  const el = document.getElementById('calcTodayPnl') as HTMLInputElement | null;
  if (el) { el.value = pnl.toFixed(2); calcUpdate(); }
}

export function updateCalcTickerList(data: ScanData) {
  calcPriceMap.clear();
  scannerSourceMap.clear();
  for (const r of (data.gappersUp   || [])) { calcPriceMap.set(r.ticker, r.price); scannerSourceMap.set(r.ticker, 'Gap Scanner'); }
  for (const r of (data.gappersDown || [])) { calcPriceMap.set(r.ticker, r.price); scannerSourceMap.set(r.ticker, 'Gap Scanner'); }
  for (const r of (data.momentum    || [])) { calcPriceMap.set(r.ticker, r.price); scannerSourceMap.set(r.ticker, 'Momentum'); }

  const opts = [...calcPriceMap.keys()].map(t => `<option value="${t}">`).join('');
  const cl = document.getElementById('calcTickerList');
  const jl = document.getElementById('jTickerList');
  if (cl) cl.innerHTML = opts;
  if (jl) jl.innerHTML = opts;
}

export function getCalcPriceMap() { return calcPriceMap; }
export function getScannerSourceMap() { return scannerSourceMap; }

export function initCalc() {
  loadCalcSettings();
  calcUpdate();

  // Wire inputs
  const wire = (id: string, fn: () => void) => {
    document.getElementById(id)?.addEventListener('input', fn);
  };
  wire('calcAccountSize',  () => { calcUpdate(); saveCalcSettings(); });
  wire('calcMaxDailyRisk', () => { calcUpdate(); saveCalcSettings(); });
  wire('calcMaxRiskTrade', () => { calcUpdate(); saveCalcSettings(); });
  wire('calcTodayPnl',     () => { calcUpdate(); saveCalcSettings(); });
  wire('calcEntry',        calcUpdate);
  wire('calcStop',         calcUpdate);
  wire('calcTicker', () => {
    const ticker = (document.getElementById('calcTicker') as HTMLInputElement)?.value.trim().toUpperCase();
    const price  = calcPriceMap.get(ticker);
    if (price) {
      const e = document.getElementById('calcEntry') as HTMLInputElement | null;
      if (e) { e.value = price.toFixed(2); calcUpdate(); }
    }
  });
}
