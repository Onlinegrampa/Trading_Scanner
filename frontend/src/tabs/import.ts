import type { Trade } from './journal';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

let importParsedTrades: Array<{
  ticker: string; direction: string; entryPrice: number; exitPrice: number;
  shares: number; pnlDollar: number; pnlPercent: number; entryTime: string; exitTime: string;
}> = [];

let _tickerPriceMap: () => Map<string, number> = () => new Map();
let _scannerSourceMap: () => Map<string, string> = () => new Map();
let _onImportDone: (trades: Trade[]) => void = () => {};
let _toastMsg: (msg: string) => void = () => {};

export function initImport(opts: {
  getTickerPriceMap: () => Map<string, number>;
  getScannerSourceMap: () => Map<string, string>;
  onImportDone: (trades: Trade[]) => void;
  toastMsg: (msg: string) => void;
}) {
  _tickerPriceMap   = opts.getTickerPriceMap;
  _scannerSourceMap = opts.getScannerSourceMap;
  _onImportDone     = opts.onImportDone;
  _toastMsg         = opts.toastMsg;
}

export function openImportModal(tab: string) {
  $('importOverlay').classList.add('open');
  $('importStep1').style.display = '';
  $('importStep2').style.display = 'none';
  const msg = $('importParseMsg');
  msg.className = 'import-parse-msg';
  msg.textContent = '';
  switchImportTab(tab || 'file');
}

export function closeImportModal() { $('importOverlay').classList.remove('open'); }

export function importGoBack() {
  $('importStep2').style.display = 'none';
  $('importStep1').style.display = '';
}

export function switchImportTab(tab: string) {
  $('importTabFile').classList.toggle('active', tab === 'file');
  $('importTabPaste').classList.toggle('active', tab === 'paste');
  $('importFileSection').style.display  = tab === 'file'  ? '' : 'none';
  $('importPasteSection').style.display = tab === 'paste' ? '' : 'none';
}

export function handleDragOver(e: DragEvent) {
  e.preventDefault();
  $('importDropzone').classList.add('drag-over');
}

export function handleDragLeave() { $('importDropzone').classList.remove('drag-over'); }

export function handleDrop(e: DragEvent) {
  e.preventDefault();
  $('importDropzone').classList.remove('drag-over');
  const file = e.dataTransfer?.files[0];
  if (file) readImportFile(file);
}

export function handleFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) readImportFile(file);
}

export function parsePasteInput() {
  processImportText((document.getElementById('importPasteArea') as HTMLTextAreaElement)?.value ?? '');
}

function readImportFile(file: File) {
  const reader = new FileReader();
  reader.onload = ev => processImportText(ev.target?.result as string);
  reader.readAsText(file);
}

function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  result.push(cur.trim());
  return result;
}

function processImportText(text: string) {
  const msg = $('importParseMsg');
  msg.className = 'import-parse-msg';

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const l = lines[i];
    if ((l.includes('Exec Time') || l.includes('exec time')) && l.includes('Symbol')) { headerIdx = i; break; }
    if (l.includes('\t') && l.toLowerCase().includes('symbol') && (l.toLowerCase().includes('side') || l.toLowerCase().includes('buy'))) { headerIdx = i; break; }
  }
  if (headerIdx < 0) {
    msg.className = 'import-parse-msg err';
    msg.textContent = '✗ Could not find a valid TOS Account Statement header row.';
    return;
  }

  const sep = lines[headerIdx].includes('\t') ? '\t' : ',';
  const rawHeaders = sep === '\t' ? lines[headerIdx].split('\t') : parseCSVRow(lines[headerIdx]);
  const headers = rawHeaders.map(h => h.trim().replace(/^"|"$/g, ''));
  const colIdx = (name: string) => {
    const n = name.toLowerCase();
    return headers.findIndex(h => h.toLowerCase() === n || h.toLowerCase().includes(n));
  };

  const idxTime   = colIdx('exec time');
  const idxSpread = colIdx('spread');
  const idxSide   = colIdx('side');
  const idxQty    = colIdx('qty');
  const idxSymbol = colIdx('symbol');
  const idxPrice  = colIdx('price');

  if (idxSymbol < 0 || idxSide < 0 || idxQty < 0) {
    msg.className = 'import-parse-msg err';
    msg.textContent = '✗ Required columns (Symbol, Side, Qty) not found.';
    return;
  }

  const fills: Array<{ symbol: string; side: string; qty: number; price: number; timestamp: string }> = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('---') || line.startsWith('Account') || line.startsWith('Net')) continue;
    const vals = sep === '\t' ? line.split('\t').map(v => v.trim().replace(/^"|"$/g, '')) : parseCSVRow(line);
    if (vals.length < 3) continue;
    const spread = idxSpread >= 0 ? vals[idxSpread] : 'STOCK';
    if (spread && spread.toUpperCase() !== 'STOCK') continue;
    const side = (vals[idxSide] || '').toUpperCase().trim();
    if (side !== 'BUY' && side !== 'SELL') continue;
    const symbol = (vals[idxSymbol] || '').toUpperCase().trim();
    if (!symbol || symbol.length > 5 || /[^A-Z]/.test(symbol)) continue;
    const qty = parseFloat(vals[idxQty]) || 0;
    if (qty <= 0) continue;
    const price = parseFloat((idxPrice >= 0 ? vals[idxPrice] : '0').replace(/[^0-9.]/g, '')) || 0;
    if (price <= 0) continue;
    let timestamp = new Date().toISOString();
    if (idxTime >= 0 && vals[idxTime]) {
      const parsed = new Date(vals[idxTime].trim());
      if (!isNaN(parsed.getTime())) timestamp = parsed.toISOString();
    }
    fills.push({ symbol, side, qty, price, timestamp });
  }

  if (fills.length === 0) {
    msg.className = 'import-parse-msg err';
    msg.textContent = '✗ No valid stock fills found.';
    return;
  }

  fills.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  importParsedTrades = pairFillsToTrades(fills);

  if (importParsedTrades.length === 0) {
    msg.className = 'import-parse-msg err';
    msg.textContent = `✗ Found ${fills.length} fills but no completed round-trips.`;
    return;
  }

  msg.className = 'import-parse-msg ok';
  msg.textContent = `✓ Found ${fills.length} fills → ${importParsedTrades.length} completed trades.`;
  setTimeout(showImportPreview, 300);
}

function pairFillsToTrades(fills: Array<{ symbol: string; side: string; qty: number; price: number; timestamp: string }>) {
  const positions: Record<string, Array<{ side: string; avgPrice: number; qty: number; openTime: string }>> = {};
  const trades: typeof importParsedTrades = [];

  function addToPos(pos: typeof positions[string], side: string, price: number, qty: number, openTime: string) {
    const existing = pos.find(p => p.side === side);
    if (existing) {
      const total = existing.qty + qty;
      existing.avgPrice = (existing.avgPrice * existing.qty + price * qty) / total;
      existing.qty = total;
    } else {
      pos.push({ side, avgPrice: price, qty, openTime });
    }
  }

  for (const { symbol, side, qty, price, timestamp } of fills) {
    if (!positions[symbol]) positions[symbol] = [];
    const pos = positions[symbol];
    if (side === 'BUY') {
      const short = pos.find(p => p.side === 'SHORT');
      if (short) {
        const closeQty = Math.min(qty, short.qty);
        trades.push({ ticker: symbol, direction: 'SHORT', entryPrice: short.avgPrice, exitPrice: price, shares: closeQty,
          pnlDollar: (short.avgPrice - price) * closeQty, pnlPercent: ((short.avgPrice - price) / short.avgPrice) * 100,
          entryTime: short.openTime, exitTime: timestamp });
        short.qty -= closeQty;
        if (short.qty <= 0) positions[symbol] = pos.filter(p => p !== short);
        const leftover = qty - closeQty;
        if (leftover > 0) addToPos(positions[symbol], 'LONG', price, leftover, timestamp);
      } else { addToPos(pos, 'LONG', price, qty, timestamp); }
    } else {
      const long = pos.find(p => p.side === 'LONG');
      if (long) {
        const closeQty = Math.min(qty, long.qty);
        trades.push({ ticker: symbol, direction: 'LONG', entryPrice: long.avgPrice, exitPrice: price, shares: closeQty,
          pnlDollar: (price - long.avgPrice) * closeQty, pnlPercent: ((price - long.avgPrice) / long.avgPrice) * 100,
          entryTime: long.openTime, exitTime: timestamp });
        long.qty -= closeQty;
        if (long.qty <= 0) positions[symbol] = pos.filter(p => p !== long);
        const leftover = qty - closeQty;
        if (leftover > 0) addToPos(positions[symbol], 'SHORT', price, leftover, timestamp);
      } else { addToPos(pos, 'SHORT', price, qty, timestamp); }
    }
  }
  return trades;
}

function showImportPreview() {
  $('importStep1').style.display = 'none';
  $('importStep2').style.display = '';
  const tbody = $('importPreviewBody');
  tbody.innerHTML = '';
  let wins = 0, losses = 0;
  const tickerPriceMap = _tickerPriceMap();
  const sourceMap      = _scannerSourceMap();

  for (const t of importParsedTrades) {
    const isWin = t.pnlDollar >= 0;
    if (isWin) wins++; else losses++;
    const onScanner  = tickerPriceMap.has(t.ticker);
    const sourcePick = (document.getElementById('importAutoTag') as HTMLInputElement)?.checked && onScanner
      ? (sourceMap.get(t.ticker) || 'Scanner') : 'TOS Import';
    const pnlFmt  = (t.pnlDollar  >= 0 ? '+' : '') + '$' + t.pnlDollar.toFixed(2);
    const pctFmt  = (t.pnlPercent >= 0 ? '+' : '') + t.pnlPercent.toFixed(2) + '%';
    const timeStr = new Date(t.exitTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
    const tr = document.createElement('tr');
    tr.className = isWin ? 'import-row-win' : 'import-row-loss';
    tr.innerHTML = `<td>${timeStr} ET</td>
      <td><b>${t.ticker}</b>${onScanner ? ' <span style="color:var(--cyan);font-size:9px">●SCAN</span>' : ''}</td>
      <td style="color:${t.direction==='LONG'?'var(--green)':'var(--red)'}">${t.direction}</td>
      <td>$${t.entryPrice.toFixed(2)}</td><td>$${t.exitPrice.toFixed(2)}</td><td>${t.shares}</td>
      <td style="color:${isWin?'var(--green)':'var(--red)'};font-weight:700">${pnlFmt}</td>
      <td style="color:${isWin?'var(--green)':'var(--red)'}">${pctFmt}</td>
      <td style="color:var(--text-muted)">${sourcePick}</td>`;
    tbody.appendChild(tr);
  }

  const previewTitle = $('importPreviewTitle');
  if (previewTitle) previewTitle.textContent = `${importParsedTrades.length} trades — ${wins} winners / ${losses} losers`;
  const totalPnl = importParsedTrades.reduce((s, t) => s + t.pnlDollar, 0);
  const countLbl = $('importCountLabel');
  if (countLbl) countLbl.textContent = `Total P&L: ${(totalPnl>=0?'+':'') + '$' + totalPnl.toFixed(2)}`;
}

export async function confirmImportAll() {
  const btn = document.getElementById('importAllBtn') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Importing...'; }

  const tickerPriceMap = _tickerPriceMap();
  const sourceMap      = _scannerSourceMap();
  const autoTag = (document.getElementById('importAutoTag') as HTMLInputElement)?.checked;

  const tradesToSave: Trade[] = importParsedTrades.map(t => {
    const onScanner = tickerPriceMap.has(t.ticker);
    return {
      id:            `tos-csv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp:     t.exitTime, ticker: t.ticker,
      direction:     t.direction as 'LONG' | 'SHORT',
      entryPrice:    t.entryPrice, exitPrice: t.exitPrice, shares: t.shares,
      setupType:     'Imported',
      scannerSource: autoTag && onScanner ? (sourceMap.get(t.ticker) || 'Scanner') : 'TOS Import',
      notes:         'Imported from TOS AccountStatement.csv',
      pnlDollar:     t.pnlDollar, pnlPercent: t.pnlPercent, rMultiple: null, stopPrice: null, float: null,
    };
  });

  try {
    const res  = await fetch('/api/journal/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tradesToSave) });
    const data = await res.json() as { added: number; skipped: number };
    closeImportModal();
    _onImportDone(tradesToSave);
    _toastMsg(`📥 Imported ${data.added} trades from TOS CSV`);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'IMPORT ALL'; }
    const countLbl = $('importCountLabel');
    if (countLbl) countLbl.textContent = `Error: ${(e as Error).message}`;
  }
}
