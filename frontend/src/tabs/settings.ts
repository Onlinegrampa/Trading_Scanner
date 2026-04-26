const $ = (id: string): HTMLElement => document.getElementById(id)!;
let _toastMsg: (msg: string) => void = () => {};
let _onSync: () => void = () => {};

export function initSettings(opts: { toastMsg: (msg: string) => void; onSchwabSync: () => void }) {
  _toastMsg = opts.toastMsg;
  _onSync   = opts.onSchwabSync;
}

function updateTosWatcherStatus(active: boolean, path: string) {
  const el = $('tosWatcherStatus');
  if (active) {
    el.className = 'tos-watcher-status active';
    el.textContent = `✓ Watching: ${path}`;
  } else {
    el.className = 'tos-watcher-status inactive';
    el.textContent = 'Not active — enter a path and click Save to start';
  }
}

function updateSchwabStatusUI(s: { status: string; configured?: boolean; autoSync?: boolean; config?: Record<string, string> }) {
  const badge = document.getElementById('schwabStatusBadge');
  if (!badge) return;
  badge.className = `schwab-status-badge ${s.status}`;
  badge.textContent = s.status === 'connected' ? '✓ Connected' : s.status === 'expired' ? '⚠ Token Expired' : '⚫ Not Configured';
  const syncBadge = document.getElementById('schwabSyncBadge');
  if (syncBadge) syncBadge.classList.toggle('show', !!s.autoSync);
  const connectBtn = document.getElementById('schwabConnectBtn') as HTMLButtonElement | null;
  const refreshBtn = document.getElementById('schwabRefreshBtn') as HTMLButtonElement | null;
  if (connectBtn) connectBtn.disabled = !s.configured;
  if (refreshBtn) refreshBtn.disabled = s.status !== 'connected' && s.status !== 'expired';
}

export async function loadSettings() {
  try {
    const r = await fetch('/api/settings');
    const s = await r.json() as { tosAlertLogPath?: string; tosWatcherActive?: boolean; tosWatcherPath?: string; schwabAutoSync?: boolean };
    if (s.tosAlertLogPath) (document.getElementById('tosLogPath') as HTMLInputElement).value = s.tosAlertLogPath;
    updateTosWatcherStatus(!!s.tosWatcherActive, s.tosWatcherPath ?? '');
    if (s.schwabAutoSync) (document.getElementById('schwabAutoSyncToggle') as HTMLInputElement).checked = true;
  } catch {}
}

export async function loadSchwabStatus() {
  try {
    const r = await fetch('/api/schwab/status');
    const s = await r.json() as { status: string; configured?: boolean; autoSync?: boolean; config?: Record<string, string> };
    updateSchwabStatusUI(s);
    if (s.config) {
      const set = (id: string, v?: string) => { if (v) (document.getElementById(id) as HTMLInputElement).value = v; };
      set('schwabAppKey',      s.config['appKey']);
      set('schwabCallbackUrl', s.config['callbackUrl']);
      set('schwabAccountId',   s.config['accountId']);
      if (s.config['appSecretMasked']) {
        (document.getElementById('schwabAppSecret') as HTMLInputElement).placeholder = s.config['appSecretMasked'];
      }
    }
    if (s.autoSync) (document.getElementById('schwabAutoSyncToggle') as HTMLInputElement).checked = true;
  } catch {}
}

export async function saveSchwabCredentials() {
  const body: Record<string, string> = {};
  const key = (document.getElementById('schwabAppKey') as HTMLInputElement)?.value.trim();
  const sec = (document.getElementById('schwabAppSecret') as HTMLInputElement)?.value.trim();
  const url = (document.getElementById('schwabCallbackUrl') as HTMLInputElement)?.value.trim();
  const acc = (document.getElementById('schwabAccountId') as HTMLInputElement)?.value.trim();
  if (key) body['appKey']      = key;
  if (sec) body['appSecret']   = sec;
  if (url) body['callbackUrl'] = url;
  if (acc) body['accountId']   = acc;
  if (!Object.keys(body).length) { alert('Enter at least one credential field'); return; }
  try {
    const r = await fetch('/api/schwab/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json() as { ok: boolean };
    if (d.ok) { _toastMsg('💾 Schwab credentials saved'); loadSchwabStatus(); }
  } catch (e) { alert('Failed: ' + (e as Error).message); }
}

export function connectSchwab() {
  window.open('/auth/schwab', '_blank', 'width=600,height=700');
  const poll = setInterval(async () => {
    try {
      const r = await fetch('/api/schwab/status');
      const s = await r.json() as { status: string };
      if (s.status === 'connected') { clearInterval(poll); loadSchwabStatus(); _toastMsg('✅ Schwab connected!'); }
    } catch {}
  }, 3000);
  setTimeout(() => clearInterval(poll), 120_000);
}

export async function refreshSchwabToken() {
  try {
    const r = await fetch('/api/schwab/refresh-token', { method: 'POST' });
    const d = await r.json() as { ok: boolean; error?: string };
    if (d.ok) { loadSchwabStatus(); _toastMsg('🔄 Schwab token refreshed'); }
    else alert('Refresh failed: ' + d.error);
  } catch (e) { alert('Failed: ' + (e as Error).message); }
}

export async function disconnectSchwab() {
  if (!confirm('Disconnect Schwab and clear stored tokens?')) return;
  await fetch('/api/schwab/disconnect', { method: 'POST' });
  loadSchwabStatus();
  (document.getElementById('schwabAutoSyncToggle') as HTMLInputElement).checked = false;
  _toastMsg('Schwab disconnected');
}

export async function toggleSchwabAutoSync(enabled: boolean) {
  try {
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schwabAutoSync: enabled }) });
    const syncBadge = document.getElementById('schwabSyncBadge');
    if (syncBadge) syncBadge.classList.toggle('show', enabled);
    const result = $('schwabSyncResult');
    result.textContent = enabled ? 'Auto-sync active — syncing every 60s' : 'Auto-sync disabled';
    if (enabled) triggerSchwabSync();
  } catch (e) { alert('Failed: ' + (e as Error).message); }
}

async function triggerSchwabSync() {
  const result = document.getElementById('schwabSyncResult');
  if (result) result.textContent = '⏳ Syncing...';
  try {
    const r = await fetch('/api/schwab/sync', { method: 'POST' });
    const d = await r.json() as { ok: boolean; imported: number; skipped: number; error?: string };
    if (d.ok) {
      if (result) result.textContent = `✓ Synced: ${d.imported} new, ${d.skipped} already present`;
      if (d.imported > 0) _onSync();
    } else {
      if (result) result.textContent = `✗ ${d.error}`;
    }
  } catch (e) {
    if (result) result.textContent = `✗ ${(e as Error).message}`;
  }
}

export async function saveTosPath() {
  const path = (document.getElementById('tosLogPath') as HTMLInputElement)?.value.trim();
  try {
    const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tosAlertLogPath: path }) });
    const s = await r.json() as { settings: { tosAlertLogPath?: string } };
    updateTosWatcherStatus(!!(s.settings.tosAlertLogPath && path), path);
    _toastMsg(path ? `🔔 TOS Watcher started: ${path}` : '🔔 TOS Watcher stopped');
  } catch (e) { alert('Failed to save: ' + (e as Error).message); }
}

export async function stopTosWatcher() {
  (document.getElementById('tosLogPath') as HTMLInputElement).value = '';
  await saveTosPath();
}

export function initSchwabSSE(onSync: () => void) {
  try {
    const es = new EventSource('/api/schwab/stream');
    es.addEventListener('message', e => {
      const d = JSON.parse(e.data) as { status: string };
      const badge = document.getElementById('schwabSyncBadge');
      if (!badge) return;
      if (d.status === 'syncing') { badge.textContent = 'SYNCING…'; badge.classList.add('syncing'); }
      else if (d.status === 'synced') {
        badge.textContent = 'SYNCED ✓'; badge.classList.remove('syncing');
        setTimeout(() => { badge.textContent = 'SCHWAB'; }, 3000);
        if (document.querySelector('.tab[data-panel="journal"]')?.classList.contains('active')) onSync();
      } else if (d.status === 'error') { badge.textContent = 'SYNC ERR'; badge.classList.remove('syncing'); }
    });
  } catch {}
}
