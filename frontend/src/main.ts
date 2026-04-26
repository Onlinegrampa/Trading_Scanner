import './styles/main.css';
import type { ScanData, FivePillarResult } from './types';
import { muted, setMuted, soundHighPriority } from './audio';
import { sortState, sortRows, th, reRenderRegistry, sortTable } from './sort';
import { renderHodMomoTab } from './tabs/hod-momo';
import { renderPillarTab, checkPillarAlerts } from './tabs/pillar';
import { renderPennyTab } from './tabs/penny';
import { renderTopListsTab } from './tabs/top-lists';
import { renderEarningsTab } from './tabs/earnings';
import { renderVolatilityTab } from './tabs/volatility';

// ── Globals (preserved for legacy inline handlers) ────────────
const g = window as unknown as Record<string, unknown>;

const $ = (id: string): HTMLElement => document.getElementById(id)!;

let lastData: ScanData | null = null;
let scanPaused = false;

// ── Toast ─────────────────────────────────────────────────────
function toastMsg(msg: string, dur = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}
g.toastMsg = toastMsg;

// ── Tab switching ─────────────────────────────────────────────
document.querySelectorAll<HTMLElement>('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = btn.dataset['panel']!;
    ($('panel-' + panel) as HTMLElement).classList.add('active');

    if (panel === 'journal')     onJournalTabOpen();
    if (panel === 'history')     { loadHistorySummary(); loadHistoryData('today'); }
    if (panel === 'entry-guide') renderEntryGuide(getEgActiveIdx());
    if (panel === 'mike' && lastData) {
      reRenderTable('mike-long');
      reRenderTable('mike-short');
      $('mikeVwapTable').innerHTML = renderMikeVwapTable(lastData.mikeLargeCaps ?? []);
    }
  });
});

// ── TOS button delegation ─────────────────────────────────────
document.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-tos]');
  if (!btn) return;
  const ticker = btn.dataset['tos']!;
  navigator.clipboard.writeText(ticker).catch(() => {});
  try {
    const r = await fetch(`/api/tos/${encodeURIComponent(ticker)}`);
    const d = await r.json() as { ok: boolean; status: string };
    if (d.ok) toastMsg(`${ticker} copied — TOS focused · Ctrl+V to paste`);
    else if (d.status === 'not_found') toastMsg(`${ticker} copied — TOS not detected`);
    else toastMsg(`${ticker} copied to clipboard`);
  } catch { toastMsg(`${ticker} copied to clipboard`); }
  btn.classList.add('copied');
  btn.textContent = '✓ ' + ticker;
  setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = '<span>TOS</span>'; }, 2000);
});

// ── Mute button ───────────────────────────────────────────────
$('muteBtn').addEventListener('click', () => {
  setMuted(!muted);
  const btn = $('muteBtn');
  const lbl = $('muteBtnLabel');
  if (muted) {
    btn.classList.add('muted');
    ($('muteBtn').querySelector('.bell') as HTMLElement).textContent = '🔕';
    lbl.textContent = 'MUTED';
  } else {
    btn.classList.remove('muted');
    ($('muteBtn').querySelector('.bell') as HTMLElement).textContent = '🔔';
    lbl.textContent = 'ALERTS ON';
  }
});

// ── Pause button ──────────────────────────────────────────────
$('pauseBtn').addEventListener('click', () => {
  scanPaused = !scanPaused;
  const btn = $('pauseBtn');
  if (scanPaused) {
    btn.classList.add('paused');
    $('pauseIcon').textContent  = '▶';
    $('pauseBtnLabel').textContent = 'PAUSED';
  } else {
    btn.classList.remove('paused');
    $('pauseIcon').textContent  = '||';
    $('pauseBtnLabel').textContent = 'LIVE';
  }
});

// ── Calc button ───────────────────────────────────────────────
$('calcBtn').addEventListener('click', () => toggleCalc());
$('calcCloseBtn').addEventListener('click', () => closeCalc());
$('calcOverlay').addEventListener('click', () => closeCalc());

// ── Checklist ─────────────────────────────────────────────────
$('checklistBtn').addEventListener('click', () => openChecklist());
$('checklistCloseBtn').addEventListener('click', () => closeChecklist());
$('checklistOverlay').addEventListener('click', (e) => { if (e.target === $('checklistOverlay')) closeChecklist(); });
$('clReminderLink').addEventListener('click', (e) => { e.preventDefault(); openChecklist(); });

// ── Alert log toggle ──────────────────────────────────────────
let alertLogOpen = true;
$('alertLogHeader').addEventListener('click', () => {
  alertLogOpen = !alertLogOpen;
  $('alertLogList').style.display = alertLogOpen ? '' : 'none';
  $('alertLogToggleHint').textContent = alertLogOpen ? 'CLICK TO COLLAPSE' : 'CLICK TO EXPAND';
});

// ── Import modal ──────────────────────────────────────────────
$('importFileBtn').addEventListener('click', () => openImportModal('file'));
$('importPasteBtn').addEventListener('click', () => openImportModal('paste'));
$('importCloseBtn').addEventListener('click', () => closeImportModal());
$('importOverlay').addEventListener('click', (e) => { if (e.target === $('importOverlay')) closeImportModal(); });
$('importTabFile').addEventListener('click',  () => switchImportTab('file'));
$('importTabPaste').addEventListener('click', () => switchImportTab('paste'));
$('importChooseFileBtn').addEventListener('click', () => ($('importFileInput') as HTMLInputElement).click());
$('importFileInput').addEventListener('change', (e) => handleFileSelect(e as InputEvent));
$('importDropzone').addEventListener('dragover', handleDragOver);
$('importDropzone').addEventListener('dragleave', handleDragLeave);
$('importDropzone').addEventListener('drop', handleDrop);
$('importParsePasteBtn').addEventListener('click', () => parsePasteInput());
$('importBackBtn').addEventListener('click', () => importGoBack());
$('importCancelBtn').addEventListener('click', () => closeImportModal());
$('importAllBtn').addEventListener('click', () => confirmImportAll());
$('importDropzone').addEventListener('click', () => ($('importFileInput') as HTMLInputElement).click());

// ── Journal form ──────────────────────────────────────────────
$('journalForm').addEventListener('submit', (e) => { e.preventDefault(); handleJournalSubmit(); });
$('jDirLong').addEventListener('click',  () => setJournalDir('LONG'));
$('jDirShort').addEventListener('click', () => setJournalDir('SHORT'));

// ── History buttons ───────────────────────────────────────────
$('histBtnToday').addEventListener('click', (e) => historyFilterToday(e.currentTarget as HTMLElement));
$('histBtnWeek').addEventListener('click',  (e) => historyFilterWeek(e.currentTarget as HTMLElement));
$('histBtnAll').addEventListener('click',   (e) => historyFilterAll(e.currentTarget as HTMLElement));
$('histBtnRange').addEventListener('click', () => historyFilterRange());
$('histBtnTicker').addEventListener('click', () => historyFilterTicker());
$('histTickerFilter').addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') historyFilterTicker(); });

// ── Settings ──────────────────────────────────────────────────
$('saveSchwabBtn').addEventListener('click',     () => saveSchwabCredentials());
$('schwabConnectBtn').addEventListener('click',  () => connectSchwab());
$('schwabRefreshBtn').addEventListener('click',  () => refreshSchwabToken());
$('schwabDisconnectBtn').addEventListener('click', () => disconnectSchwab());
$('schwabAutoSyncToggle').addEventListener('change', (e) => toggleSchwabAutoSync((e.target as HTMLInputElement).checked));
$('saveTosBtn').addEventListener('click',  () => saveTosPath());
$('stopTosBtn').addEventListener('click',  () => stopTosWatcher());

// ── 5-Pillar high-priority alert in log ──────────────────────
window.addEventListener('pillar-alert', (e) => {
  const r = (e as CustomEvent<FivePillarResult>).detail;
  addToLog('pillar', r.ticker, `★ 5-PILLAR FULL — Gap ${r.gapPercent.toFixed(1)}% · Float ${r.float ? (r.float/1e6).toFixed(1)+'M' : '?'} · ${r.relativeVolume.toFixed(1)}x vol`);
});

// ── Main render ───────────────────────────────────────────────
function renderResults(data: ScanData) {
  if (scanPaused) return;
  lastData = data;

  // Meta bar
  $('metaStrip').style.display    = 'flex';
  $('metaTotal').textContent      = (data.meta?.totalSnapshotTickers ?? 0).toLocaleString();
  $('metaFiltered').textContent   = (data.meta?.filteredTickers ?? 0).toLocaleString();
  $('metaDuration').textContent   = ((data.meta?.scanDurationMs ?? 0) / 1000).toFixed(1) + 's';

  const ts = new Date(data.timestamp);
  $('lastUpdate').textContent  = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('scanTime').textContent    = ((data.meta?.scanDurationMs ?? 0) / 1000).toFixed(1) + 's';
  $('apiCalls').textContent    = String(data.meta?.apiCallsThisCycle ?? '?');
  $('tickerCount').textContent = (data.meta?.totalSnapshotTickers ?? 0).toLocaleString();

  // Update badge counts
  const upCount   = (data.gappersUp   || []).length;
  const downCount = (data.gappersDown || []).length;
  const momCount  = (data.momentum    || []).length;
  const revCount  = (data.reversals   || []).length;
  $('tabGapCount').textContent  = String(upCount + downCount);
  $('tabMomCount').textContent  = String(momCount);
  $('tabRevCount').textContent  = String(revCount);
  $('tabNewsCount').textContent = String(Object.values(data.news || {}).flat().length);
  $('tabMikeCount').textContent = String((data.mikeLargeCaps || []).length);
  $('countUp').textContent      = String(upCount);
  $('countDown').textContent    = String(downCount);
  $('countMom').textContent     = String(momCount);
  $('countRev').textContent     = String(revCount);

  // Gap scanner tables
  $('tableUp').innerHTML   = renderGapTable(data.gappersUp,   'UP',   'up');
  $('tableDown').innerHTML = renderGapTable(data.gappersDown, 'DOWN', 'down');

  // Momentum + Reversal + News
  $('tableMom').innerHTML  = renderMomTable(data.momentum, 'mom');
  $('tableRev').innerHTML  = renderRevTable(data.reversals, 'rev');
  $('tableNews').innerHTML = renderNewsTable(data);

  // Mike (only if tab active to avoid unnecessary work)
  const mikeActive = !!document.querySelector('#panel-mike.active');
  if (mikeActive) {
    $('mikeLongTable').innerHTML  = renderMikeLargeCapTable((data.mikeLargeCaps ?? []).filter(r => r.gapPercent >= 0), 'mike-long');
    $('mikeShortTable').innerHTML = renderMikeLargeCapTable((data.mikeLargeCaps ?? []).filter(r => r.gapPercent <  0), 'mike-short');
    $('mikeVwapTable').innerHTML  = renderMikeVwapTable(data.mikeLargeCaps ?? []);
  }
  $('tabMikeCount').textContent = String((data.mikeLargeCaps ?? []).length);
  if ((data.mikeLargeCaps ?? []).length > 0) {
    $('mikeStatsBar').style.display = 'block';
    $('mikeSpyGap').textContent  = (data.mikeSpyGapPct ?? 0).toFixed(2) + '%';
    $('mikeScanTime').textContent = ((data.mikeScanDurationMs ?? 0) / 1000).toFixed(1) + 's';
  }
  $('mikeTotalCount').textContent = String((data.mikeLargeCaps ?? []).length);

  // ── Phase 1 new scanner tabs ──────────────────────────────
  if (data.hodMomo)    renderHodMomoTab(data.hodMomo);
  if (data.fivePillar) { renderPillarTab(data.fivePillar); checkPillarAlerts(data.fivePillar); }
  if (data.pennyResults) renderPennyTab(data.pennyResults);
  if (data.topLists)   renderTopListsTab(data.topLists);
  if (data.earnings)   renderEarningsTab(data.earnings);
  if (data.volatilityHunter) renderVolatilityTab(data.volatilityHunter);

  // Populate calc ticker list
  updateCalcTickerList(data);

  // Update header P&L
  updateHeaderPnl();

  // News ticker
  const allNews = Object.values(data.news || {}).flat();
  if (allNews.length > 0) updateNewsTicker(allNews);

  // Check alerts + checklist
  checkAlerts(data);
  updateChecklistScannerData(data);

  // Countdown
  startCountdown(data.refreshIntervalSeconds ?? 30);
  $('statusDot').className = 'status-dot';
}

// ── SSE + polling ─────────────────────────────────────────────
function connectSSE() {
  const es = new EventSource('/api/stream');
  es.addEventListener('message', e => {
    try {
      renderResults(JSON.parse(e.data) as ScanData);
      $('loading').style.display = 'none';
      $('app').style.display = 'flex';
    } catch (err) {
      const msg = err instanceof Error ? err.message + '\n' + err.stack : String(err);
      $('loading').querySelector('.loading-text')!.textContent = 'JS ERROR: ' + msg;
      console.error('renderResults error', err);
    }
  });
  es.addEventListener('error', () => {
    $('statusDot').className = 'status-dot stale';
    es.close();
    pollFallback();
  });
}

async function pollFallback() {
  const poll = async () => {
    try {
      const res = await fetch('/api/scan-results');
      if (!res.ok) throw new Error(String(res.status));
      renderResults(await res.json() as ScanData);
      $('loading').style.display = 'none';
      $('app').style.display = 'flex';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      $('loading').querySelector('.loading-text')!.textContent = 'POLL ERROR: ' + msg;
      $('statusDot').className = 'status-dot error';
    }
  };
  await poll();
  setInterval(poll, 30_000);
}

// ── Legacy JS (ported to module scope) ───────────────────────
// The bulk of the existing code runs here. Functions that need
// to be called from other modules are re-exported via `g`.

const fmt2      = (n: number) => n.toFixed(2);
const fmtSign   = (n: number) => (n >= 0 ? '+' : '') + fmt2(n) + '%';
const fmtPrice  = (n: number) => '$' + fmt2(n);
const fmtRelVol = (n: number) => n.toFixed(1) + 'x';

function fmtVol(v: number): string {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v);
}

function fmtFloat(f: number | null | undefined): string {
  if (f == null) return '—';
  if (f >= 1e9)  return (f / 1e9).toFixed(1) + 'B';
  if (f >= 1e6)  return (f / 1e6).toFixed(1) + 'M';
  return (f / 1e3).toFixed(0) + 'K';
}

function gapClass(pct: number, dir: string): string {
  const a = Math.abs(pct);
  const p = dir === 'UP' ? 'gap-up-' : 'gap-dn-';
  if (a >= 50) return p + '5'; if (a >= 30) return p + '4';
  if (a >= 20) return p + '3'; if (a >= 10) return p + '2';
  return p + '1';
}
function volClass(rv: number): string { return rv >= 10 ? 'vol-high' : rv >= 3 ? 'vol-med' : 'vol-low'; }
function qualityColor(s: number): string {
  if (s >= 80) return '#00ff88'; if (s >= 65) return '#00e676';
  if (s >= 50) return '#ffd600'; if (s >= 35) return '#ff6d00'; return '#444444';
}
function qualityClass(s: number): string {
  if (s >= 80) return 'q-a-plus'; if (s >= 65) return 'q-a';
  if (s >= 50) return 'q-b';     if (s >= 35) return 'q-c'; return 'q-d';
}

// Sort engine — register main.ts tables in the shared registry
function registerMainReRenders() {
  reRenderRegistry['up']         = () => { if (lastData) $('tableUp').innerHTML        = renderGapTable(lastData.gappersUp,   'UP',   'up'); };
  reRenderRegistry['down']       = () => { if (lastData) $('tableDown').innerHTML      = renderGapTable(lastData.gappersDown, 'DOWN', 'down'); };
  reRenderRegistry['mom']        = () => { if (lastData) $('tableMom').innerHTML       = renderMomTable(lastData.momentum,    'mom'); };
  reRenderRegistry['rev']        = () => { if (lastData) $('tableRev').innerHTML       = renderRevTable(lastData.reversals,   'rev'); };
  reRenderRegistry['news']       = () => { if (lastData) $('tableNews').innerHTML      = renderNewsTable(lastData); };
  reRenderRegistry['mike-long']  = () => { if (lastData) $('mikeLongTable').innerHTML  = renderMikeLargeCapTable((lastData.mikeLargeCaps ?? []).filter(r => r.gapPercent >= 0), 'mike-long'); };
  reRenderRegistry['mike-short'] = () => { if (lastData) $('mikeShortTable').innerHTML = renderMikeLargeCapTable((lastData.mikeLargeCaps ?? []).filter(r => r.gapPercent <  0), 'mike-short'); };
}
registerMainReRenders();

// Daily chart / stock type helpers
function dailyGradeHtml(grade?: string): string {
  if (!grade) return '<span class="daily-d">—</span>';
  const cls = grade === 'A+' ? 'daily-aplus' : grade === 'A' ? 'daily-a' : grade === 'B' ? 'daily-b' : grade === 'C' ? 'daily-c' : 'daily-d';
  return `<span class="${cls}">${grade}</span>`;
}
function emaArrowHtml(arrow?: string): string {
  if (!arrow) return '';
  const cls = arrow === 'UP' ? 'ema-arrow-up' : arrow === 'MIXED' ? 'ema-arrow-mixed' : 'ema-arrow-down';
  const sym = arrow === 'UP' ? '▲' : arrow === 'MIXED' ? '→' : '▼';
  return `<span class="${cls}">${sym}</span>`;
}
function ema200DistHtml(dist?: number | null): string {
  if (dist == null) return '<span style="color:var(--text-dim)">—</span>';
  const sign = dist >= 0 ? '+' : '';
  const cls  = dist >= 0 ? 'ema-dist-pos' : 'ema-dist-neg';
  return `<span class="${cls}">${sign}$${Math.abs(dist).toFixed(2)}</span>`;
}
function stockTypeHtml(type?: string | null, momoInfo?: unknown): string {
  if (!type) return '';
  const map: Record<string, [string, string]> = {
    'BLUE_SKY':    ['type-blue-sky',   'BLUE SKY'],
    'IPO':         ['type-ipo',         'IPO'],
    'R/S':         ['type-rs',          'R/S'],
    'FORMER_MOMO': ['type-former-momo', 'MOMO'],
  };
  const [cls, label] = map[type] || ['', type];
  let ttAttr = '';
  if (type === 'FORMER_MOMO' && momoInfo) {
    const mi = momoInfo as { pct: number; date: string; daysAgo: number };
    const sign    = mi.pct >= 0 ? '+' : '';
    const dateStr = new Date(mi.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    ttAttr = ` data-tt="Former runner: ${sign}${mi.pct.toFixed(1)}% on ${dateStr} (${mi.daysAgo}d ago)"`;
  }
  return `<span class="type-badge ${cls}"${ttAttr}>${label}</span>`;
}

function catBadgeHtml(catalyst?: { type?: string; strength?: string } | null): string {
  if (!catalyst) return '<span class="cat-badge cat-neutral">News</span>';
  const cls = catalyst.strength === 'strong' ? 'cat-strong' : catalyst.strength === 'moderate' ? 'cat-moderate' : catalyst.strength === 'negative' ? 'cat-negative' : 'cat-neutral';
  return `<span class="cat-badge ${cls}">${catalyst.type}</span>`;
}

function catCellHtml(news: { catalyst?: unknown; title?: string; articleUrl?: string } | null, hasS3: boolean): string {
  const s3 = hasS3 ? '<span class="s3-badge" title="Active shelf registration">⚠ S3</span>' : '';
  if (!news) return `<span class="cat-badge cat-neutral" style="opacity:.5">No news</span>${s3}`;
  const n = news as { catalyst: unknown; title: string; articleUrl: string };
  const truncated = n.title.length > 50 ? n.title.slice(0, 47) + '…' : n.title;
  return `${catBadgeHtml(n.catalyst as { type?: string; strength?: string })} <a class="cat-headline" href="${n.articleUrl}" target="_blank" title="${n.title.replace(/"/g,'&quot;')}">${truncated}</a>${s3}`;
}

function tosBtnHtml(ticker: string): string {
  return `<button class="tos-btn" data-tos="${ticker}"><span>TOS</span></button>`;
}
function calcBtnHtml(ticker: string, price: number): string {
  return `<button class="calc-row-btn" onclick="openCalcForTicker('${ticker}',${price})" title="Size position for ${ticker}">[C]</button>`;
}

// ── Gap table ─────────────────────────────────────────────────
function renderGapTable(rows: unknown[], dir: string, tableId: string): string {
  if (!rows || rows.length === 0) return `<div class="empty-state">No ${dir === 'UP' ? 'gappers up' : 'gappers down'} found.</div>`;
  const s = sortState[tableId] ?? { col: 'gapPercent', dir: -1 };
  const sorted = sortRows(rows as Record<string, unknown>[], s.col, s.dir);
  let html = `<table class="scanner-table"><thead><tr>
    ${th(tableId,'rank','#','left')}${th(tableId,'ticker','Ticker','left')}${th(tableId,'price','Price')}
    ${th(tableId,'gapPercent','Gap %')}${th(tableId,'float','Float')}${th(tableId,'volume','Volume')}
    ${th(tableId,'relativeVolume','Rel.Vol')}${th(tableId,'changeFromOpen','Chg/Open')}
    ${th(tableId,'qualityScore','Quality')}${th(tableId,'dailyGrade','Daily')}
    ${th(tableId,'ema200Dist','200 EMA')}${th(tableId,'stockType','Type','left')}
    <th data-nosort style="min-width:180px">Catalyst</th><th data-nosort></th>
  </tr></thead><tbody>`;

  for (const row of sorted) {
    const r = row as Record<string, unknown>;
    const gc = gapClass(r['gapPercent'] as number, dir);
    const vc = volClass(r['relativeVolume'] as number);
    const floatCls = (r['float'] as number | null) !== null && (r['float'] as number) < 10e6 ? 'float-low' : 'float-norm';
    const chgClass = (r['changeFromOpen'] as number) >= 0 ? 'chg-pos' : 'chg-neg';
    const qClass = qualityClass(r['qualityScore'] as number);
    const qFill  = qualityColor(r['qualityScore'] as number);
    const s3     = r['hasS3'] === true;
    const s3Badge = s3 ? '<span class="s3-badge" title="Active shelf registration">⚠ S3</span>' : '';
    const qPct   = Math.min(r['qualityScore'] as number, 110) / 110 * 100;
    html += `<tr>
      <td class="left"><span class="rank">${r['rank']}</span></td>
      <td class="left"><span class="ticker">${r['ticker']}</span>${s3Badge}</td>
      <td class="price">${fmtPrice(r['price'] as number)}</td>
      <td class="${gc}">${fmtSign(r['gapPercent'] as number)}</td>
      <td class="${floatCls}">${fmtFloat(r['float'] as number | null)}</td>
      <td class="${vc}">${fmtVol(r['volume'] as number)}</td>
      <td class="${vc}">${fmtRelVol(r['relativeVolume'] as number)}</td>
      <td class="${chgClass}">${fmtSign(r['changeFromOpen'] as number)}</td>
      <td><div class="quality-wrap">
        <div class="quality-bar"><div class="quality-fill" style="width:${qPct}%;background:${qFill}"></div></div>
        <span class="quality-num ${qClass}">${r['qualityScore']}</span>
      </div></td>
      <td><div class="daily-cell">${dailyGradeHtml(r['dailyGrade'] as string)}${emaArrowHtml(r['emaArrow'] as string)}</div></td>
      <td>${ema200DistHtml(r['ema200Dist'] as number | null)}</td>
      <td class="left">${stockTypeHtml(r['stockType'] as string | null, r['momoInfo'])}</td>
      <td>${catCellHtml(r['latestNews'] as {catalyst: unknown; title: string; articleUrl: string} | null, s3)}</td>
      <td><div class="action-btns">${tosBtnHtml(r['ticker'] as string)}${calcBtnHtml(r['ticker'] as string, r['price'] as number)}</div></td>
    </tr>`;
  }
  return html + '</tbody></table>';
}

// ── Momentum table ────────────────────────────────────────────
function renderMomTable(rows: unknown[], tableId: string): string {
  if (!rows || rows.length === 0) return '<div class="empty-state">No momentum plays found.</div>';
  const s = sortState[tableId] ?? { col: 'changePercent', dir: -1 };
  const sorted = sortRows(rows as Record<string, unknown>[], s.col, s.dir);
  let html = `<table class="scanner-table"><thead><tr>
    ${th(tableId,'ticker','Ticker','left')}${th(tableId,'price','Price')}
    ${th(tableId,'changePercent','Chg %')}${th(tableId,'relativeVolume','Rel.Vol')}
    ${th(tableId,'float','Float')}${th(tableId,'volume','Volume')}
    ${th(tableId,'highOfDay','HOD')}${th(tableId,'distanceFromHigh','Dist HOD')}
    ${th(tableId,'triggerType','Trigger','left')}${th(tableId,'aboveVWAP','VWAP')}
    <th data-nosort></th>
  </tr></thead><tbody>`;

  for (const row of sorted) {
    const r = row as Record<string, unknown>;
    const chgCls = (r['changePercent'] as number) >= 0 ? 'chg-pos' : 'chg-neg';
    const vc     = volClass(r['relativeVolume'] as number);
    const fc     = (r['float'] as number | null) !== null && (r['float'] as number) < 10e6 ? 'float-low' : 'float-norm';
    const distCls = (r['distanceFromHigh'] as number) <= 1 ? 'gap-up-4' : 'chg-neg';
    const vwapCls = r['aboveVWAP'] ? 'vwap-above' : 'vwap-below';
    const trigCls = r['triggerType'] === 'NEW_HIGH' ? 'badge-new-high' : r['triggerType'] === 'LOW_FLOAT_BOUNCE' ? 'badge-lf-bounce' : 'badge-breakout';
    const momoSpan = r['isMomo'] ? '<span class="type-badge type-former-momo" style="margin-left:4px">MOMO</span>' : '';
    html += `<tr>
      <td class="left"><span class="ticker">${r['ticker']}</span>${momoSpan}</td>
      <td>${fmtPrice(r['price'] as number)}</td>
      <td class="${chgCls}">${fmtSign(r['changePercent'] as number)}</td>
      <td class="${vc}">${fmtRelVol(r['relativeVolume'] as number)}</td>
      <td class="${fc}">${fmtFloat(r['float'] as number | null)}</td>
      <td class="${vc}">${fmtVol(r['volume'] as number)}</td>
      <td>${fmtPrice(r['highOfDay'] as number)}</td>
      <td class="${distCls}">${(r['distanceFromHigh'] as number).toFixed(1)}%</td>
      <td class="left"><span class="${trigCls}">${r['triggerType']}</span></td>
      <td class="${vwapCls}">${r['aboveVWAP'] ? '▲' : '▼'} ${fmtPrice(r['vwap'] as number)}</td>
      <td>${tosBtnHtml(r['ticker'] as string)}${calcBtnHtml(r['ticker'] as string, r['price'] as number)}</td>
    </tr>`;
  }
  return html + '</tbody></table>';
}

// ── Reversal table ────────────────────────────────────────────
function renderRevTable(rows: unknown[], tableId: string): string {
  if (!rows || rows.length === 0) return '<div class="empty-state">No reversal setups detected.</div>';
  const s = sortState[tableId] ?? { col: 'rsi2', dir: -1 };
  const sorted = sortRows(rows as Record<string, unknown>[], s.col, s.dir);
  let html = `<table class="scanner-table"><thead><tr>
    ${th(tableId,'ticker','Ticker','left')}${th(tableId,'price','Price')}
    ${th(tableId,'direction','Dir')}${th(tableId,'setupType','Setup')}
    ${th(tableId,'consecutiveCandles5m','5m')}${th(tableId,'consecutiveCandles1m','1m')}
    ${th(tableId,'rsi2','RSI(2)')}${th(tableId,'outsideBand','BB')}
    ${th(tableId,'candlePattern','Pattern','left')}${th(tableId,'multiTimeframeAlignment','Multi-TF')}
    <th data-nosort></th>
  </tr></thead><tbody>`;

  for (const row of sorted) {
    const r = row as Record<string, unknown>;
    const dirCls  = r['direction'] === 'TOP' ? 'dir-top' : 'dir-bot';
    const dirSym  = r['direction'] === 'TOP' ? '⬇ TOP' : '⬆ BOT';
    const rsiCls  = (r['rsi2'] as number) > 70 ? 'rsi-high' : (r['rsi2'] as number) < 30 ? 'rsi-low' : 'rsi-norm';
    const bbCls   = r['outsideBand'] ? 'bb-outside' : 'bb-inside';
    const patCls  = r['candlePattern'] ? 'pattern-val' : 'pattern-nil';
    const mtfCls  = r['multiTimeframeAlignment'] ? 'multi-tf-yes' : 'multi-tf-no';
    const stpCls  = r['setupType'] === 'MULTI_TF' ? 'setup-multi' : r['setupType'] === 'SETUP_1_5MIN' ? 'setup-5min' : 'setup-1min';
    html += `<tr>
      <td class="left"><span class="ticker">${r['ticker']}</span></td>
      <td>${fmtPrice(r['price'] as number)}</td>
      <td class="${dirCls}">${dirSym}</td>
      <td class="${stpCls}">${r['setupType']}</td>
      <td>${r['consecutiveCandles5m']}</td>
      <td>${r['consecutiveCandles1m']}</td>
      <td class="${rsiCls}">${(r['rsi2'] as number).toFixed(0)}</td>
      <td class="${bbCls}">${r['outsideBand'] ? 'OUT' : 'IN'}</td>
      <td class="left ${patCls}">${r['candlePattern'] ?? '—'}</td>
      <td class="${mtfCls}">${r['multiTimeframeAlignment'] ? '✓ YES' : 'NO'}</td>
      <td>${tosBtnHtml(r['ticker'] as string)}</td>
    </tr>`;
  }
  return html + '</tbody></table>';
}

// ── News table ────────────────────────────────────────────────
function renderNewsTable(data: ScanData): string {
  const newsMap = data.news || {};
  const s3Set   = new Set(data.s3Flags || []);
  const allItems: Array<{ ticker: string } & Record<string, unknown>> = [];
  for (const [ticker, items] of Object.entries(newsMap)) {
    for (const item of items) allItems.push({ ...item as Record<string, unknown>, ticker });
  }
  allItems.sort((a, b) => ((b['publishedUtc'] as string) || '').localeCompare((a['publishedUtc'] as string) || ''));
  $('tabNewsCount').textContent = String(allItems.length);
  $('countNews').textContent    = String(allItems.length);
  if (allItems.length === 0) return '<div class="empty-state">No news found for current scanner results.</div>';

  let html = `<table class="news-table"><thead><tr>
    <th style="width:60px">Time</th><th style="width:70px">Ticker</th>
    <th style="width:130px">Catalyst</th><th>Headline</th><th style="width:100px">Source</th>
  </tr></thead><tbody>`;
  for (const r of allItems) {
    const ts   = new Date(r['publishedUtc'] as string);
    const time = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const date = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const s3   = s3Set.has(r['ticker']) ? '<span class="s3-badge" title="Active shelf registration">⚠ S3</span>' : '';
    html += `<tr>
      <td class="news-time">${date}<br>${time}</td>
      <td><span class="news-ticker">${r['ticker']}</span>${s3}</td>
      <td>${catBadgeHtml(r['catalyst'] as { type?: string; strength?: string })}</td>
      <td><div class="news-title"><a href="${r['articleUrl']}" target="_blank">${r['title']}</a></div>
          ${r['description'] ? `<div class="news-source">${(r['description'] as string).slice(0,120)}${(r['description'] as string).length>120?'…':''}</div>` : ''}</td>
      <td class="news-source">${r['publisher'] || '—'}</td>
    </tr>`;
  }
  return html + '</tbody></table>';
}

// ── Mike tables ───────────────────────────────────────────────
function renderMikeLargeCapTable(rows: unknown[], tableId: string): string {
  if (!rows || rows.length === 0) return '<div class="empty-state">No candidates.</div>';
  const s = sortState[tableId] ?? { col: 'convictionScore', dir: -1 };
  const sorted = sortRows(rows as Record<string, unknown>[], s.col, s.dir);
  let html = `<table class="scanner-table"><thead><tr>
    ${th(tableId,'ticker','Ticker','left')}${th(tableId,'price','Price')}
    ${th(tableId,'gapPercent','Gap %')}${th(tableId,'rsvsSPY','RS vs SPY')}
    ${th(tableId,'relativeVolume','Rel.Vol')}${th(tableId,'atrPct','ATR %')}
    ${th(tableId,'isSweetSpot','Sweet Spot')}${th(tableId,'aboveDailySMA200','SMA200')}
    ${th(tableId,'vwapPosition','VWAP')}${th(tableId,'convictionScore','Conviction')}
    <th data-nosort></th>
  </tr></thead><tbody>`;

  for (const row of sorted) {
    const r = row as Record<string, unknown>;
    const cs = r['convictionScore'] as number;
    const rowCls = cs === 5 ? 'mike-conviction-5' : cs === 4 ? 'mike-conviction-4' : cs === 3 ? 'mike-conviction-3' : '';
    const gapCls   = (r['gapPercent'] as number) >= 0 ? 'chg-pos' : 'chg-neg';
    const rsCls    = (r['rsvsSPY'] as number) > 0 ? 'mike-leads-spy' : '';
    const vc       = volClass(r['relativeVolume'] as number);
    const sweetCls = r['isSweetSpot'] ? 'mike-sweet-spot' : '';
    const smaCls   = r['aboveDailySMA200'] ? 'mike-sma-above' : 'mike-sma-below';
    const vwapCls  = r['vwapPosition'] === 'ABOVE' ? 'vwap-above' : r['vwapPosition'] === 'BELOW' ? 'vwap-below' : '';
    const stars    = '★'.repeat(cs) + '☆'.repeat(5 - cs);
    html += `<tr class="${rowCls}">
      <td class="left"><span class="ticker">${r['ticker']}</span></td>
      <td>${fmtPrice(r['price'] as number)}</td>
      <td class="${gapCls}">${fmtSign(r['gapPercent'] as number)}</td>
      <td class="${rsCls}">${(r['rsvsSPY'] as number) >= 0 ? '+' : ''}${(r['rsvsSPY'] as number).toFixed(2)}%</td>
      <td class="${vc}">${fmtRelVol(r['relativeVolume'] as number)}</td>
      <td>${(r['atrPct'] as number).toFixed(1)}%</td>
      <td class="${sweetCls}">${r['isSweetSpot'] ? '✓ $40–$70' : '—'}</td>
      <td class="${smaCls}">${r['aboveDailySMA200'] ? '▲ ABOVE' : '▼ BELOW'}</td>
      <td class="${vwapCls}">${r['vwapPosition'] ?? '—'}</td>
      <td>${stars} <span style="color:var(--text-muted);font-size:10px">${cs}/5</span></td>
      <td>${tosBtnHtml(r['ticker'] as string)}</td>
    </tr>`;
  }
  return html + '</tbody></table>';
}

function renderMikeVwapTable(rows: unknown[]): string {
  const top5 = (rows as Record<string, unknown>[]).slice(0, 5);
  if (top5.length === 0) return '<div class="empty-state">No large cap candidates.</div>';
  let html = `<table class="scanner-table"><thead><tr>
    <th class="left">Ticker</th><th>Price</th><th>VWAP</th><th class="left">Signal</th>
  </tr></thead><tbody>`;
  for (const r of top5) {
    const vCls = r['vwapPosition'] === 'ABOVE' ? 'vwap-above' : 'vwap-below';
    html += `<tr>
      <td class="left"><span class="ticker">${r['ticker']}</span></td>
      <td>${fmtPrice(r['price'] as number)}</td>
      <td class="${vCls}">${r['vwap'] ? fmtPrice(r['vwap'] as number) : '—'}</td>
      <td class="left ${vCls}">${r['vwapSignal'] ?? '—'}</td>
    </tr>`;
  }
  return html + '</tbody></table>';
}

// ── Countdown ring ────────────────────────────────────────────
let countdownInterval: ReturnType<typeof setInterval> | null = null;
let countdownSecs = 30;
const CIRCUMFERENCE = 2 * Math.PI * 11;

function startCountdown(totalSecs: number) {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownSecs = totalSecs;
  const circle  = $('progressCircle') as unknown as SVGCircleElement;
  const countEl = $('refreshCount');
  const tick = () => {
    countdownSecs = Math.max(0, countdownSecs - 1);
    countEl.textContent = String(countdownSecs);
    circle.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - countdownSecs / totalSecs));
  };
  circle.style.strokeDasharray  = String(CIRCUMFERENCE);
  circle.style.strokeDashoffset = '0';
  tick();
  countdownInterval = setInterval(tick, 1000);
}

// ── News ticker ───────────────────────────────────────────────
type AnyNewsItem = Record<string, unknown>;
function updateNewsTicker(items: AnyNewsItem[]) {
  const inner = $('newsTickerInner');
  if (!inner) return;
  const html = items.slice(0, 20).map(item => `
    <span class="news-ticker-item">
      <span class="nt-ticker">${item['tickers'] ? (item['tickers'] as string[]).join(', ') : ''}</span>
      <span class="nt-sep">//</span>
      <span>${item['title'] as string}</span>
    </span>`).join('');
  inner.innerHTML = html + html; // duplicate for seamless loop
}

// ── Alert system ──────────────────────────────────────────────
const alertLog: unknown[] = [];
const MAX_LOG = 40;
const COOLDOWN_MS = 5 * 60 * 1000;
const alertHistory = new Map<string, number>();
const seenHeadlineIds = new Set<string>();
let newsInitialized = false;

function shouldFire(type: string, ticker: string): boolean {
  const key = `${type}:${ticker}`;
  const last = alertHistory.get(key) ?? 0;
  if (Date.now() - last > COOLDOWN_MS) { alertHistory.set(key, Date.now()); return true; }
  return false;
}

function flashRow(ticker: string) {
  document.querySelectorAll<HTMLElement>('.scanner-table tbody tr').forEach(row => {
    if (row.querySelector('.ticker')?.textContent?.trim() === ticker) {
      row.classList.remove('alert-flash');
      void row.offsetWidth;
      row.classList.add('alert-flash');
    }
  });
}

function addToLog(type: string, ticker: string, msg: string) {
  const list = $('alertLogList');
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const badgeClass = type === 'gap' ? 'al-gap' : type === 'momentum' ? 'al-mom' : type === 'reversal' ? 'al-rev' : type === 'pillar' ? 'al-pillar' : 'al-news';
  const badgeText  = type === 'gap' ? 'GAP QUALITY' : type === 'momentum' ? 'NEW HIGH' : type === 'reversal' ? 'REVERSAL' : type === 'pillar' ? '5-PILLAR' : 'NEWS';
  alertLog.push({ type, ticker, msg, time });
  const entry = document.createElement('div');
  entry.className = 'alert-entry';
  entry.innerHTML = `<span class="al-time">${time}</span><span class="al-badge ${badgeClass}">${badgeText}</span><span class="al-ticker">${ticker}</span><span class="al-msg">${msg}</span>`;
  list.prepend(entry);
  while (list.children.length > MAX_LOG) list.removeChild(list.lastChild!);
  $('alertCount').textContent = String(alertLog.length);
  $('alertLog').style.display = '';
}
g.addToLog = addToLog;

function sendNotif(title: string, body: string, tag: string) {
  if (Notification.permission !== 'granted') return;
  new Notification(title, { body, tag, icon: '/favicon.ico' });
}

import { soundGap, soundMomentum, soundReversal, soundNewsStrong, soundNewsModerate, soundNewsNegative } from './audio';

function checkAlerts(data: ScanData) {
  if (muted) return;
  const allGappers = [...(data.gappersUp || []), ...(data.gappersDown || [])];
  for (const r of allGappers) {
    if ((r.qualityScore ?? 0) > 75 && shouldFire('gap', r.ticker)) {
      soundGap();
      const dir = r.gapPercent >= 0 ? '+' : '';
      sendNotif(`🟢 GAP ALERT — ${r.ticker}`, `Quality ${r.qualityScore}/100 · Gap ${dir}${r.gapPercent.toFixed(1)}% · $${r.price.toFixed(2)}`, `gap:${r.ticker}`);
      addToLog('gap', r.ticker, `Score ${r.qualityScore} · Gap ${dir}${r.gapPercent.toFixed(1)}%`);
      flashRow(r.ticker);
    }
  }
  for (const r of (data.momentum || [])) {
    if (r.triggerType === 'NEW_HIGH' && r.float !== null && r.float < 10_000_000 && shouldFire('momentum', r.ticker)) {
      soundMomentum();
      const floatStr = r.float ? (r.float / 1e6).toFixed(1) + 'M' : '?';
      sendNotif(`🔥 NEW HIGH — ${r.ticker}`, `Float ${floatStr} · +${r.changePercent.toFixed(1)}% · $${r.price.toFixed(2)}`, `momentum:${r.ticker}`);
      addToLog('momentum', r.ticker, `Float ${floatStr} · +${r.changePercent.toFixed(1)}% · ${r.relativeVolume.toFixed(1)}x vol`);
      flashRow(r.ticker);
    }
  }
  for (const r of (data.reversals || [])) {
    if (r.multiTimeframeAlignment && shouldFire('reversal', r.ticker)) {
      soundReversal();
      const dir = r.direction === 'TOP' ? '⬇ TOP reversal' : '⬆ BOTTOM reversal';
      sendNotif(`🔄 REVERSAL — ${r.ticker}`, `${dir} · RSI ${r.rsi2.toFixed(0)}`, `reversal:${r.ticker}`);
      addToLog('reversal', r.ticker, `${dir} · RSI ${r.rsi2.toFixed(0)}`);
      flashRow(r.ticker);
    }
  }
  checkNewsAlerts(data);
}

function checkNewsAlerts(data: ScanData) {
  if (muted) return;
  const newsMap = data.news || {};
  const allItems = Object.values(newsMap).flat() as AnyNewsItem[];
  if (!newsInitialized) { allItems.forEach(i => seenHeadlineIds.add(i['id'] as string)); newsInitialized = true; return; }
  const scannedTickers = new Set([
    ...(data.gappersUp || []).map(r => r.ticker),
    ...(data.gappersDown || []).map(r => r.ticker),
    ...(data.momentum || []).map(r => r.ticker),
  ]);
  for (const [ticker, items] of Object.entries(newsMap)) {
    if (!scannedTickers.has(ticker)) continue;
    for (const item of items as AnyNewsItem[]) {
      if (seenHeadlineIds.has(item['id'] as string)) continue;
      seenHeadlineIds.add(item['id'] as string);
      const cat = item['catalyst'] as { strength?: string; type?: string } | undefined;
      const strength = cat?.strength ?? 'neutral';
      const type     = cat?.type ?? 'News';
      if (strength === 'strong') soundNewsStrong();
      else if (strength === 'negative') soundNewsNegative();
      else soundNewsModerate();
      sendNotif(`📰 ${type} — ${ticker}`, item['title'] as string, `news:${ticker}:${item['id']}`);
      addToLog('news', ticker, `[${type}] ${(item['title'] as string).slice(0, 70)}`);
      flashRow(ticker);
    }
  }
}

// ── Feature modules ────────────────────────────────────────────
import {
  initCalc, toggleCalc, openCalc, closeCalc, openCalcForTicker,
  updateCalcTickerList, getCalcPriceMap, getScannerSourceMap, syncPnlToCalc,
} from './tabs/calc';
import {
  initChecklist, openChecklist, closeChecklist, updateChecklistScannerData,
} from './tabs/checklist';
import {
  initJournal, onJournalTabOpen, handleJournalSubmit, setJournalDir,
  updateHeaderPnl, loadJournalTrades, getJournalTrades, getWeekStart,
} from './tabs/journal';
import type { Trade } from './tabs/journal';
import {
  initImport, openImportModal, closeImportModal, switchImportTab,
  handleFileSelect, handleDragOver, handleDragLeave, handleDrop,
  parsePasteInput, importGoBack, confirmImportAll,
} from './tabs/import';
import {
  loadHistorySummary, loadHistoryData, historyFilterToday,
  historyFilterWeek, historyFilterAll, historyFilterRange, historyFilterTicker,
} from './tabs/history';
import {
  initSettings, loadSettings, loadSchwabStatus, saveSchwabCredentials,
  connectSchwab, refreshSchwabToken, disconnectSchwab, toggleSchwabAutoSync,
  saveTosPath, stopTosWatcher, initSchwabSSE,
} from './tabs/settings';
import { renderEntryGuide, getEgActiveIdx } from './tabs/entry-guide';

// Re-expose helpers for legacy inline handlers
g.sortTable = sortTable;
g.addToLog  = addToLog;
g.toastMsg  = toastMsg;

// ── Init feature modules ───────────────────────────────────────
initCalc();

initJournal({
  getPriceMap:  getCalcPriceMap,
  getSourceMap: getScannerSourceMap,
  getLastData:  () => lastData,
  onTradesChanged: (trades: Trade[]) => {
    const today = new Date().toISOString().split('T')[0];
    const pnl = trades.filter(t => t.timestamp.startsWith(today)).reduce((s, t) => s + t.pnlDollar, 0);
    syncPnlToCalc(pnl);
    updateHeaderPnl();
  },
});

initImport({
  getTickerPriceMap:  getCalcPriceMap,
  getScannerSourceMap: getScannerSourceMap,
  onImportDone: () => { loadJournalTrades(); },
  toastMsg,
});

initChecklist(() => getJournalTrades() as Array<{ timestamp: string; pnlDollar: number }>);

initSettings({ toastMsg, onSchwabSync: () => { loadJournalTrades(); } });
initSchwabSSE(() => { loadJournalTrades(); });

// Wire settings tab click
document.querySelectorAll('.tab[data-panel="settings"]').forEach(btn => {
  btn.addEventListener('click', () => { loadSettings(); loadSchwabStatus(); });
});

// ── Boot ──────────────────────────────────────────────────────
Notification.requestPermission().catch(() => {});
connectSSE();
setTimeout(() => { if ($('loading').style.display !== 'none') pollFallback(); }, 3000);
