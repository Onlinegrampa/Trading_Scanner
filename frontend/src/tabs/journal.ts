import type { ScanData } from '../types';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const input = (id: string) => document.getElementById(id) as HTMLInputElement | null;

export interface Trade {
  id: string; timestamp: string; ticker: string; direction: 'LONG' | 'SHORT';
  entryPrice: number; exitPrice: number; shares: number; setupType: string;
  scannerSource: string; notes: string; pnlDollar: number; pnlPercent: number;
  rMultiple: number | null; stopPrice: number | null; float: number | null;
}

let journalTrades: Trade[] = [];
let journalLoaded = false;
let journalDir: 'LONG' | 'SHORT' = 'LONG';
let _getPriceMap: () => Map<string, number> = () => new Map();
let _getSourceMap: () => Map<string, string> = () => new Map();
let _getLastData: () => ScanData | null = () => null;
let _onTradesChanged: (trades: Trade[]) => void = () => {};

function todayStr() { return new Date().toISOString().split('T')[0]; }

export function getWeekStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString();
}

export function getJournalTrades() { return journalTrades; }

export async function loadJournalTrades() {
  try {
    const res = await fetch('/api/journal/trades');
    if (res.ok) {
      journalTrades = await res.json() as Trade[];
      journalLoaded = true;
      renderJournalTab();
      _onTradesChanged(journalTrades);
    }
  } catch (e) { console.error('Journal load failed:', e); }
}

async function saveJournalTrade(trade: Trade): Promise<boolean> {
  try {
    const res = await fetch('/api/journal/trade', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trade),
    });
    if (res.ok) {
      journalTrades.push(trade);
      renderJournalTab();
      _onTradesChanged(journalTrades);
      return true;
    }
  } catch (e) { console.error('Journal save failed:', e); }
  return false;
}

async function deleteJournalTrade(id: string) {
  if (!confirm('Delete this trade?')) return;
  try {
    await fetch(`/api/journal/trade/${id}`, { method: 'DELETE' });
    journalTrades = journalTrades.filter(t => t.id !== id);
    renderJournalTab();
    _onTradesChanged(journalTrades);
    const t = document.getElementById('toast');
    if (t) { t.textContent = 'Trade deleted'; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }
  } catch {}
}

// ── Public API ─────────────────────────────────────────────────

export function initJournal(opts: {
  getPriceMap: () => Map<string, number>;
  getSourceMap: () => Map<string, string>;
  getLastData: () => ScanData | null;
  onTradesChanged: (trades: Trade[]) => void;
}) {
  _getPriceMap  = opts.getPriceMap;
  _getSourceMap = opts.getSourceMap;
  _getLastData  = opts.getLastData;
  _onTradesChanged = opts.onTradesChanged;

  // Wire direction buttons
  $('jDirLong')?.addEventListener('click',  () => setJournalDir('LONG'));
  $('jDirShort')?.addEventListener('click', () => setJournalDir('SHORT'));

  // Auto-fill price from ticker selection
  $('jTicker')?.addEventListener('input', () => {
    const t = (input('jTicker')?.value ?? '').trim().toUpperCase();
    const price = _getPriceMap().get(t);
    if (price) { const e = input('jEntry'); if (e) e.value = price.toFixed(2); }
    const src = _getSourceMap().get(t) || 'Manual';
    const lbl = $('jSourceLabel'); if (lbl) lbl.textContent = src.toUpperCase();
  });

  // Delete delegation
  document.getElementById('journalTodayTable')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-del-id]');
    if (btn) deleteJournalTrade(btn.dataset['delId']!);
  });
}

export function setJournalDir(dir: 'LONG' | 'SHORT') {
  journalDir = dir;
  const long  = $('jDirLong');
  const short = $('jDirShort');
  if (long)  long.className  = 'dir-btn' + (dir === 'LONG'  ? ' active-long'  : '');
  if (short) short.className = 'dir-btn' + (dir === 'SHORT' ? ' active-short' : '');
}

export function onJournalTabOpen() {
  if (!journalLoaded) loadJournalTrades();
  else renderJournalTab();
}

export function handleJournalSubmit(e?: Event) {
  e?.preventDefault();
  const ticker = (input('jTicker')?.value ?? '').trim().toUpperCase();
  const entry  = parseFloat(input('jEntry')?.value  ?? '0');
  const exit   = parseFloat(input('jExit')?.value   ?? '0');
  const shares = parseInt(input('jShares')?.value   ?? '0') || 0;
  const stop   = parseFloat(input('jStop')?.value   ?? '0') || null;
  const setup  = (document.getElementById('jSetup') as HTMLSelectElement)?.value ?? '';
  const notes  = (input('jNotes')?.value ?? '').trim();
  const src    = ($('jSourceLabel')?.textContent ?? '').toLowerCase();

  if (!ticker || !entry || !exit || !shares) {
    const t = document.getElementById('toast');
    if (t) { t.textContent = 'Fill in Ticker, Entry, Exit and Shares'; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }
    return;
  }

  const pnlDollar  = journalDir === 'LONG' ? (exit - entry) * shares : (entry - exit) * shares;
  const pnlPercent = journalDir === 'LONG' ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100;
  let rMultiple: number | null = null;
  if (stop !== null) {
    const stopDist = journalDir === 'LONG' ? entry - stop : stop - entry;
    if (stopDist > 0) rMultiple = pnlDollar / (stopDist * shares);
  }

  const lastData = _getLastData();
  const allRows = [...(lastData?.gappersUp ?? []), ...(lastData?.gappersDown ?? []), ...(lastData?.momentum ?? [])];
  const scanRow = allRows.find(r => r.ticker === ticker);

  const trade: Trade = {
    id: Date.now().toString(), timestamp: new Date().toISOString(),
    ticker, direction: journalDir, entryPrice: entry, exitPrice: exit,
    shares, setupType: setup, scannerSource: src, notes,
    pnlDollar, pnlPercent, rMultiple, stopPrice: stop, float: scanRow?.float ?? null,
  };

  saveJournalTrade(trade).then(ok => {
    if (ok) {
      const sign = pnlDollar >= 0 ? '+' : '';
      const t = document.getElementById('toast');
      if (t) { t.textContent = `✓ ${ticker} logged · ${sign}$${pnlDollar.toFixed(2)}`; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }
      // Reset form
      (['jTicker','jEntry','jExit','jShares','jStop','jNotes'] as const).forEach(id => {
        const el = input(id); if (el) el.value = '';
      });
      const lbl = $('jSourceLabel'); if (lbl) lbl.textContent = 'MANUAL';
      input('jTicker')?.focus();
    }
  });
}

export function updateHeaderPnl(pnlOverride?: number, countOverride?: number) {
  const today  = todayStr();
  const trades = journalTrades.filter(t => t.timestamp.startsWith(today));
  const pnl    = pnlOverride !== undefined ? pnlOverride : trades.reduce((s, t) => s + t.pnlDollar, 0);
  const count  = countOverride !== undefined ? countOverride : trades.length;
  const wrap = $('headerPnlWrap');
  if (!count) { if (wrap) wrap.style.display = 'none'; return; }
  if (wrap) wrap.style.display = '';
  const el = $('headerPnlVal');
  if (el) {
    el.textContent = (pnl >= 0 ? '+' : '') + '$' + Math.abs(pnl).toFixed(2);
    el.className   = 'header-pnl-val ' + (pnl > 0 ? 'pnl-pos' : pnl < 0 ? 'pnl-neg' : 'pnl-zero');
  }
}

// ── Render functions ───────────────────────────────────────────

function renderJournalTab() {
  renderJournalHero();
  renderTodayTable();
  renderKeyStats();
  renderPnlChart();
  renderSetupStats();
  renderTimeStats();
}

function renderJournalHero() {
  const today  = todayStr();
  const trades = journalTrades.filter(t => t.timestamp.startsWith(today));
  const pnl    = trades.reduce((s, t) => s + t.pnlDollar, 0);
  const wins   = trades.filter(t => t.pnlDollar > 0);
  const losses = trades.filter(t => t.pnlDollar < 0);
  const wr     = trades.length > 0 ? (wins.length / trades.length * 100).toFixed(0) + '%' : '—';
  const avgW   = wins.length   > 0 ? '+$' + (wins.reduce((s,t)=>s+t.pnlDollar,0)/wins.length).toFixed(2) : '—';
  const avgL   = losses.length > 0 ? '-$' + Math.abs(losses.reduce((s,t)=>s+t.pnlDollar,0)/losses.length).toFixed(2) : '—';
  const plr    = (wins.length > 0 && losses.length > 0)
    ? (Math.abs(wins.reduce((s,t)=>s+t.pnlDollar,0)/wins.length) / Math.abs(losses.reduce((s,t)=>s+t.pnlDollar,0)/losses.length)).toFixed(2)+':1'
    : '—';

  const hero = $('todayPnlHero');
  if (hero) { hero.textContent = (pnl >= 0 ? '+' : '') + '$' + Math.abs(pnl).toFixed(2); hero.className = 'journal-hero-amount ' + (pnl > 0 ? 'pnl-pos' : pnl < 0 ? 'pnl-neg' : 'pnl-zero'); }

  const set = (id: string, v: string) => { const el = $(id); if (el) el.textContent = v; };
  set('jHeroTrades', String(trades.length)); set('jHeroWins', String(wins.length));
  set('jHeroLoss', String(losses.length));   set('jHeroWR', wr);
  set('jHeroAvgW', avgW); set('jHeroAvgL', avgL); set('jHeroPLR', plr);
  updateHeaderPnl(pnl, trades.length);
}

function renderTodayTable() {
  const today  = todayStr();
  const trades = [...journalTrades.filter(t => t.timestamp.startsWith(today))].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const container = $('journalTodayTable');
  if (!container) return;
  if (trades.length === 0) { container.innerHTML = '<div class="empty-state" style="padding:12px">No trades logged today.</div>'; return; }

  let html = `<table class="trade-table"><thead><tr>
    <th class="left">Time</th><th class="left">Ticker</th><th>Dir</th>
    <th>Entry</th><th>Exit</th><th>Shares</th><th>P&L $</th><th>P&L %</th>
    <th>R</th><th class="left">Setup</th><th class="left">Source</th><th></th>
  </tr></thead><tbody>`;

  let total = 0;
  for (const t of trades) {
    total += t.pnlDollar;
    const time   = new Date(t.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const rowCls = t.pnlDollar > 0 ? 'trade-row-win' : t.pnlDollar < 0 ? 'trade-row-loss' : '';
    const pnlStr = (t.pnlDollar  >= 0 ? '+' : '') + '$' + t.pnlDollar.toFixed(2);
    const pctStr = (t.pnlPercent >= 0 ? '+' : '') + t.pnlPercent.toFixed(1) + '%';
    const rStr   = t.rMultiple != null ? (t.rMultiple >= 0 ? '+' : '') + t.rMultiple.toFixed(2) + 'R' : '—';
    const dirCls = t.direction === 'LONG' ? 'pnl-pos' : 'pnl-neg';
    html += `<tr class="${rowCls}">
      <td class="left">${time}</td><td class="ticker-cell left">${t.ticker}</td>
      <td><span class="${dirCls}">${t.direction}</span></td>
      <td>$${t.entryPrice.toFixed(2)}</td><td>$${t.exitPrice.toFixed(2)}</td><td>${t.shares.toLocaleString()}</td>
      <td>${pnlStr}</td><td>${pctStr}</td>
      <td style="color:var(--text-dim)">${rStr}</td>
      <td class="left" style="color:var(--text-dim)">${t.setupType}</td>
      <td class="left" style="color:var(--text-muted)">${t.scannerSource}</td>
      <td><button class="calc-row-btn" data-del-id="${t.id}" title="Delete">✕</button></td>
    </tr>`;
  }
  const totalCls = total > 0 ? 'pnl-pos' : total < 0 ? 'pnl-neg' : '';
  html += `<tr class="trade-table-totals"><td class="left" colspan="6">TOTAL</td>
    <td class="${totalCls}">${(total>=0?'+':'') + '$' + total.toFixed(2)}</td><td colspan="5"></td>
  </tr></tbody></table>`;
  container.innerHTML = html;
}

function renderKeyStats() {
  const el = $('journalKeyStats');
  if (!el) return;
  if (journalTrades.length === 0) { el.innerHTML = '<div class="empty-state">No trades logged yet.</div>'; return; }
  const wins   = journalTrades.filter(t => t.pnlDollar > 0);
  const losses = journalTrades.filter(t => t.pnlDollar < 0);
  const wr     = (wins.length / journalTrades.length * 100).toFixed(1);
  const avgWin = wins.length   > 0 ? wins.reduce((s,t)=>s+t.pnlDollar,0)/wins.length : 0;
  const avgLos = losses.length > 0 ? Math.abs(losses.reduce((s,t)=>s+t.pnlDollar,0)/losses.length) : 0;
  const plRatio = avgLos > 0 ? (avgWin / avgLos) : 0;

  const dayMap: Record<string, number> = {};
  for (const t of journalTrades) {
    const d = t.timestamp.split('T')[0];
    dayMap[d] = (dayMap[d] || 0) + t.pnlDollar;
  }
  const days  = Object.keys(dayMap).sort();
  const gDays = days.filter(d => dayMap[d] > 0).length;
  const bestDay  = days.length ? Math.max(...days.map(d => dayMap[d])) : 0;
  const worstDay = days.length ? Math.min(...days.map(d => dayMap[d])) : 0;
  const weekStart = getWeekStart();
  const weekPnl   = journalTrades.filter(t => t.timestamp >= weekStart).reduce((s,t)=>s+t.pnlDollar,0);

  const cards = [
    { label: 'Total Trades', val: String(journalTrades.length), cls: '' },
    { label: 'Win Rate',     val: wr + '%',    cls: parseFloat(wr) >= 60 ? 'pnl-pos' : 'pnl-neg' },
    { label: 'P/L Ratio',   val: plRatio > 0 ? plRatio.toFixed(2)+':1' : '—', cls: plRatio >= 2 ? 'pnl-pos' : plRatio > 0 ? 'pnl-neg' : '' },
    { label: 'Best Day',    val: bestDay  ? '+$'+bestDay.toFixed(0)  : '—', cls: 'pnl-pos' },
    { label: 'Worst Day',   val: worstDay < 0 ? '-$'+Math.abs(worstDay).toFixed(0) : '—', cls: 'pnl-neg' },
    { label: 'This Week',   val: (weekPnl>=0?'+':'') + '$' + weekPnl.toFixed(0), cls: weekPnl>=0?'pnl-pos':'pnl-neg' },
    { label: 'Green Days',  val: gDays + '/' + days.length, cls: gDays > days.length/2 ? 'pnl-pos' : 'pnl-neg' },
  ];

  el.innerHTML = `<div class="stats-grid">${cards.map(c =>
    `<div class="stat-card"><div class="stat-card-label">${c.label}</div><div class="stat-card-value ${c.cls}">${c.val}</div></div>`
  ).join('')}</div>`;
}

function renderPnlChart() {
  const el = $('journalPnlChart');
  if (!el) return;
  const dayMap: Record<string, number> = {};
  for (const t of journalTrades) {
    const d = t.timestamp.split('T')[0];
    dayMap[d] = (dayMap[d] || 0) + t.pnlDollar;
  }
  const allDays = Object.keys(dayMap).sort().slice(-30);
  if (allDays.length === 0) { el.innerHTML = '<div class="empty-state" style="padding:12px">No trade history yet.</div>'; return; }

  const maxAbs = Math.max(...allDays.map(d => Math.abs(dayMap[d])), 1);
  const n = allDays.length;
  const barW = 400 / n - 2;
  const bars = allDays.map((d, i) => {
    const pnl  = dayMap[d];
    const barH = (Math.abs(pnl) / maxAbs) * 44;
    const x    = i * (400 / n);
    const y    = pnl >= 0 ? 50 - barH : 50;
    const col  = pnl >= 0 ? '#00e676' : '#ff1744';
    const lbl  = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(0);
    return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${col}" opacity="0.85" rx="1"><title>${d}: ${lbl}</title></rect>`;
  }).join('');
  const labels = [
    `<text x="0"   y="98" font-size="7" fill="#555" text-anchor="start">${allDays[0]}</text>`,
    `<text x="200" y="98" font-size="7" fill="#555" text-anchor="middle">${allDays[Math.floor(n/2)] || ''}</text>`,
    `<text x="400" y="98" font-size="7" fill="#555" text-anchor="end">${allDays[n-1]}</text>`,
  ].join('');
  el.innerHTML = `<div class="pnl-chart-wrap"><svg viewBox="0 0 400 100" class="pnl-chart-svg" style="height:90px">
    <line x1="0" y1="50" x2="400" y2="50" stroke="#262626" stroke-width="1"/>
    ${bars}${labels}</svg></div>`;
}

function renderSetupStats() {
  const el = $('journalSetupStats');
  if (!el) return;
  if (journalTrades.length === 0) { el.innerHTML = '<div class="empty-state" style="padding:12px">No trades yet.</div>'; return; }
  const setups: Record<string, Trade[]> = {};
  for (const t of journalTrades) {
    const s = t.setupType || 'Other';
    (setups[s] = setups[s] || []).push(t);
  }
  const rows = Object.entries(setups).map(([name, trades]) => {
    const wins  = trades.filter(t => t.pnlDollar > 0);
    const total = trades.reduce((s,t)=>s+t.pnlDollar,0);
    const avg   = total / trades.length;
    const wr    = (wins.length / trades.length * 100).toFixed(0);
    return { name, count: trades.length, wr, avg, total, best: Math.max(...trades.map(t=>t.pnlDollar)), worst: Math.min(...trades.map(t=>t.pnlDollar)) };
  }).sort((a,b)=>b.total-a.total);

  let html = `<table class="perf-table"><thead><tr><th>Setup Type</th><th>Trades</th><th>Win %</th><th>Avg P&L</th><th>Total P&L</th><th>Best</th><th>Worst</th></tr></thead><tbody>`;
  for (const r of rows) {
    const tCls = r.total >= 0 ? 'pnl-pos' : 'pnl-neg';
    const aCls = r.avg   >= 0 ? 'pnl-pos' : 'pnl-neg';
    const wCls = parseFloat(r.wr) >= 60 ? 'pnl-pos' : 'pnl-neg';
    html += `<tr><td>${r.name}</td><td>${r.count}</td><td class="${wCls}">${r.wr}%</td>
      <td class="${aCls}">${(r.avg>=0?'+':'') + '$' + r.avg.toFixed(2)}</td>
      <td class="${tCls}">${(r.total>=0?'+':'') + '$' + r.total.toFixed(2)}</td>
      <td class="pnl-pos">+$${r.best.toFixed(2)}</td>
      <td class="pnl-neg">${r.worst < 0 ? '-$'+Math.abs(r.worst).toFixed(2) : '+$'+r.worst.toFixed(2)}</td>
    </tr>`;
  }
  el.innerHTML = html + '</tbody></table>';
}

function renderTimeStats() {
  const el = $('journalTimeStats');
  if (!el) return;
  if (journalTrades.length === 0) { el.innerHTML = '<div class="empty-state" style="padding:12px">No trades yet.</div>'; return; }
  const zones = [
    { label: 'Pre-Market',   key: 'pre',     range: '4:00 – 9:29',   cls: '' },
    { label: 'Prime Time',   key: 'prime',   range: '9:30 – 10:30',  cls: 'time-zone-prime' },
    { label: 'Caution Zone', key: 'caution', range: '10:30 – 11:30', cls: 'time-zone-caution' },
    { label: 'Danger Zone',  key: 'danger',  range: '11:30+',         cls: 'time-zone-danger' },
  ];
  const buckets: Record<string, Trade[]> = { pre: [], prime: [], caution: [], danger: [] };
  for (const t of journalTrades) {
    const h = new Date(t.timestamp).getHours();
    const m = new Date(t.timestamp).getMinutes();
    const mins = h * 60 + m;
    if      (mins < 9*60+30)  buckets['pre'].push(t);
    else if (mins < 10*60+30) buckets['prime'].push(t);
    else if (mins < 11*60+30) buckets['caution'].push(t);
    else                      buckets['danger'].push(t);
  }
  let html = `<table class="perf-table"><thead><tr><th>Time Zone</th><th>Range</th><th>Trades</th><th>Win %</th><th>Total P&L</th></tr></thead><tbody>`;
  for (const z of zones) {
    const trades = buckets[z.key];
    if (trades.length === 0) { html += `<tr><td class="${z.cls}">${z.label}</td><td style="color:var(--text-muted)">${z.range}</td><td colspan="3" style="color:var(--text-muted)">—</td></tr>`; continue; }
    const wins  = trades.filter(t => t.pnlDollar > 0);
    const total = trades.reduce((s,t)=>s+t.pnlDollar,0);
    const wr    = (wins.length / trades.length * 100).toFixed(0);
    html += `<tr><td class="${z.cls}">${z.label}</td><td style="color:var(--text-muted)">${z.range}</td>
      <td>${trades.length}</td>
      <td class="${parseFloat(wr) >= 60 ? 'pnl-pos' : 'pnl-neg'}">${wr}%</td>
      <td class="${total >= 0 ? 'pnl-pos' : 'pnl-neg'}">${(total>=0?'+':'') + '$' + total.toFixed(2)}</td>
    </tr>`;
  }
  el.innerHTML = html + '</tbody></table>';
}
