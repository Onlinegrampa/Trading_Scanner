import type { ScanData } from '../types';

const $ = (id: string) => document.getElementById(id);
const STORAGE_KEY = 'cl_checklist_v1';

type ClKey = 'sleep' | 'mental' | 'week' | 'market' | 'scanner' | 'risk' | 'trades';
const clState: Record<ClKey | '_recommendedIntensity', string | null> = {
  sleep: null, mental: null, week: null, market: null, scanner: null, risk: null, trades: null,
  _recommendedIntensity: null,
};

function todayETKey(): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/New_York',
  }).format(new Date());
}
function getETHour(): number {
  return parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }).format(new Date()), 10);
}

function loadRecord() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Record<string, unknown> | null; }
  catch { return null; }
}
function saveRecord(rec: Record<string, unknown>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rec)); } catch {}
}

function updateBadge(intensity: string | null) {
  const badge = $('clSizeBadge');
  if (!badge) return;
  if (!intensity) { badge.style.display = 'none'; return; }
  badge.style.display = 'inline-block';
  badge.className = 'cl-size-badge';
  if (intensity === 'FULL')       badge.classList.add('cl-size-full');
  else if (intensity === 'HALF')  badge.classList.add('cl-size-half');
  else                            badge.classList.add('cl-size-small');
  (badge as HTMLElement).textContent = intensity;
}

function updateRecommendation() {
  const { sleep, mental, week, market, scanner, risk } = clState;
  const answered = [sleep, mental, week, market, scanner, risk].filter(Boolean).length;
  const rec = $('clRecommendation');
  if (!rec) return;
  if (answered < 4) { rec.style.display = 'none'; return; }
  rec.style.display = '';

  const score = (v: string | null) => v === 'good' ? 1 : v === 'bad' ? -1 : 0;
  const total = score(sleep) + score(mental) + score(week) + score(market) + score(scanner);

  let intensity: string, cls: string, label: string, reason: string;
  if (total >= 3) {
    intensity = 'FULL';  cls = 'cl-rec-full';  label = '🟢 TRADE FULL SIZE';
    reason = 'Conditions are excellent. Mental clarity + hot market. Execute your A-setups with full conviction.';
  } else if (total >= 0) {
    intensity = 'HALF';  cls = 'cl-rec-half';  label = '🟡 TRADE HALF SIZE';
    reason = 'Mixed conditions. Reduce size 50%, focus only on A+ setups, stop after 2 losses.';
  } else if (total >= -2) {
    intensity = 'SMALL'; cls = 'cl-rec-small'; label = '🔴 SMALL SIZE ONLY';
    reason = 'Challenging conditions. 1 trade max, minimal size. Protect capital above all.';
  } else {
    intensity = 'SIT';   cls = 'cl-rec-wait';  label = '⚫ CONSIDER SITTING OUT';
    reason = 'Too many red flags. Preserve capital. Watch and learn — no forced trades today.';
  }

  const box = $('clRecBox');
  if (box) { box.className = `cl-rec-box ${cls}`; box.textContent = label; }
  const reasonEl = $('clRecReason');
  if (reasonEl) reasonEl.textContent = reason;

  clState._recommendedIntensity = risk === 'good' ? 'FULL' : risk === 'neutral' ? 'HALF' : risk === 'bad' ? 'SMALL' : intensity;
}

function clSelect(key: ClKey, val: string) {
  ['good', 'neutral', 'bad'].forEach(v => {
    const el = $(`cl-${key}-${v}`);
    if (el) el.className = 'cl-option';
  });
  const chosen = $(`cl-${key}-${val}`);
  if (chosen) chosen.classList.add(`sel-${val}`);
  clState[key] = val;
  updateRecommendation();
  const answered = (Object.keys(clState) as ClKey[])
    .filter(k => k !== '_recommendedIntensity')
    .filter(k => clState[k]).length;
  const btn = $('clCompleteBtn') as HTMLButtonElement | null;
  if (btn) btn.disabled = answered < 5;
}

function autoPopulateWeekPerf(trades: Array<{ timestamp: string; pnlDollar: number }>) {
  try {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const weekPnl = trades
      .filter(t => new Date(t.timestamp) >= monday)
      .reduce((s, t) => s + (t.pnlDollar || 0), 0);
    const note = $('clWeekPnlNote');
    const val  = $('clWeekPnlValue');
    if (note && val) {
      note.style.display = '';
      const fmt = weekPnl >= 0 ? `+$${weekPnl.toFixed(2)}` : `-$${Math.abs(weekPnl).toFixed(2)}`;
      val.textContent = fmt + ' this week';
      (val as HTMLElement).style.color = weekPnl >= 0 ? 'var(--green)' : 'var(--red)';
    }
    if (!clState.week) clSelect('week', weekPnl > 0 ? 'good' : weekPnl < 0 ? 'bad' : 'neutral');
  } catch {}
}

let _getJournalTrades: (() => Array<{ timestamp: string; pnlDollar: number }>) = () => [];

export function initChecklist(getJournalTrades: () => Array<{ timestamp: string; pnlDollar: number }>) {
  _getJournalTrades = getJournalTrades;

  // Wire option buttons via event delegation
  document.getElementById('checklistBody')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-cl-key]');
    if (!btn) return;
    const key = btn.dataset['clKey'] as ClKey;
    const val = btn.dataset['clVal']!;
    clSelect(key, val);
  });

  $('clCompleteBtn')?.addEventListener('click', () => {
    const intensity = clState._recommendedIntensity ?? 'FULL';
    saveRecord({ date: todayETKey(), completed: true, intensity, state: { ...clState } });
    closeChecklist();
    updateBadge(intensity);
    $('clReminder')?.classList.remove('show');
  });

  $('clSkipBtn')?.addEventListener('click', () => {
    saveRecord({ date: todayETKey(), skipped: true, intensity: null });
    closeChecklist();
    updateBadge(null);
    _checkMissedChecklist();
  });

  // Restore badge
  const rec = loadRecord();
  const todayKey = todayETKey();
  if (rec && (rec['date'] as string) === todayKey && rec['intensity']) {
    updateBadge(rec['intensity'] as string);
  }

  // Auto-open pre-market
  _checkAutoShow();
}

function _checkMissedChecklist() {
  const h   = getETHour();
  const rec = loadRecord();
  const doneToday = rec && (rec['date'] as string) === todayETKey() && (rec['completed'] || rec['skipped']);
  if (!doneToday && h >= 10) {
    $('clReminder')?.classList.add('show');
  } else {
    $('clReminder')?.classList.remove('show');
  }
}

function _checkAutoShow() {
  const h = getETHour();
  const rec = loadRecord();
  if (!rec || (rec['date'] as string) !== todayETKey()) {
    if (h >= 4 && h < 9) setTimeout(openChecklist, 1200);
  }
  _checkMissedChecklist();
}

export function openChecklist() {
  const d = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
  }).format(new Date());
  const lbl = $('clDateLabel');
  if (lbl) lbl.textContent = d + ' — New York Time';
  $('checklistOverlay')?.classList.add('open');
  autoPopulateWeekPerf(_getJournalTrades());
  renderChecklistBody();
}

export function closeChecklist() {
  $('checklistOverlay')?.classList.remove('open');
}

export function updateChecklistScannerData(data: ScanData) {
  const gapCount = (data.gappersUp?.length || 0) + (data.gappersDown?.length || 0);
  const scannerVal  = gapCount >= 8 ? 'good' : gapCount >= 4 ? 'neutral' : 'bad';
  const suggestion  = gapCount >= 8 ? `${gapCount} gappers — HOT scanner`
    : gapCount >= 4 ? `${gapCount} gappers — moderate activity`
    : `${gapCount} gappers — quiet/cold scanner`;

  const note = $('clScannerNote');
  const val  = $('clScannerValue');
  if (note && val) { note.style.display = ''; val.textContent = suggestion; }
  if (!clState.scanner) clSelect('scanner', scannerVal);
}

function renderChecklistBody() {
  const body = $('checklistBody');
  if (!body) return;

  const opts = (key: ClKey) => ['good','neutral','bad'].map(v =>
    `<button class="cl-option${clState[key] === v ? ` sel-${v}` : ''}" data-cl-key="${key}" data-cl-val="${v}">${v.toUpperCase()}</button>`
  ).join('');

  body.innerHTML = `
    <div class="cl-questions">
      ${clQuestion('sleep',   'Sleep Quality',    'How well did you sleep?', opts('sleep'))}
      ${clQuestion('mental',  'Mental State',     'How is your focus/mindset?', opts('mental'))}
      ${clQuestion('week',    'Week Performance', 'How is your week going?', opts('week'),
        '<div id="clWeekPnlNote" style="display:none;font-size:9px;color:var(--text-muted);margin-top:4px">Week P&L: <span id="clWeekPnlValue"></span></div>')}
      ${clQuestion('market',  'Market Conditions','How is the overall market?', opts('market'))}
      ${clQuestion('scanner', 'Scanner Quality',  'How is the gap scanner?', opts('scanner'),
        '<div id="clScannerNote" style="display:none;font-size:9px;color:var(--text-muted);margin-top:4px">Scanner: <span id="clScannerValue"></span></div>')}
      ${clQuestion('risk',    'Risk Tolerance',   'Your personal risk level today?', opts('risk'))}
      ${clQuestion('trades',  'Recent Trades',    'Recent trading performance?', opts('trades'))}
    </div>
    <div class="cl-recommendation" id="clRecommendation" style="display:none">
      <div class="cl-rec-box" id="clRecBox"></div>
      <div class="cl-rec-reason" id="clRecReason"></div>
    </div>
    <div class="cl-footer">
      <button class="cl-skip-btn" id="clSkipBtn">Skip Today</button>
      <button class="cl-complete-btn" id="clCompleteBtn" disabled>Complete Checklist</button>
    </div>`;

  // Re-wire footer buttons (they were re-created)
  $('clCompleteBtn')?.addEventListener('click', () => {
    const intensity = clState._recommendedIntensity ?? 'FULL';
    saveRecord({ date: todayETKey(), completed: true, intensity, state: { ...clState } });
    closeChecklist();
    updateBadge(intensity);
    $('clReminder')?.classList.remove('show');
  });
  $('clSkipBtn')?.addEventListener('click', () => {
    saveRecord({ date: todayETKey(), skipped: true, intensity: null });
    closeChecklist();
    updateBadge(null);
    _checkMissedChecklist();
  });

  updateRecommendation();
}

function clQuestion(key: string, title: string, sub: string, optHtml: string, extra = '') {
  return `<div class="cl-question">
    <div class="cl-question-title">${title}</div>
    <div class="cl-question-sub">${sub}</div>
    <div class="cl-options">${optHtml}</div>
    ${extra}
  </div>`;
}
