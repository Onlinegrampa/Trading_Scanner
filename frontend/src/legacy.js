// ── TOS deep link ───────────────────────────────────────────
  async function openTOS(ticker, btnEl) {
    // 1. Copy ticker to clipboard immediately
    navigator.clipboard.writeText(ticker).catch(() => {});

    // 2. Ask the local server to focus the running TOS window via PowerShell.
    //    No deep link — deep links always spawn a new TOS instance on Windows.
    let focused = false;
    let notRunning = false;
    try {
      const r = await fetch(`/api/tos/${encodeURIComponent(ticker)}`);
      const d = await r.json();
      focused = d.ok === true;
      notRunning = d.status === 'not_found';
    } catch (_) {}

    // 3. Visual feedback on the button
    if (btnEl) {
      btnEl.classList.add('copied');
      btnEl.textContent = '✓ ' + ticker;
      setTimeout(() => {
        btnEl.classList.remove('copied');
        btnEl.innerHTML = '<span>TOS</span>';
      }, 2000);
    }

    // 4. Toast instruction
    if (focused) {
      toastMsg(`${ticker} copied — TOS focused · Ctrl+V to paste symbol`);
    } else if (notRunning) {
      toastMsg(`${ticker} copied — TOS not detected, is it running?`);
    } else {
      toastMsg(`${ticker} copied to clipboard`);
    }
  }

  function tosBtnHtml(ticker) {
    return `<button class="tos-btn" onclick="openTOS('${ticker}', this)"><span>TOS</span></button>`;
  }

  function calcBtnHtml(ticker, price) {
    return `<button class="calc-row-btn" onclick="openCalcForTicker('${ticker}',${price})" title="Size position for ${ticker}">[C]</button>`;
  }

  // ── Utility ─────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const fmt2 = n => n.toFixed(2);
  const fmtSign = n => (n >= 0 ? '+' : '') + fmt2(n) + '%';
  const fmtPrice = n => '$' + fmt2(n);
  const fmtRelVol = n => n.toFixed(1) + 'x';

  function fmtVol(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return v.toString();
  }

  function fmtFloat(f) {
    if (f === null || f === undefined) return '—';
    if (f >= 1e9) return (f / 1e9).toFixed(1) + 'B';
    if (f >= 1e6) return (f / 1e6).toFixed(1) + 'M';
    return (f / 1e3).toFixed(0) + 'K';
  }

  function toastMsg(msg, dur = 2500) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), dur);
  }

  // ── Tab switching ────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('panel-' + btn.dataset.panel).classList.add('active');
      if (btn.dataset.panel === 'journal') onJournalTabOpen();
      if (btn.dataset.panel === 'history') { loadHistorySummary(); loadHistoryData('today'); }
      if (btn.dataset.panel === 'mike' && lastData) { reRenderTable('mike-long'); reRenderTable('mike-short'); $('mikeVwapTable').innerHTML = renderMikeVwapTable(lastData.mikeLargeCaps || []); }
      if (btn.dataset.panel === 'entry-guide') {
        try { renderEntryGuide(typeof egActiveIdx !== 'undefined' ? egActiveIdx : 0); }
        catch(e) {
          const c = document.getElementById('entryGuideContainer');
          if (c) c.innerHTML = '<pre style="color:#cc0000;padding:16px;font-size:11px">ERROR: ' + e.message + '\n' + e.stack + '</pre>';
        }
      }
    });
  });

  // ── Gap color class ──────────────────────────────────────────
  function gapClass(pct, dir) {
    const a = Math.abs(pct);
    const prefix = dir === 'UP' ? 'gap-up-' : 'gap-dn-';
    if (a >= 50) return prefix + '5';
    if (a >= 30) return prefix + '4';
    if (a >= 20) return prefix + '3';
    if (a >= 10) return prefix + '2';
    return prefix + '1';
  }

  function volClass(rv) {
    if (rv >= 10) return 'vol-high';
    if (rv >= 3)  return 'vol-med';
    return 'vol-low';
  }

  function qualityColor(score) {
    if (score >= 80) return '#00ff88';
    if (score >= 65) return '#00e676';
    if (score >= 50) return '#ffd600';
    if (score >= 35) return '#ff6d00';
    return '#444444';
  }

  function qualityClass(score) {
    if (score >= 80) return 'q-a-plus';
    if (score >= 65) return 'q-a';
    if (score >= 50) return 'q-b';
    if (score >= 35) return 'q-c';
    return 'q-d';
  }

  // ── Render GAP table ─────────────────────────────────────────
  // ── Sort engine ───────────────────────────────────────────────
  let lastData = null;

  const sortState = {
    up:   { col: 'gapPercent',    dir: -1 },
    down: { col: 'gapPercent',    dir: -1 },
    mom:  { col: 'changePercent', dir: -1 },
    rev:  { col: 'rsi2',          dir: -1 },
    news:       { col: 'publishedUtc',   dir: -1 },
    'mike-long':  { col: 'convictionScore', dir: -1 },
    'mike-short': { col: 'convictionScore', dir: -1 },
  };

  function sortRows(rows, col, dir) {
    return [...rows].sort((a, b) => {
      let av = a[col], bv = b[col];
      if (av === null || av === undefined) return 1;   // nulls always last
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'boolean') return dir * ((av ? 1 : 0) - (bv ? 1 : 0));
      if (typeof av === 'string')  return dir * av.localeCompare(bv);
      return dir * (av - bv);
    });
  }

  // th(id, col, label, align?) — builds a sortable header cell
  function th(id, col, label, align) {
    const s = sortState[id];
    const active = s.col === col;
    const ind = active ? `<span class="sort-ind">${s.dir === -1 ? '▼' : '▲'}</span>` : '<span class="sort-hint">⇅</span>';
    const cls = (align === 'left' ? 'left ' : '') + (active ? 'sorted' : '');
    return `<th class="${cls}" onclick="sortTable('${id}','${col}')">${label}${ind}</th>`;
  }

  function sortTable(id, col) {
    const s = sortState[id];
    if (s.col === col) s.dir *= -1;
    else { s.col = col; s.dir = -1; }
    reRenderTable(id);
  }

  function reRenderTable(id) {
    if (!lastData) return;
    switch (id) {
      case 'up':   $('tableUp').innerHTML   = renderGapTable(lastData.gappersUp,   'UP',   'up');   break;
      case 'down': $('tableDown').innerHTML = renderGapTable(lastData.gappersDown, 'DOWN', 'down'); break;
      case 'mom':  $('tableMom').innerHTML  = renderMomTable(lastData.momentum,             'mom'); break;
      case 'rev':  $('tableRev').innerHTML  = renderRevTable(lastData.reversals,            'rev'); break;
      case 'news': $('tableNews').innerHTML = renderNewsTable(lastData); break;
      case 'mike-long':  $('mikeLongTable').innerHTML  = renderMikeLargeCapTable((lastData.mikeLargeCaps || []).filter(r => r.gapPercent >= 0), 'mike-long');  break;
      case 'mike-short': $('mikeShortTable').innerHTML = renderMikeLargeCapTable((lastData.mikeLargeCaps || []).filter(r => r.gapPercent <  0), 'mike-short'); break;
    }
  }

  // ── Daily chart helpers ───────────────────────────────────────

  function dailyGradeHtml(grade) {
    if (!grade) return '<span class="daily-d">—</span>';
    const cls = grade === 'A+' ? 'daily-aplus' : grade === 'A' ? 'daily-a' : grade === 'B' ? 'daily-b' : grade === 'C' ? 'daily-c' : 'daily-d';
    return `<span class="${cls}">${grade}</span>`;
  }

  function emaArrowHtml(arrow) {
    if (!arrow) return '';
    const cls = arrow === 'UP' ? 'ema-arrow-up' : arrow === 'MIXED' ? 'ema-arrow-mixed' : 'ema-arrow-down';
    const sym = arrow === 'UP' ? '▲' : arrow === 'MIXED' ? '→' : '▼';
    return `<span class="${cls}">${sym}</span>`;
  }

  function ema200DistHtml(dist) {
    if (dist === undefined || dist === null) return '<span style="color:var(--text-dim)">—</span>';
    const sign = dist >= 0 ? '+' : '';
    const cls  = dist >= 0 ? 'ema-dist-pos' : 'ema-dist-neg';
    return `<span class="${cls}">${sign}$${Math.abs(dist).toFixed(2)}</span>`;
  }

  function stockTypeHtml(type, momoInfo) {
    if (!type) return '';
    const map = {
      'BLUE_SKY':    ['type-blue-sky',    'BLUE SKY'],
      'IPO':         ['type-ipo',          'IPO'],
      'R/S':         ['type-rs',           'R/S'],
      'FORMER_MOMO': ['type-former-momo',  'MOMO'],
    };
    const [cls, label] = map[type] || ['', type];
    let ttAttr = '';
    if (type === 'FORMER_MOMO' && momoInfo) {
      const sign    = momoInfo.pct >= 0 ? '+' : '';
      const dateStr = new Date(momoInfo.date + 'T12:00:00').toLocaleDateString('en-US',
        { month: 'short', day: 'numeric', year: 'numeric' });
      const tt = `Former runner: ${sign}${momoInfo.pct.toFixed(1)}% on ${dateStr} (${momoInfo.daysAgo}d ago)`;
      ttAttr = ` data-tt="${tt}"`;
    }
    return `<span class="type-badge ${cls}"${ttAttr}>${label}</span>`;
  }

  // ── Render GAP table ──────────────────────────────────────────
  function renderGapTable(rows, dir, tableId) {
    if (!rows || rows.length === 0) {
      return '<div class="empty-state">No ' + (dir === 'UP' ? 'gappers up' : 'gappers down') + ' found matching criteria.</div>';
    }
    const s = sortState[tableId];
    const sorted = sortRows(rows, s.col, s.dir);
    let html = `
      <table class="scanner-table">
        <thead><tr>
          ${th(tableId, 'rank',           '#',        'left')}
          ${th(tableId, 'ticker',         'Ticker',   'left')}
          ${th(tableId, 'price',          'Price')}
          ${th(tableId, 'gapPercent',     'Gap %')}
          ${th(tableId, 'float',          'Float')}
          ${th(tableId, 'volume',         'Volume')}
          ${th(tableId, 'relativeVolume', 'Rel.Vol')}
          ${th(tableId, 'changeFromOpen', 'Chg/Open')}
          ${th(tableId, 'qualityScore',   'Quality')}
          ${th(tableId, 'dailyGrade',     'Daily')}
          ${th(tableId, 'ema200Dist',     '200 EMA')}
          ${th(tableId, 'stockType',      'Type',     'left')}
          <th data-nosort style="min-width:180px">Catalyst</th>
          <th data-nosort></th>
        </tr></thead>
        <tbody>`;
    for (const r of sorted) {
      const gc = gapClass(r.gapPercent, dir);
      const vc = volClass(r.relativeVolume);
      const floatClass = r.float !== null && r.float < 10e6 ? 'float-low' : 'float-norm';
      const chgClass = r.changeFromOpen >= 0 ? 'chg-pos' : 'chg-neg';
      const qClass = qualityClass(r.qualityScore);
      const qFill = qualityColor(r.qualityScore);
      const s3 = r.hasS3 === true;
      const s3Badge = s3 ? `<span class="s3-badge" title="Active shelf registration — secondary offering risk">⚠ S3</span>` : '';
      const qPct = Math.min(r.qualityScore, 110) / 110 * 100;
      html += `<tr>
        <td class="left"><span class="rank">${r.rank}</span></td>
        <td class="left"><span class="ticker">${r.ticker}</span>${s3Badge}</td>
        <td class="price">${fmtPrice(r.price)}</td>
        <td class="${gc}">${fmtSign(r.gapPercent)}</td>
        <td class="${floatClass}">${fmtFloat(r.float)}</td>
        <td class="${vc}">${fmtVol(r.volume)}</td>
        <td class="${vc}">${fmtRelVol(r.relativeVolume)}</td>
        <td class="${chgClass}">${fmtSign(r.changeFromOpen)}</td>
        <td><div class="quality-wrap">
          <div class="quality-bar"><div class="quality-fill" style="width:${qPct}%;background:${qFill}"></div></div>
          <span class="quality-num ${qClass}">${r.qualityScore}</span>
        </div></td>
        <td><div class="daily-cell">${dailyGradeHtml(r.dailyGrade)}${emaArrowHtml(r.emaArrow)}</div></td>
        <td>${ema200DistHtml(r.ema200Dist)}</td>
        <td class="left">${stockTypeHtml(r.stockType, r.momoInfo)}${r.stockType === 'FORMER_MOMO' && r.latestNews?.catalyst?.strength === 'negative' ? '<span class="momo-neg-warn" title="Former runner + negative catalyst — active short seller risk">⚠ Momo+Short</span>' : ''}</td>
        <td>${catCellHtml(r.latestNews, s3)}</td>
        <td><div class="action-btns">${tosBtnHtml(r.ticker)}${calcBtnHtml(r.ticker, r.price)}</div></td>
      </tr>`;
    }
    html += '</tbody></table>';
    return html;
  }

  // ── Render MOMENTUM table ─────────────────────────────────────
  function renderMomTable(rows, tableId) {
    if (!rows || rows.length === 0) {
      return '<div class="empty-state">No momentum plays found.</div>';
    }
    const s = sortState[tableId];
    const sorted = sortRows(rows, s.col, s.dir);
    let html = `
      <table class="scanner-table">
        <thead><tr>
          ${th(tableId, 'ticker',          'Ticker',   'left')}
          ${th(tableId, 'price',           'Price')}
          ${th(tableId, 'changePercent',   'Chg %')}
          ${th(tableId, 'relativeVolume',  'Rel.Vol')}
          ${th(tableId, 'float',           'Float')}
          ${th(tableId, 'volume',          'Volume')}
          ${th(tableId, 'distanceFromHigh','HoD Dist')}
          ${th(tableId, 'aboveVWAP',       'VWAP')}
          ${th(tableId, 'triggerType',     'Trigger',  'left')}
          ${th(tableId, 'isMomo',          'Type',     'left')}
          <th data-nosort></th>
        </tr></thead>
        <tbody>`;
    for (const r of sorted) {
      const vc = volClass(r.relativeVolume);
      const chgClass = r.changePercent >= 0 ? 'chg-pos' : 'chg-neg';
      const floatClass = r.float !== null && r.float < 10e6 ? 'float-low' : 'float-norm';
      const vwapClass = r.aboveVWAP ? 'vwap-above' : 'vwap-below';
      const vwapStr   = r.aboveVWAP ? '▲ ABOVE' : '▼ BELOW';
      let triggerHtml;
      switch (r.triggerType) {
        case 'NEW_HIGH':         triggerHtml = '<span class="badge-new-high">[NEW HIGH]</span>';    break;
        case 'LOW_FLOAT_BOUNCE': triggerHtml = '<span class="badge-lf-bounce">[LF BOUNCE]</span>'; break;
        default:                 triggerHtml = '<span class="badge-breakout">[BREAKOUT]</span>';
      }
      const momoBadge = r.isMomo ? stockTypeHtml('FORMER_MOMO', r.momoInfo) : '';
      // Momo + negative news warning for momentum stocks (look up in data.news)
      const moNews = lastData?.news?.[r.ticker]?.[0];
      const momoCatWarn = r.isMomo && moNews?.catalyst?.strength === 'negative'
        ? '<span class="momo-neg-warn" title="Former runner + negative catalyst — active short seller risk">[MOMO+SHORT]</span>' : '';
      html += `<tr>
        <td><span class="ticker">${r.ticker}</span></td>
        <td class="price">${fmtPrice(r.price)}</td>
        <td class="${chgClass}">${fmtSign(r.changePercent)}</td>
        <td class="${vc}">${fmtRelVol(r.relativeVolume)}</td>
        <td class="${floatClass}">${fmtFloat(r.float)}</td>
        <td class="${vc}">${fmtVol(r.volume)}</td>
        <td class="chg-neg">-${r.distanceFromHigh.toFixed(1)}%</td>
        <td class="${vwapClass}">${vwapStr}</td>
        <td>${triggerHtml}</td>
        <td class="left">${momoBadge}${momoCatWarn}</td>
        <td><div class="action-btns">${tosBtnHtml(r.ticker)}${calcBtnHtml(r.ticker, r.price)}</div></td>
      </tr>`;
    }
    html += '</tbody></table>';
    return html;
  }

  // ── Render REVERSAL table ─────────────────────────────────────
  function renderRevTable(rows, tableId) {
    if (!rows || rows.length === 0) {
      return '<div class="empty-state">No reversal signals detected.</div>';
    }
    const s = sortState[tableId];
    const sorted = sortRows(rows, s.col, s.dir);
    let html = `
      <table class="scanner-table">
        <thead><tr>
          ${th(tableId, 'ticker',                  'Ticker',   'left')}
          ${th(tableId, 'price',                   'Price')}
          ${th(tableId, 'direction',               'Dir')}
          ${th(tableId, 'setupType',               'Setup',    'left')}
          ${th(tableId, 'consecutiveCandles5m',    '5m Cndls')}
          ${th(tableId, 'consecutiveCandles1m',    '1m Cndls')}
          ${th(tableId, 'rsi2',                    'RSI(2)')}
          ${th(tableId, 'outsideBand',             'BB')}
          ${th(tableId, 'candlePattern',           'Pattern',  'left')}
          ${th(tableId, 'multiTimeframeAlignment', 'Multi-TF')}
          <th data-nosort></th>
        </tr></thead>
        <tbody>`;
    for (const r of sorted) {
      const dirClass = r.direction === 'TOP' ? 'dir-top' : 'dir-bot';
      const dirStr   = r.direction === 'TOP' ? '⬇ TOP' : '⬆ BOT';
      let setupHtml;
      switch (r.setupType) {
        case 'MULTI_TF':     setupHtml = '<span class="setup-multi">MULTI-TF</span>'; break;
        case 'SETUP_1_5MIN': setupHtml = '<span class="setup-5min">5MIN</span>';      break;
        default:             setupHtml = '<span class="setup-1min">1MIN</span>';
      }
      const rsiClass = r.rsi2 >= 90 ? 'rsi-high' : r.rsi2 <= 10 ? 'rsi-low' : 'rsi-norm';
      const bbClass  = r.outsideBand ? 'bb-outside' : 'bb-inside';
      const bbStr    = r.outsideBand ? 'OUTSIDE' : 'inside';
      const patStr   = r.candlePattern
        ? `<span class="pattern-val">${r.candlePattern.replace(/_/g,' ')}</span>`
        : '<span class="pattern-nil">—</span>';
      const multiStr = r.multiTimeframeAlignment ? '<span class="multi-tf-yes">✓</span>' : '<span class="multi-tf-no">—</span>';
      html += `<tr>
        <td><span class="ticker">${r.ticker}</span></td>
        <td class="price">${fmtPrice(r.price)}</td>
        <td class="${dirClass}">${dirStr}</td>
        <td>${setupHtml}</td>
        <td style="color:var(--text-dim)">${r.consecutiveCandles5m}</td>
        <td style="color:var(--text-dim)">${r.consecutiveCandles1m}</td>
        <td class="${rsiClass}">${r.rsi2.toFixed(1)}</td>
        <td class="${bbClass}">${bbStr}</td>
        <td>${patStr}</td>
        <td>${multiStr}</td>
        <td>${tosBtnHtml(r.ticker)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    return html;
  }

  // ── Render MIKE LARGE CAP table ──────────────────────────────

  function renderMikeLargeCapTable(rows, tableId) {
    if (!rows || rows.length === 0) {
      return '<div class="empty-state">No large cap candidates.</div>';
    }
    const s = sortState[tableId];
    const sorted = sortRows(rows, s.col, s.dir);
    let html = `
      <table class="scanner-table">
        <thead><tr>
          ${th(tableId, 'ticker',           'Ticker',   'left')}
          ${th(tableId, 'price',            'Price')}
          ${th(tableId, 'gapPercent',       'Gap%')}
          ${th(tableId, 'relativeVolume',   'RVol')}
          ${th(tableId, 'atrPct',           'ATR%')}
          ${th(tableId, 'aboveDailySMA200', 'SMA200')}
          ${th(tableId, 'rsvsSPY',          'RS/SPY')}
          ${th(tableId, 'convictionScore',  'Score')}
          ${th(tableId, 'float',            'Float')}
          <th data-nosort></th>
        </tr></thead>
        <tbody>`;
    for (const r of sorted) {
      const convClass = r.convictionScore >= 5 ? 'mike-conviction-5' :
                        r.convictionScore >= 4 ? 'mike-conviction-4' :
                        r.convictionScore >= 3 ? 'mike-conviction-3' : '';
      const priceHtml = r.isSweetSpot
        ? `<span class="mike-sweet-spot">${fmtPrice(r.price)}</span>`
        : `<span class="price">${fmtPrice(r.price)}</span>`;
      const gapStr  = (r.gapPercent >= 0 ? '+' : '') + r.gapPercent.toFixed(2) + '%';
      const gapCls  = r.gapPercent >= 0 ? 'pos' : 'neg';
      const sma200Html = r.aboveDailySMA200
        ? '<span class="mike-sma-above">ABOVE</span>'
        : '<span class="mike-sma-below">BELOW</span>';
      const rsStr   = (r.rsvsSPY >= 0 ? '+' : '') + r.rsvsSPY.toFixed(2) + '%';
      const rsHtml  = (r.leadsSpyLong || r.leadsSpyShort)
        ? `<span class="mike-leads-spy">${rsStr}</span>`
        : `<span style="color:var(--dim)">${rsStr}</span>`;
      const scoreHtml = `<span style="color:${r.convictionScore >= 4 ? 'var(--orange)' : r.convictionScore >= 3 ? 'var(--green)' : 'var(--dim)'};font-weight:700">${r.convictionScore}/5</span>`;
      const floatStr = r.float ? fmtFloat(r.float) : '—';
      html += `<tr class="${convClass}">
        <td><span class="ticker">${r.ticker}</span></td>
        <td>${priceHtml}</td>
        <td class="${gapCls}">${gapStr}</td>
        <td>${r.relativeVolume.toFixed(1)}x</td>
        <td>${r.atrPct.toFixed(2)}%</td>
        <td>${sma200Html}</td>
        <td>${rsHtml}</td>
        <td>${scoreHtml}</td>
        <td style="color:var(--dim)">${floatStr}</td>
        <td>${tosBtnHtml(r.ticker)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    return html;
  }

  function renderMikeVwapTable(rows) {
    const top5 = (rows || []).slice(0, 5).filter(r => r.vwap !== null);
    if (top5.length === 0) {
      return '<div class="empty-state">VWAP data not yet available.</div>';
    }
    let html = `
      <table class="scanner-table">
        <thead><tr>
          <th class="left">Ticker</th>
          <th>Price</th>
          <th>VWAP</th>
          <th>Position</th>
          <th class="left">Signal</th>
          <th>Score</th>
          <th data-nosort></th>
        </tr></thead>
        <tbody>`;
    for (const r of top5) {
      const posCls = r.vwapPosition === 'ABOVE' ? 'pos' : 'neg';
      const sigCls = r.vwapSignal && r.vwapSignal.includes('CONFIRM') ? 'mike-leads-spy' : '';
      html += `<tr>
        <td><span class="ticker">${r.ticker}</span></td>
        <td class="price">${fmtPrice(r.price)}</td>
        <td style="color:var(--dim)">${fmtPrice(r.vwap)}</td>
        <td class="${posCls}">${r.vwapPosition || '—'}</td>
        <td><span class="${sigCls}">${r.vwapSignal || '—'}</span></td>
        <td style="color:var(--orange);font-weight:700">${r.convictionScore}/5</td>
        <td>${tosBtnHtml(r.ticker)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    return html;
  }

  // ── Catalyst helpers ─────────────────────────────────────────

  function catBadgeHtml(catalyst) {
    if (!catalyst) return '<span class="cat-badge cat-neutral">News</span>';
    const cls = catalyst.strength === 'strong'   ? 'cat-strong'   :
                catalyst.strength === 'moderate' ? 'cat-moderate' :
                catalyst.strength === 'negative' ? 'cat-negative' : 'cat-neutral';
    return `<span class="cat-badge ${cls}">${catalyst.type}</span>`;
  }

  function catCellHtml(news, hasS3) {
    const s3 = hasS3 ? '<span class="s3-badge" title="Active shelf registration found — secondary offering risk">⚠ S3</span>' : '';
    if (!news) return `<span class="cat-badge cat-neutral" style="opacity:.5">No news</span>${s3}`;
    const truncated = news.title.length > 50 ? news.title.slice(0, 47) + '…' : news.title;
    return `${catBadgeHtml(news.catalyst)} <a class="cat-headline" href="${news.articleUrl}" target="_blank" title="${news.title.replace(/"/g,'&quot;')}">${truncated}</a>${s3}`;
  }

  // ── Render NEWS tab table ─────────────────────────────────────

  function renderNewsTable(data) {
    const newsMap = data.news || {};
    const s3Set = new Set(data.s3Flags || []);

    // Flatten all news items and sort by publishedUtc descending
    const allItems = [];
    for (const [ticker, items] of Object.entries(newsMap)) {
      for (const item of items) {
        allItems.push({ ...item, ticker });
      }
    }
    allItems.sort((a, b) => b.publishedUtc.localeCompare(a.publishedUtc));

    $('tabNewsCount').textContent = allItems.length;
    $('countNews').textContent    = allItems.length;

    if (allItems.length === 0) {
      return '<div class="empty-state">No news found for current scanner results. Articles from the last 48 hours will appear here.</div>';
    }

    let html = `
      <table class="news-table">
        <thead><tr>
          <th style="width:60px">Time</th>
          <th style="width:70px">Ticker</th>
          <th style="width:130px">Catalyst</th>
          <th>Headline</th>
          <th style="width:100px">Source</th>
        </tr></thead>
        <tbody>`;

    for (const r of allItems) {
      const ts   = new Date(r.publishedUtc);
      const time = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const date = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const s3   = s3Set.has(r.ticker) ? '<span class="s3-badge" title="Active shelf registration">⚠ S3</span>' : '';

      html += `<tr>
        <td class="news-time">${date}<br>${time}</td>
        <td><span class="news-ticker">${r.ticker}</span>${s3}</td>
        <td>${catBadgeHtml(r.catalyst)}</td>
        <td>
          <div class="news-title">
            <a href="${r.articleUrl}" target="_blank" rel="noopener">${r.title}</a>
          </div>
          ${r.description ? `<div class="news-source">${r.description.slice(0,120)}${r.description.length>120?'…':''}</div>` : ''}
        </td>
        <td class="news-source">${r.publisher || '—'}</td>
      </tr>`;
    }

    html += '</tbody></table>';
    return html;
  }

  // ── Refresh countdown ring ───────────────────────────────────
  let countdownInterval = null;
  let countdownSecs = 30;
  const CIRCUMFERENCE = 2 * Math.PI * 11; // r=11 → ~69.12

  function startCountdown(totalSecs) {
    clearInterval(countdownInterval);
    countdownSecs = totalSecs;
    const circle = $('progressCircle');
    const countEl = $('refreshCount');

    function tick() {
      countdownSecs = Math.max(0, countdownSecs - 1);
      countEl.textContent = countdownSecs;
      const fraction = countdownSecs / totalSecs;
      circle.style.strokeDashoffset = CIRCUMFERENCE * (1 - fraction);
    }

    circle.style.strokeDasharray = CIRCUMFERENCE;
    circle.style.strokeDashoffset = 0;
    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  // ── Render full results ──────────────────────────────────────
  function renderResults(data) {
    if (scanPaused) return;
    // Meta bar
    $('metaStrip').style.display = 'flex';
    $('metaTotal').textContent    = (data.meta?.totalSnapshotTickers ?? '?').toLocaleString();
    $('metaFiltered').textContent = (data.meta?.filteredTickers ?? '?').toLocaleString();
    $('metaDuration').textContent = ((data.meta?.scanDurationMs ?? 0) / 1000).toFixed(1) + 's';

    // Topbar stats
    const ts = new Date(data.timestamp);
    $('lastUpdate').textContent = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('scanTime').textContent   = ((data.meta?.scanDurationMs ?? 0) / 1000).toFixed(1) + 's';
    $('apiCalls').textContent   = data.meta?.apiCallsThisCycle ?? '?';
    $('tickerCount').textContent = (data.meta?.totalSnapshotTickers ?? '?').toLocaleString();

    const upCount   = (data.gappersUp   || []).length;
    const downCount = (data.gappersDown || []).length;
    const momCount  = (data.momentum    || []).length;
    const revCount  = (data.reversals   || []).length;

    // Tab badges
    $('tabGapCount').textContent = upCount + downCount;
    $('tabMomCount').textContent = momCount;
    $('tabRevCount').textContent = revCount;

    // Section counts
    $('countUp').textContent   = upCount;
    $('countDown').textContent = downCount;
    $('countMom').textContent  = momCount;
    $('countRev').textContent  = revCount;

    // Tables
    lastData = data;
    $('tableUp').innerHTML   = renderGapTable(data.gappersUp,   'UP',   'up');
    $('tableDown').innerHTML = renderGapTable(data.gappersDown, 'DOWN', 'down');
    $('tableMom').innerHTML  = renderMomTable(data.momentum,             'mom');
    $('tableRev').innerHTML  = renderRevTable(data.reversals,            'rev');

    startCountdown(data.refreshIntervalSeconds || 30);
    $('statusDot').className = 'status-dot';
    toastMsg('Scan updated — ' + ts.toLocaleTimeString());

    checkAlerts(data);
    updateCalcTickerList(data);
    updateChecklistScannerData(data);

    // Mike's Large Cap tab
    const mikeCaps  = data.mikeLargeCaps || [];
    const mikeLong  = mikeCaps.filter(r => r.gapPercent >= 0);
    const mikeShort = mikeCaps.filter(r => r.gapPercent <  0);
    $('tabMikeCount').textContent = mikeCaps.length;
    $('mikeTotalCount').textContent = mikeCaps.length;
    $('mikeLongTable').innerHTML  = renderMikeLargeCapTable(mikeLong,  'mike-long');
    $('mikeShortTable').innerHTML = renderMikeLargeCapTable(mikeShort, 'mike-short');
    $('mikeVwapTable').innerHTML  = renderMikeVwapTable(mikeCaps);
    if (mikeCaps.length > 0) {
      $('mikeStatsBar').style.display = 'block';
      $('mikeSpyGap').textContent = (mikeCaps[0].spyGapPct >= 0 ? '+' : '') + (mikeCaps[0].spyGapPct || 0).toFixed(2) + '%';
      $('mikeSpyGap').style.color = mikeCaps[0].spyGapPct >= 0 ? 'var(--green)' : 'var(--red)';
      if (data.mikeScanDurationMs) {
        $('mikeScanTime').textContent = (data.mikeScanDurationMs / 1000).toFixed(1) + 's';
      }
    }

    // Update bottom news ticker
    const newsMap = data.news || {};
    const allNews = Object.values(newsMap).flat();
    if (allNews.length > 0) updateNewsTicker(allNews);
  }

  // ── SSE connection ───────────────────────────────────────────
  function connectSSE() {
    const evtSource = new EventSource('/api/stream');

    evtSource.addEventListener('message', e => {
      try {
        renderResults(JSON.parse(e.data));
        $('loading').style.display = 'none';
        $('app').style.display = 'flex';
      } catch (err) {
        console.error('Parse error', err);
      }
    });

    evtSource.addEventListener('error', () => {
      $('statusDot').className = 'status-dot stale';
      // Fall back to polling if SSE fails
      evtSource.close();
      pollFallback();
    });
  }

  // ── Polling fallback ─────────────────────────────────────────
  async function pollFallback() {
    async function poll() {
      try {
        const res = await fetch('/api/scan-results');
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        renderResults(data);
        $('loading').style.display = 'none';
        $('app').style.display = 'flex';
      } catch {
        $('statusDot').className = 'status-dot error';
      }
    }

    await poll();
    setInterval(poll, 30_000);
  }

  // ── Audio engine ─────────────────────────────────────────────
  let _actx = null;
  let alertsMuted = false;
  let alertLogOpen = true;
  const alertLog = [];
  const MAX_LOG = 40;
  const COOLDOWN_MS = 5 * 60 * 1000; // 5 min before re-alerting same ticker
  const alertHistory = new Map(); // 'TYPE:TICKER' → last-fired timestamp

  function getACtx() {
    if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
    if (_actx.state === 'suspended') _actx.resume();
    return _actx;
  }

  // Initialise AudioContext on first user interaction (browser autoplay policy)
  document.addEventListener('click', () => getACtx(), { once: true });

  function playNote(ctx, freq, tOffset, dur, type = 'sine', vol = 0.22) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + tOffset);
    const t = ctx.currentTime + tOffset;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  // GAP quality > 75 — warm ascending major chord (C5 E5 G5)
  function soundGap() {
    const c = getACtx();
    playNote(c, 523.25, 0.00, 0.22, 'sine',     0.20);
    playNote(c, 659.25, 0.13, 0.22, 'sine',     0.20);
    playNote(c, 783.99, 0.26, 0.32, 'sine',     0.22);
  }

  // MOMENTUM NEW HIGH + float < 10M — rapid sharp ascending beeps
  function soundMomentum() {
    const c = getACtx();
    playNote(c, 880,  0.00, 0.09, 'triangle', 0.22);
    playNote(c, 1175, 0.10, 0.09, 'triangle', 0.22);
    playNote(c, 1568, 0.20, 0.09, 'triangle', 0.22);
    playNote(c, 1568, 0.30, 0.22, 'sine',     0.18); // sustain
  }

  // REVERSAL multi-TF — two-note warning chime (A4 → C#5)
  function soundReversal() {
    const c = getACtx();
    playNote(c, 440, 0.00, 0.28, 'sine', 0.20);
    playNote(c, 554, 0.22, 0.35, 'sine', 0.20);
  }

  // BREAKING NEWS strong catalyst — 3 rapid high-pitched beeps
  function soundNewsStrong() {
    const c = getACtx();
    playNote(c, 1318, 0.00, 0.08, 'triangle', 0.20);
    playNote(c, 1318, 0.12, 0.08, 'triangle', 0.20);
    playNote(c, 1568, 0.24, 0.14, 'triangle', 0.22);
  }

  // BREAKING NEWS moderate catalyst — 2 beeps
  function soundNewsModerate() {
    const c = getACtx();
    playNote(c, 987, 0.00, 0.10, 'triangle', 0.18);
    playNote(c, 987, 0.15, 0.14, 'triangle', 0.18);
  }

  // BREAKING NEWS negative catalyst (offering/dilution) — 1 low descending warn
  function soundNewsNegative() {
    const c = getACtx();
    playNote(c, 330, 0.00, 0.25, 'sine', 0.22);
    playNote(c, 277, 0.20, 0.30, 'sine', 0.18);
  }

  // ── Desktop notifications ─────────────────────────────────────
  function requestNotifPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function sendNotif(title, body, tag) {
    if (alertsMuted) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, tag, silent: true });
    setTimeout(() => n.close(), 9000);
    n.onclick = () => { window.focus(); n.close(); };
  }

  // ── Pause toggle ─────────────────────────────────────────────
  let scanPaused = false;

  function togglePause() {
    scanPaused = !scanPaused;
    const btn = $('pauseBtn');
    const lbl = $('pauseBtnLabel');
    const icon = $('pauseIcon');
    if (scanPaused) {
      btn.classList.add('paused');
      icon.textContent = '▶';
      lbl.textContent = 'PAUSED';
      clearInterval(countdownInterval);
      $('progressCircle').style.strokeDashoffset = 0;
      $('refreshCount').textContent = '—';
      $('statusDot').className = 'status-dot stale';
    } else {
      btn.classList.remove('paused');
      icon.textContent = '⏸';
      lbl.textContent = 'LIVE';
      $('statusDot').className = 'status-dot';
      if (lastData) startCountdown(lastData.refreshIntervalSeconds || 30);
    }
  }

  // ── Mute toggle ───────────────────────────────────────────────
  function toggleMute() {
    alertsMuted = !alertsMuted;
    const btn = $('muteBtn');
    const lbl = $('muteBtnLabel');
    if (alertsMuted) {
      btn.classList.add('muted');
      btn.querySelector('.bell').textContent = '🔕';
      lbl.textContent = 'MUTED';
    } else {
      btn.classList.remove('muted');
      btn.querySelector('.bell').textContent = '🔔';
      lbl.textContent = 'ALERTS ON';
    }
  }

  // ── Alert log ─────────────────────────────────────────────────
  function toggleAlertLog() {
    alertLogOpen = !alertLogOpen;
    $('alertLogList').style.display = alertLogOpen ? '' : 'none';
    $('alertLogToggleHint').textContent = alertLogOpen ? 'CLICK TO COLLAPSE' : 'CLICK TO EXPAND';
  }

  function addToLog(type, ticker, msg) {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    alertLog.unshift({ type, ticker, msg, time });
    if (alertLog.length > MAX_LOG) alertLog.pop();

    const list = $('alertLogList');
    const badgeClass = type === 'gap' ? 'al-gap' : type === 'momentum' ? 'al-mom' : 'al-rev';
    const badgeText  = type === 'gap' ? 'GAP QUALITY' : type === 'momentum' ? 'NEW HIGH' : 'REVERSAL';
    const entry = document.createElement('div');
    entry.className = 'alert-entry';
    entry.innerHTML = `
      <span class="al-time">${time}</span>
      <span class="al-badge ${badgeClass}">${badgeText}</span>
      <span class="al-ticker">${ticker}</span>
      <span class="al-msg">${msg}</span>`;
    list.prepend(entry);
    while (list.children.length > MAX_LOG) list.removeChild(list.lastChild);

    $('alertCount').textContent = alertLog.length;
    $('alertLog').style.display = '';
  }

  // ── News headline deduplication ───────────────────────────────
  // Track headline IDs we've already alerted on. First render populates the
  // set WITHOUT firing alerts (avoids flood of alerts on page load).
  const seenHeadlineIds = new Set();
  let newsInitialized = false;

  // ── Deduplication ─────────────────────────────────────────────
  function shouldFire(type, ticker) {
    const key = `${type}:${ticker}`;
    const last = alertHistory.get(key) || 0;
    if (Date.now() - last > COOLDOWN_MS) {
      alertHistory.set(key, Date.now());
      return true;
    }
    return false;
  }

  // Flash the table row for a ticker
  function flashRow(ticker) {
    document.querySelectorAll('.scanner-table tbody tr').forEach(row => {
      if (row.querySelector('.ticker')?.textContent.trim() === ticker) {
        row.classList.remove('alert-flash');
        void row.offsetWidth; // reflow to restart animation
        row.classList.add('alert-flash');
      }
    });
  }

  // ── Main alert checker — runs after every render ──────────────
  function checkAlerts(data) {
    if (alertsMuted) return;

    // 1. Gap scanner: quality score > 75
    const allGappers = [...(data.gappersUp || []), ...(data.gappersDown || [])];
    for (const r of allGappers) {
      if (r.qualityScore > 75 && shouldFire('gap', r.ticker)) {
        soundGap();
        const dir = r.gapPercent >= 0 ? '+' : '';
        sendNotif(
          `🟢 GAP ALERT — ${r.ticker}`,
          `Quality ${r.qualityScore}/100 · Gap ${dir}${r.gapPercent.toFixed(1)}% · $${r.price.toFixed(2)}`,
          `gap:${r.ticker}`,
        );
        addToLog('gap', r.ticker, `Score ${r.qualityScore} · Gap ${dir}${r.gapPercent.toFixed(1)}%`);
        flashRow(r.ticker);
      }
    }

    // 2. Momentum: NEW HIGH + float < 10M
    for (const r of (data.momentum || [])) {
      if (r.triggerType === 'NEW_HIGH' && r.float !== null && r.float < 10_000_000
          && shouldFire('momentum', r.ticker)) {
        soundMomentum();
        const floatStr = r.float ? (r.float / 1e6).toFixed(1) + 'M' : '?';
        sendNotif(
          `🔥 NEW HIGH — ${r.ticker}`,
          `Float ${floatStr} · +${r.changePercent.toFixed(1)}% · $${r.price.toFixed(2)} · ${r.relativeVolume.toFixed(1)}x vol`,
          `momentum:${r.ticker}`,
        );
        addToLog('momentum', r.ticker, `Float ${floatStr} · +${r.changePercent.toFixed(1)}% · ${r.relativeVolume.toFixed(1)}x vol`);
        flashRow(r.ticker);
      }
    }

    // 3. Reversal: multi-timeframe alignment
    for (const r of (data.reversals || [])) {
      if (r.multiTimeframeAlignment && shouldFire('reversal', r.ticker)) {
        soundReversal();
        const dir = r.direction === 'TOP' ? '⬇ TOP reversal' : '⬆ BOTTOM reversal';
        sendNotif(
          `🔄 REVERSAL — ${r.ticker}`,
          `${dir} · ${r.consecutiveCandles5m} × 5min + ${r.consecutiveCandles1m} × 1min · RSI ${r.rsi2.toFixed(0)}`,
          `reversal:${r.ticker}`,
        );
        addToLog('reversal', r.ticker, `${dir} · RSI ${r.rsi2.toFixed(0)} · 5m:${r.consecutiveCandles5m} 1m:${r.consecutiveCandles1m}`);
        flashRow(r.ticker);
      }
    }

    // 4. Breaking news: new headlines for any currently scanned ticker
    checkNewsAlerts(data);
  }

  // ── News alert checker ────────────────────────────────────────

  function checkNewsAlerts(data) {
    if (alertsMuted) return;

    const newsMap = data.news || {};
    const allItems = Object.values(newsMap).flat();

    // First render: silently mark all existing headlines as seen
    if (!newsInitialized) {
      for (const item of allItems) seenHeadlineIds.add(item.id);
      newsInitialized = true;
      return;
    }

    // Currently scanned tickers
    const scannedTickers = new Set([
      ...(data.gappersUp   || []).map(r => r.ticker),
      ...(data.gappersDown || []).map(r => r.ticker),
      ...(data.momentum    || []).map(r => r.ticker),
      ...(data.reversals   || []).map(r => r.ticker),
    ]);

    for (const [ticker, items] of Object.entries(newsMap)) {
      if (!scannedTickers.has(ticker)) continue;
      for (const item of items) {
        if (seenHeadlineIds.has(item.id)) continue;
        seenHeadlineIds.add(item.id);

        const cat      = item.catalyst || {};
        const strength = cat.strength || 'neutral';
        const type     = cat.type     || 'News';

        // Choose sound by catalyst strength
        if      (strength === 'strong')   soundNewsStrong();
        else if (strength === 'moderate') soundNewsModerate();
        else if (strength === 'negative') soundNewsNegative();
        else                              soundNewsModerate();

        sendNotif(
          `📰 ${type} — ${ticker}`,
          item.title,
          `news:${ticker}:${item.id}`,
        );

        const truncTitle = item.title.length > 70 ? item.title.slice(0, 67) + '…' : item.title;
        addToLog('news', ticker, `[${type}] ${truncTitle}`);
        flashRow(ticker);
      }
    }
  }

  // ── Trade Journal ─────────────────────────────────────────────

  let journalTrades = [];
  let journalLoaded = false;
  let journalDir    = 'LONG';

  function onJournalTabOpen() {
    if (!journalLoaded) loadJournalTrades();
    else renderJournalTab();
  }

  async function loadJournalTrades() {
    try {
      const res = await fetch('/api/journal/trades');
      if (res.ok) {
        journalTrades = await res.json();
        journalLoaded = true;
        renderJournalTab();
        syncJournalPnlToCalc();
      }
    } catch (e) { console.error('Journal load failed:', e); }
  }

  async function saveJournalTrade(trade) {
    try {
      const res = await fetch('/api/journal/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trade),
      });
      if (res.ok) {
        journalTrades.push(trade);
        renderJournalTab();
        syncJournalPnlToCalc();
        return true;
      }
    } catch (e) { console.error('Journal save failed:', e); }
    return false;
  }

  async function deleteJournalTrade(id) {
    if (!confirm('Delete this trade?')) return;
    try {
      await fetch(`/api/journal/trade/${id}`, { method: 'DELETE' });
      journalTrades = journalTrades.filter(t => t.id !== id);
      renderJournalTab();
      syncJournalPnlToCalc();
      toastMsg('Trade deleted');
    } catch (e) { console.error('Delete failed:', e); }
  }

  function setJournalDir(dir) {
    journalDir = dir;
    $('jDirLong').className  = 'dir-btn' + (dir === 'LONG'  ? ' active-long'  : '');
    $('jDirShort').className = 'dir-btn' + (dir === 'SHORT' ? ' active-short' : '');
  }

  function onJournalTickerChange() {
    const t = $('jTicker').value.trim().toUpperCase();
    const price = calcPriceMap.get(t);
    if (price) $('jEntry').value = price.toFixed(2);
    const src = scannerSourceMap.get(t) || 'Manual';
    $('jSourceLabel').textContent = src.toUpperCase();
  }

  function handleJournalSubmit(e) {
    e.preventDefault();
    const ticker = $('jTicker').value.trim().toUpperCase();
    const entry  = parseFloat($('jEntry').value);
    const exit   = parseFloat($('jExit').value);
    const shares = parseInt($('jShares').value) || 0;
    const stop   = parseFloat($('jStop').value) || null;
    const setup  = $('jSetup').value;
    const notes  = $('jNotes').value.trim();
    const src    = ($('jSourceLabel').textContent || '').toLowerCase();

    if (!ticker || !entry || !exit || !shares) {
      toastMsg('Fill in Ticker, Entry, Exit and Shares'); return;
    }

    const pnlDollar  = journalDir === 'LONG' ? (exit - entry) * shares : (entry - exit) * shares;
    const pnlPercent = journalDir === 'LONG' ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100;

    let rMultiple = null;
    if (stop !== null) {
      const stopDist = journalDir === 'LONG' ? entry - stop : stop - entry;
      if (stopDist > 0) rMultiple = pnlDollar / (stopDist * shares);
    }

    // Capture float from current scan data if available
    let float = null;
    const allScanRows = [
      ...(lastData?.gappersUp   || []),
      ...(lastData?.gappersDown || []),
      ...(lastData?.momentum    || []),
    ];
    const scanRow = allScanRows.find(r => r.ticker === ticker);
    if (scanRow) float = scanRow.float ?? null;

    const trade = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      ticker, direction: journalDir, entryPrice: entry, exitPrice: exit,
      shares, setupType: setup, scannerSource: src, notes,
      pnlDollar, pnlPercent, rMultiple, stopPrice: stop, float,
    };

    saveJournalTrade(trade).then(ok => {
      if (ok) {
        resetJournalForm();
        const sign = pnlDollar >= 0 ? '+' : '';
        toastMsg(`✓ ${ticker} logged · ${sign}$${pnlDollar.toFixed(2)}`);
      }
    });
  }

  function resetJournalForm() {
    $('jTicker').value = '';
    $('jEntry').value  = '';
    $('jExit').value   = '';
    $('jShares').value = '';
    $('jStop').value   = '';
    $('jNotes').value  = '';
    $('jSourceLabel').textContent = 'MANUAL';
    $('jTicker').focus();
  }

  // ── Sync journal P&L to position calculator ───────────────────

  function syncJournalPnlToCalc() {
    const today = todayStr();
    const pnl   = journalTrades
      .filter(t => t.timestamp.startsWith(today))
      .reduce((s, t) => s + t.pnlDollar, 0);
    $('calcTodayPnl').value = pnl.toFixed(2);
    calcUpdate();
    updateHeaderPnl(pnl, journalTrades.filter(t => t.timestamp.startsWith(today)).length);
  }

  function updateHeaderPnl(pnl, count) {
    if (!count) { $('headerPnlWrap').style.display = 'none'; return; }
    $('headerPnlWrap').style.display = '';
    const el = $('headerPnlVal');
    el.textContent = (pnl >= 0 ? '+' : '') + '$' + Math.abs(pnl).toFixed(2);
    el.className   = 'header-pnl-val ' + (pnl > 0 ? 'pnl-pos' : pnl < 0 ? 'pnl-neg' : 'pnl-zero');
  }

  function todayStr() { return new Date().toISOString().split('T')[0]; }

  function getWeekStart() {
    const d = new Date(); d.setHours(0,0,0,0);
    d.setDate(d.getDate() - d.getDay()); // Sunday
    return d.toISOString();
  }

  // ── Render journal tab ────────────────────────────────────────

  function renderJournalTab() {
    renderJournalHero();
    renderTodayTable();
    renderKeyStats();
    renderPnlChart();
    renderSetupStats();
    renderTimeStats();
  }

  // ── Hero / today stats bar ────────────────────────────────────

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
      ? (Math.abs(wins.reduce((s,t)=>s+t.pnlDollar,0)/wins.length) /
         Math.abs(losses.reduce((s,t)=>s+t.pnlDollar,0)/losses.length)).toFixed(2) + ':1'
      : '—';

    const hero = $('todayPnlHero');
    hero.textContent = (pnl >= 0 ? '+' : '') + '$' + Math.abs(pnl).toFixed(2);
    hero.className   = 'journal-hero-amount ' + (pnl > 0 ? 'pnl-pos' : pnl < 0 ? 'pnl-neg' : 'pnl-zero');

    $('jHeroTrades').textContent = trades.length;
    $('jHeroWins').textContent   = wins.length;
    $('jHeroLoss').textContent   = losses.length;
    $('jHeroWR').textContent     = wr;
    $('jHeroAvgW').textContent   = avgW;
    $('jHeroAvgL').textContent   = avgL;
    $('jHeroPLR').textContent    = plr;

    updateHeaderPnl(pnl, trades.length);
  }

  // ── Today's trade table ───────────────────────────────────────

  function renderTodayTable() {
    const today  = todayStr();
    const trades = [...journalTrades.filter(t => t.timestamp.startsWith(today))]
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    if (trades.length === 0) {
      $('journalTodayTable').innerHTML = '<div class="empty-state" style="padding:12px">No trades logged today.</div>';
      return;
    }

    let html = `<table class="trade-table">
      <thead><tr>
        <th class="left">Time</th>
        <th class="left">Ticker</th>
        <th>Dir</th>
        <th>Entry</th><th>Exit</th><th>Shares</th>
        <th>P&amp;L $</th><th>P&amp;L %</th>
        <th>R</th>
        <th class="left">Setup</th>
        <th class="left">Source</th>
        <th></th>
      </tr></thead><tbody>`;

    let totalPnl = 0;
    for (const t of trades) {
      totalPnl += t.pnlDollar;
      const time    = new Date(t.timestamp).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
      const rowCls  = t.pnlDollar > 0 ? 'trade-row-win' : t.pnlDollar < 0 ? 'trade-row-loss' : '';
      const pnlStr  = (t.pnlDollar  >= 0 ? '+' : '') + '$' + t.pnlDollar.toFixed(2);
      const pctStr  = (t.pnlPercent >= 0 ? '+' : '') + t.pnlPercent.toFixed(1) + '%';
      const rStr    = t.rMultiple != null ? (t.rMultiple >= 0 ? '+' : '') + t.rMultiple.toFixed(2) + 'R' : '—';
      const dirCls  = t.direction === 'LONG' ? 'pnl-pos' : 'pnl-neg';
      html += `<tr class="${rowCls}">
        <td class="left">${time}</td>
        <td class="ticker-cell left">${t.ticker}</td>
        <td><span class="${dirCls}">${t.direction}</span></td>
        <td>$${t.entryPrice.toFixed(2)}</td>
        <td>$${t.exitPrice.toFixed(2)}</td>
        <td>${t.shares.toLocaleString()}</td>
        <td>${pnlStr}</td>
        <td>${pctStr}</td>
        <td style="color:var(--text-dim)">${rStr}</td>
        <td class="left" style="color:var(--text-dim)">${t.setupType}</td>
        <td class="left" style="color:var(--text-muted)">${t.scannerSource}</td>
        <td><button class="calc-row-btn" onclick="deleteJournalTrade('${t.id}')" title="Delete">✕</button></td>
      </tr>`;
    }

    const totalCls = totalPnl > 0 ? 'pnl-pos' : totalPnl < 0 ? 'pnl-neg' : '';
    html += `<tr class="trade-table-totals">
      <td class="left" colspan="6">TOTAL</td>
      <td class="${totalCls}">${(totalPnl>=0?'+':'') + '$' + totalPnl.toFixed(2)}</td>
      <td colspan="5"></td>
    </tr></tbody></table>`;

    $('journalTodayTable').innerHTML = html;
  }

  // ── Key stats cards ───────────────────────────────────────────

  function renderKeyStats() {
    if (journalTrades.length === 0) {
      $('journalKeyStats').innerHTML = '<div class="empty-state">No trades logged yet.</div>';
      return;
    }
    const wins   = journalTrades.filter(t => t.pnlDollar > 0);
    const losses = journalTrades.filter(t => t.pnlDollar < 0);
    const wr     = (wins.length / journalTrades.length * 100).toFixed(1);
    const avgWin = wins.length   > 0 ? wins.reduce((s,t)=>s+t.pnlDollar,0)/wins.length : 0;
    const avgLos = losses.length > 0 ? Math.abs(losses.reduce((s,t)=>s+t.pnlDollar,0)/losses.length) : 0;
    const plRatio = avgLos > 0 ? (avgWin / avgLos) : 0;

    // Daily grouping
    const dayMap = {};
    for (const t of journalTrades) {
      const d = t.timestamp.split('T')[0];
      dayMap[d] = (dayMap[d] || 0) + t.pnlDollar;
    }
    const days  = Object.keys(dayMap).sort();
    const gDays = days.filter(d => dayMap[d] > 0).length;
    const bestDay  = days.length ? Math.max(...days.map(d => dayMap[d])) : 0;
    const worstDay = days.length ? Math.min(...days.map(d => dayMap[d])) : 0;

    // Current streak
    let streak = 0, streakSign = '';
    for (let i = days.length - 1; i >= 0; i--) {
      const green = dayMap[days[i]] > 0;
      if (i === days.length - 1) { streakSign = green ? '🟢' : '🔴'; streak = 1; }
      else if ((streakSign === '🟢') === green) streak++;
      else break;
    }

    // This week
    const weekStart = getWeekStart();
    const weekPnl   = journalTrades.filter(t => t.timestamp >= weekStart).reduce((s,t)=>s+t.pnlDollar,0);
    const maxDailyRisk = parseFloat($('calcMaxDailyRisk').value) || 0;
    const weekGoal  = maxDailyRisk * 3;

    const cards = [
      { label: 'Total Trades', val: journalTrades.length, cls: '' },
      { label: 'Win Rate',     val: wr + '%',  cls: parseFloat(wr) >= 60 ? 'pnl-pos' : 'pnl-neg' },
      { label: 'P/L Ratio',   val: plRatio > 0 ? plRatio.toFixed(2)+':1' : '—', cls: plRatio >= 2 ? 'pnl-pos' : plRatio > 0 ? 'pnl-neg' : '' },
      { label: 'Streak',       val: streak + ' ' + streakSign, cls: '' },
      { label: 'Best Day',     val: bestDay  ? '+$'+bestDay.toFixed(0)  : '—', cls: 'pnl-pos' },
      { label: 'Worst Day',    val: worstDay < 0 ? '-$'+Math.abs(worstDay).toFixed(0) : '—', cls: 'pnl-neg' },
      { label: 'This Week',    val: (weekPnl>=0?'+':'') + '$' + weekPnl.toFixed(0), cls: weekPnl>=0?'pnl-pos':'pnl-neg' },
      { label: 'Weekly Goal',  val: weekGoal > 0 ? '$'+weekGoal.toFixed(0) : 'Set daily risk', cls: '' },
      { label: 'Green Days',   val: gDays + '/' + days.length, cls: gDays > days.length/2 ? 'pnl-pos' : 'pnl-neg' },
    ];

    $('journalKeyStats').innerHTML = `<div class="stats-grid">${
      cards.map(c => `<div class="stat-card">
        <div class="stat-card-label">${c.label}</div>
        <div class="stat-card-value ${c.cls}">${c.val}</div>
      </div>`).join('')
    }</div>`;
  }

  // ── Daily P&L bar chart ───────────────────────────────────────

  function renderPnlChart() {
    // Group all trades by day, show last 30 days
    const dayMap = {};
    for (const t of journalTrades) {
      const d = t.timestamp.split('T')[0];
      dayMap[d] = (dayMap[d] || 0) + t.pnlDollar;
    }
    const allDays = Object.keys(dayMap).sort().slice(-30);
    if (allDays.length === 0) {
      $('journalPnlChart').innerHTML = '<div class="empty-state" style="padding:12px">No trade history yet.</div>';
      return;
    }

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
      return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${col}" opacity="0.85" rx="1">
                <title>${d}: ${lbl}</title></rect>`;
    }).join('');

    // x-axis labels (first, middle, last)
    const labels = [
      `<text x="0"   y="98" font-size="7" fill="#555" text-anchor="start">${allDays[0]}</text>`,
      `<text x="200" y="98" font-size="7" fill="#555" text-anchor="middle">${allDays[Math.floor(n/2)] || ''}</text>`,
      `<text x="400" y="98" font-size="7" fill="#555" text-anchor="end">${allDays[n-1]}</text>`,
    ].join('');

    $('journalPnlChart').innerHTML = `<div class="pnl-chart-wrap">
      <svg viewBox="0 0 400 100" class="pnl-chart-svg" style="height:90px">
        <line x1="0" y1="50" x2="400" y2="50" stroke="#262626" stroke-width="1"/>
        ${bars}
        ${labels}
      </svg>
    </div>`;
  }

  // ── Performance by setup ──────────────────────────────────────

  function renderSetupStats() {
    if (journalTrades.length === 0) {
      $('journalSetupStats').innerHTML = '<div class="empty-state" style="padding:12px">No trades yet.</div>';
      return;
    }

    const setups = {};
    for (const t of journalTrades) {
      const s = t.setupType || 'Other';
      if (!setups[s]) setups[s] = [];
      setups[s].push(t);
    }

    // Sort by total P&L descending
    const rows = Object.entries(setups)
      .map(([name, trades]) => {
        const wins   = trades.filter(t => t.pnlDollar > 0);
        const total  = trades.reduce((s,t)=>s+t.pnlDollar,0);
        const avg    = total / trades.length;
        const wr     = (wins.length / trades.length * 100).toFixed(0);
        const best   = Math.max(...trades.map(t=>t.pnlDollar));
        const worst  = Math.min(...trades.map(t=>t.pnlDollar));
        return { name, count: trades.length, wr, avg, total, best, worst };
      })
      .sort((a,b) => b.total - a.total);

    let html = `<table class="perf-table">
      <thead><tr>
        <th>Setup Type</th>
        <th>Trades</th><th>Win %</th>
        <th>Avg P&amp;L</th><th>Total P&amp;L</th>
        <th>Best</th><th>Worst</th>
      </tr></thead><tbody>`;

    for (const r of rows) {
      const tCls = r.total >= 0 ? 'pnl-pos' : 'pnl-neg';
      const aCls = r.avg   >= 0 ? 'pnl-pos' : 'pnl-neg';
      const wCls = parseFloat(r.wr) >= 60 ? 'pnl-pos' : 'pnl-neg';
      html += `<tr>
        <td>${r.name}</td>
        <td>${r.count}</td>
        <td class="${wCls}">${r.wr}%</td>
        <td class="${aCls}">${(r.avg>=0?'+':'') + '$' + r.avg.toFixed(2)}</td>
        <td class="${tCls}">${(r.total>=0?'+':'') + '$' + r.total.toFixed(2)}</td>
        <td class="pnl-pos">+$${r.best.toFixed(2)}</td>
        <td class="pnl-neg">${r.worst < 0 ? '-$'+Math.abs(r.worst).toFixed(2) : '+$'+r.worst.toFixed(2)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    $('journalSetupStats').innerHTML = html;
  }

  // ── Performance by time of day ────────────────────────────────

  function renderTimeStats() {
    if (journalTrades.length === 0) {
      $('journalTimeStats').innerHTML = '<div class="empty-state" style="padding:12px">No trades yet.</div>';
      return;
    }

    const zones = [
      { label: 'Pre-Market',   key: 'pre',    range: '4:00 – 9:29',   cls: '' },
      { label: 'Prime Time',   key: 'prime',  range: '9:30 – 10:30',  cls: 'time-zone-prime' },
      { label: 'Caution Zone', key: 'caution',range: '10:30 – 11:30', cls: 'time-zone-caution' },
      { label: 'Danger Zone',  key: 'danger', range: '11:30+',         cls: 'time-zone-danger' },
    ];

    const buckets = { pre: [], prime: [], caution: [], danger: [] };
    for (const t of journalTrades) {
      const h = new Date(t.timestamp).getHours();
      const m = new Date(t.timestamp).getMinutes();
      const mins = h * 60 + m;
      if      (mins < 9*60+30)  buckets.pre.push(t);
      else if (mins < 10*60+30) buckets.prime.push(t);
      else if (mins < 11*60+30) buckets.caution.push(t);
      else                      buckets.danger.push(t);
    }

    let html = `<table class="perf-table">
      <thead><tr>
        <th>Time Zone</th><th>Range</th>
        <th>Trades</th><th>Win %</th><th>Total P&amp;L</th>
      </tr></thead><tbody>`;

    for (const z of zones) {
      const trades = buckets[z.key];
      if (trades.length === 0) {
        html += `<tr><td class="${z.cls}">${z.label}</td><td style="color:var(--text-muted)">${z.range}</td><td colspan="3" style="color:var(--text-muted)">—</td></tr>`;
        continue;
      }
      const wins  = trades.filter(t => t.pnlDollar > 0);
      const total = trades.reduce((s,t)=>s+t.pnlDollar,0);
      const wr    = (wins.length / trades.length * 100).toFixed(0);
      const tCls  = total >= 0 ? 'pnl-pos' : 'pnl-neg';
      const wCls  = parseFloat(wr) >= 60 ? 'pnl-pos' : 'pnl-neg';
      html += `<tr>
        <td class="${z.cls}">${z.label}</td>
        <td style="color:var(--text-muted)">${z.range}</td>
        <td>${trades.length}</td>
        <td class="${wCls}">${wr}%</td>
        <td class="${tCls}">${(total>=0?'+':'') + '$' + total.toFixed(2)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    $('journalTimeStats').innerHTML = html;
  }

  // ── Position Size Calculator ──────────────────────────────────

  // Price map: ticker → current price (populated from lastData on each render)
  const calcPriceMap = new Map();

  function toggleCalc() {
    const drawer = $('calcDrawer');
    if (drawer.classList.contains('open')) closeCalc();
    else openCalc();
  }

  function openCalc() {
    $('calcDrawer').classList.add('open');
    $('calcOverlay').classList.add('open');
    $('calcBtn').classList.add('paused'); // reuse yellow highlight style
  }

  function closeCalc() {
    $('calcDrawer').classList.remove('open');
    $('calcOverlay').classList.remove('open');
    $('calcBtn').classList.remove('paused');
  }

  function openCalcForTicker(ticker, price) {
    $('calcTicker').value = ticker;
    $('calcEntry').value  = price.toFixed(2);
    $('calcStop').value   = '';
    calcUpdate();
    openCalc();
    // Focus stop price input so user can type their stop immediately
    setTimeout(() => $('calcStop').focus(), 280);
  }

  // When user types/picks a ticker, auto-fill entry price if known
  function onCalcTickerChange() {
    const t = $('calcTicker').value.trim().toUpperCase();
    const p = calcPriceMap.get(t);
    if (p) {
      $('calcEntry').value = p.toFixed(2);
      calcUpdate();
    }
  }

  // Populate datalist + price map + scanner source map from current scan data
  const scannerSourceMap = new Map(); // ticker → scanner source label

  function updateCalcTickerList(data) {
    calcPriceMap.clear();
    scannerSourceMap.clear();

    for (const r of (data.gappersUp   || [])) { calcPriceMap.set(r.ticker, r.price); scannerSourceMap.set(r.ticker, 'Gap Scanner'); }
    for (const r of (data.gappersDown || [])) { calcPriceMap.set(r.ticker, r.price); scannerSourceMap.set(r.ticker, 'Gap Scanner'); }
    for (const r of (data.momentum    || [])) { calcPriceMap.set(r.ticker, r.price); scannerSourceMap.set(r.ticker, 'Momentum'); }
    for (const r of (data.reversals   || [])) { if (!scannerSourceMap.has(r.ticker)) scannerSourceMap.set(r.ticker, 'Reversal'); }

    const tickers = [...calcPriceMap.keys()];
    const opts = tickers.map(t => `<option value="${t}">`).join('');
    $('calcTickerList').innerHTML = opts;
    // Also update journal datalist if it exists
    const jList = $('jTickerList');
    if (jList) jList.innerHTML = opts;
  }

  // ── Core calculation ─────────────────────────────────────────

  function calcUpdate() {
    const maxRisk    = parseFloat($('calcMaxRiskTrade').value)  || 0;
    const maxDaily   = parseFloat($('calcMaxDailyRisk').value)  || 0;
    const todayPnl   = parseFloat($('calcTodayPnl').value)      || 0;
    const entry      = parseFloat($('calcEntry').value)         || 0;
    const stop       = parseFloat($('calcStop').value)          || 0;

    // Validate: need entry > stop > 0
    const valid = entry > 0 && stop > 0 && entry > stop;

    if (!valid) {
      // Clear outputs
      ['calcStopDist','calcMaxShares','calcPosValue','calcRiskAmount',
       'calcPT2','calcPT3','calcProfit2','calcProfit3'].forEach(id => {
        const el = $(id); if (el) el.textContent = '—';
      });
      $('rrBarWrap').style.display = 'none';
      $('rrEmpty').style.display   = '';
      calcUpdateTradesRemaining(maxDaily, maxRisk, todayPnl);
      return;
    }

    const stopDist  = entry - stop;
    const stopPct   = (stopDist / entry) * 100;
    const maxShares = maxRisk > 0 ? Math.floor(maxRisk / stopDist) : 0;
    const posValue  = maxShares * entry;
    const riskAmt   = maxShares * stopDist;
    const pt2       = entry + 2 * stopDist;
    const pt3       = entry + 3 * stopDist;
    const profit2   = maxShares * 2 * stopDist;
    const profit3   = maxShares * 3 * stopDist;

    $('calcStopDist').textContent  = `$${stopDist.toFixed(2)} (${stopPct.toFixed(1)}%)`;
    $('calcMaxShares').textContent = maxShares > 0 ? maxShares.toLocaleString() + ' shares' : '—';
    $('calcPosValue').textContent  = '$' + posValue.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2});

    // Risk amount — warn if it exceeds max risk (can happen with rounding)
    const riskEl = $('calcRiskAmount');
    riskEl.textContent = '$' + riskAmt.toFixed(2);
    riskEl.className = 'calc-result-val ' + (riskAmt > maxRisk && maxRisk > 0 ? 'calc-val-warn' : 'calc-risk-val');

    $('calcPT2').textContent     = '$' + pt2.toFixed(2);
    $('calcPT3').textContent     = '$' + pt3.toFixed(2);
    $('calcProfit2').textContent = profit2 > 0 ? '+$' + profit2.toFixed(2) : '';
    $('calcProfit3').textContent = profit3 > 0 ? '+$' + profit3.toFixed(2) : '';

    // R/R bar — risk is 1 part, reward is 2 parts at 2:1 → risk=33.3% of bar
    $('rrBarWrap').style.display = '';
    $('rrEmpty').style.display   = 'none';
    $('rrRisk').style.width      = '33.3%';
    $('rrReward').style.width    = '66.7%';
    $('rrRiskLabel').textContent   = maxShares > 0 ? `-$${riskAmt.toFixed(0)}` : 'RISK';
    $('rrRewardLabel').textContent = maxShares > 0 ? `+$${profit2.toFixed(0)}` : 'REWARD 2×';
    $('rrStopLabel').textContent   = '$' + stop.toFixed(2);
    $('rrTargetLabel').textContent = '$' + pt2.toFixed(2);

    calcUpdateTradesRemaining(maxDaily, maxRisk, todayPnl);
  }

  function calcUpdateTradesRemaining(maxDaily, maxRisk, todayPnl) {
    const infoEl = $('tradesPnlInfo');
    if (maxDaily <= 0 || maxRisk <= 0) {
      $('tradesRemaining').textContent = '—';
      $('tradesUsedBar').style.width   = '0%';
      infoEl.textContent = '';
      return;
    }

    // Capital remaining = max daily budget minus what's already at risk/lost today
    const capitalRemaining = maxDaily + Math.min(todayPnl, 0); // todayPnl is negative if losing
    const remaining = Math.max(0, Math.floor(capitalRemaining / maxRisk));
    const usedPct   = Math.min(100, ((maxDaily - capitalRemaining) / maxDaily) * 100);

    $('tradesRemaining').textContent   = remaining;
    $('tradesUsedBar').style.width     = Math.max(0, usedPct) + '%';
    $('tradesRemaining').style.color   = remaining >= 3 ? 'var(--green)' : remaining >= 1 ? 'var(--yellow)' : 'var(--red)';

    if (todayPnl < 0) {
      infoEl.textContent = `Today's P&L: -$${Math.abs(todayPnl).toFixed(2)} · $${Math.max(0, capitalRemaining).toFixed(2)} daily budget left`;
      infoEl.style.display = '';
    } else if (todayPnl > 0) {
      infoEl.textContent = `Today's P&L: +$${todayPnl.toFixed(2)}`;
      infoEl.style.display = '';
    } else {
      infoEl.style.display = 'none';
    }
  }

  // ── localStorage persistence ──────────────────────────────────

  const CALC_STORAGE_KEY = 'rossCalcSettings';

  function saveCalcSettings() {
    try {
      localStorage.setItem(CALC_STORAGE_KEY, JSON.stringify({
        accountSize:    $('calcAccountSize').value,
        maxDailyRisk:   $('calcMaxDailyRisk').value,
        maxRiskTrade:   $('calcMaxRiskTrade').value,
        todayPnl:       $('calcTodayPnl').value,
      }));
    } catch (_) {}
  }

  function loadCalcSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(CALC_STORAGE_KEY) || 'null');
      if (!saved) return;
      if (saved.accountSize)  $('calcAccountSize').value  = saved.accountSize;
      if (saved.maxDailyRisk) $('calcMaxDailyRisk').value = saved.maxDailyRisk;
      if (saved.maxRiskTrade) $('calcMaxRiskTrade').value = saved.maxRiskTrade;
      if (saved.todayPnl)     $('calcTodayPnl').value     = saved.todayPnl;
    } catch (_) {}
  }

  loadCalcSettings();
  calcUpdate();

  // ── Pre-Market Checklist ──────────────────────────────────────

  const CL_STORAGE_KEY = 'cl_checklist_v1';
  const clState = { sleep: null, mental: null, week: null, market: null, scanner: null, risk: null, trades: null };

  function getETHour() {
    return parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }).format(new Date()), 10);
  }
  function getETMinute() {
    return parseInt(new Intl.DateTimeFormat('en-US', { minute: 'numeric', timeZone: 'America/New_York' }).format(new Date()), 10);
  }
  function todayETKey() {
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/New_York' }).format(new Date());
  }

  function loadChecklistRecord() {
    try { return JSON.parse(localStorage.getItem(CL_STORAGE_KEY) || 'null'); } catch { return null; }
  }
  function saveChecklistRecord(rec) {
    try { localStorage.setItem(CL_STORAGE_KEY, JSON.stringify(rec)); } catch {}
  }

  function openChecklist() {
    const d = new Intl.DateTimeFormat('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric', timeZone:'America/New_York' }).format(new Date());
    $('clDateLabel').textContent = d + ' — New York Time';
    $('checklistOverlay').classList.add('open');
    autoPopulateWeekPerf();
  }
  function closeChecklist() {
    $('checklistOverlay').classList.remove('open');
  }
  function skipChecklist() {
    saveChecklistRecord({ date: todayETKey(), skipped: true, intensity: null });
    closeChecklist();
    updateChecklistBadge(null);
    checkMissedChecklist();
  }
  function handleChecklistOverlayClick(e) {
    if (e.target === $('checklistOverlay')) closeChecklist();
  }

  function clSelect(key, val) {
    // Deselect siblings
    ['good','neutral','bad'].forEach(v => {
      const el = $(`cl-${key}-${v}`);
      if (el) el.className = 'cl-option';
    });
    // Select chosen
    const chosen = $(`cl-${key}-${val}`);
    if (chosen) chosen.classList.add(`sel-${val}`);
    clState[key] = val;
    updateChecklistRecommendation();
    // Enable complete button if enough answered
    const answered = Object.values(clState).filter(Boolean).length;
    $('clCompleteBtn').disabled = answered < 5;
  }

  function updateChecklistRecommendation() {
    const { sleep, mental, week, market, scanner, risk, trades } = clState;
    const answered = [sleep, mental, week, market, scanner, risk, trades].filter(Boolean).length;
    if (answered < 4) { $('clRecommendation').style.display = 'none'; return; }
    $('clRecommendation').style.display = '';

    // Score: good=1, neutral=0, bad=-1
    const score = v => v === 'good' ? 1 : v === 'bad' ? -1 : 0;
    const total = (score(sleep) + score(mental) + score(week) + score(market) + score(scanner));

    let intensity, cls, label, reason;
    if (total >= 3) {
      intensity = 'FULL SIZE'; cls = 'cl-rec-full'; label = '🟢 TRADE FULL SIZE';
      reason = 'Conditions are excellent. Mental clarity + hot market. Execute your A-setups with full conviction.';
    } else if (total >= 0) {
      intensity = 'HALF SIZE'; cls = 'cl-rec-half'; label = '🟡 TRADE HALF SIZE';
      reason = 'Mixed conditions. Reduce size 50%, focus only on A+ setups, stop after 2 losses.';
    } else if (total >= -2) {
      intensity = 'SMALL SIZE'; cls = 'cl-rec-small'; label = '🔴 SMALL SIZE ONLY';
      reason = 'Challenging conditions. 1 trade max, minimal size. Protect capital above all.';
    } else {
      intensity = 'SIT OUT'; cls = 'cl-rec-wait'; label = '⚫ CONSIDER SITTING OUT';
      reason = 'Too many red flags. Preserve capital. Watch and learn — no forced trades today.';
    }

    const box = $('clRecBox');
    box.className = `cl-rec-box ${cls}`;
    box.textContent = label;
    $('clRecReason').textContent = reason;

    // Override with user selection if set
    if (risk) {
      const userPick = risk === 'good' ? 'FULL' : risk === 'neutral' ? 'HALF' : 'SMALL';
      // store for badge
      clState._recommendedIntensity = userPick;
    } else {
      clState._recommendedIntensity = intensity.split(' ')[0];
    }
  }

  function completeChecklist() {
    const intensity = clState._recommendedIntensity || 'FULL';
    const rec = { date: todayETKey(), completed: true, intensity, state: { ...clState } };
    saveChecklistRecord(rec);
    closeChecklist();
    updateChecklistBadge(intensity);
    $('clReminder').classList.remove('show');
  }

  function updateChecklistBadge(intensity) {
    const badge = $('clSizeBadge');
    if (!intensity) { badge.style.display = 'none'; return; }
    badge.style.display = 'inline-block';
    badge.className = 'cl-size-badge';
    if (intensity === 'FULL')  badge.classList.add('cl-size-full');
    else if (intensity === 'HALF')  badge.classList.add('cl-size-half');
    else badge.classList.add('cl-size-small');
    badge.textContent = intensity;
  }

  function checkMissedChecklist() {
    const h = getETHour();
    const rec = loadChecklistRecord();
    const todayKey = todayETKey();
    const doneToday = rec && rec.date === todayKey && (rec.completed || rec.skipped);
    if (!doneToday && h >= 10) {
      $('clReminder').classList.add('show');
    } else {
      $('clReminder').classList.remove('show');
    }
  }

  function checkAutoShowChecklist() {
    const h = getETHour();
    const m = getETMinute();
    const rec = loadChecklistRecord();
    const todayKey = todayETKey();
    const doneToday = rec && rec.date === todayKey;

    // Restore badge from saved state
    if (doneToday && rec.intensity) {
      updateChecklistBadge(rec.intensity);
    }

    // Auto-open 4:00 AM - 9:29 AM ET if not done yet
    if (!doneToday && h >= 4 && (h < 9 || (h === 9 && m < 30))) {
      setTimeout(openChecklist, 1200);
    }

    // Show missed reminder if after 9:30 AM and not done
    checkMissedChecklist();
  }

  function updateChecklistScannerData(data) {
    // Auto-suggest scanner quality based on gap count
    const gapCount = (data.gappersUp?.length || 0) + (data.gappersDown?.length || 0);
    let scannerVal = '', scannerSuggestion = '';
    if (gapCount >= 8) {
      scannerVal = 'good'; scannerSuggestion = `${gapCount} gappers — HOT scanner`;
    } else if (gapCount >= 4) {
      scannerVal = 'neutral'; scannerSuggestion = `${gapCount} gappers — moderate activity`;
    } else {
      scannerVal = 'bad'; scannerSuggestion = `${gapCount} gappers — quiet/cold scanner`;
    }
    const note = $('clScannerNote');
    const val  = $('clScannerValue');
    if (note && val) {
      note.style.display = '';
      val.textContent = scannerSuggestion;
    }
    // Auto-select if user hasn't touched it
    if (!clState.scanner) clSelect('scanner', scannerVal);
  }

  function autoPopulateWeekPerf() {
    // Use journal data for week P&L if available
    try {
      const trades = journalTrades || [];
      const now = new Date();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      monday.setHours(0,0,0,0);
      const weekPnl = trades
        .filter(t => new Date(t.timestamp) >= monday)
        .reduce((s, t) => s + (t.pnlDollar || 0), 0);

      const note = $('clWeekPnlNote');
      const val  = $('clWeekPnlValue');
      if (note && val) {
        note.style.display = '';
        const fmt = weekPnl >= 0 ? `+$${weekPnl.toFixed(2)}` : `-$${Math.abs(weekPnl).toFixed(2)}`;
        val.textContent = fmt + ' this week';
        val.style.color = weekPnl >= 0 ? 'var(--green)' : 'var(--red)';
      }
      // Auto-suggest week state
      if (!clState.week) {
        if (weekPnl > 0) clSelect('week', 'good');
        else if (weekPnl < 0) clSelect('week', 'bad');
        else clSelect('week', 'neutral');
      }
    } catch (_) {}
  }

  // ── TOS CSV Import ─────────────────────────────────────────────

  let importParsedTrades = [];

  function openImportModal(tab) {
    $('importOverlay').classList.add('open');
    $('importStep1').style.display = '';
    $('importStep2').style.display = 'none';
    $('importParseMsg').className = 'import-parse-msg';
    $('importParseMsg').textContent = '';
    switchImportTab(tab || 'file');
  }
  function closeImportModal() { $('importOverlay').classList.remove('open'); }
  function handleImportOverlayClick(e) { if (e.target === $('importOverlay')) closeImportModal(); }
  function importGoBack() {
    $('importStep2').style.display = 'none';
    $('importStep1').style.display = '';
  }

  function switchImportTab(tab) {
    $('importTabFile').classList.toggle('active', tab === 'file');
    $('importTabPaste').classList.toggle('active', tab === 'paste');
    $('importFileSection').style.display  = tab === 'file'  ? '' : 'none';
    $('importPasteSection').style.display = tab === 'paste' ? '' : 'none';
  }

  function handleDragOver(e) { e.preventDefault(); $('importDropzone').classList.add('drag-over'); }
  function handleDragLeave() { $('importDropzone').classList.remove('drag-over'); }
  function handleDrop(e) {
    e.preventDefault();
    $('importDropzone').classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) readImportFile(file);
  }
  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) readImportFile(file);
  }
  function readImportFile(file) {
    const reader = new FileReader();
    reader.onload = ev => processImportText(ev.target.result);
    reader.readAsText(file);
  }
  function parsePasteInput() {
    processImportText($('importPasteArea').value);
  }

  // ── CSV parsing ──────────────────────────────────────────────

  function parseCSVRow(line) {
    const result = [];
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

  function processImportText(text) {
    const msg = $('importParseMsg');
    msg.className = 'import-parse-msg';

    // Detect separator: if first data lines look tab-separated, use tab
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    // Find the header row containing 'Exec Time' or 'Symbol'
    let headerIdx = -1;
    for (let i = 0; i < Math.min(lines.length, 40); i++) {
      const l = lines[i];
      if ((l.includes('Exec Time') || l.includes('exec time')) && l.includes('Symbol')) {
        headerIdx = i; break;
      }
      // Tab-separated fallback
      if (l.includes('\t') && l.toLowerCase().includes('symbol') && (l.toLowerCase().includes('side') || l.toLowerCase().includes('buy'))) {
        headerIdx = i; break;
      }
    }

    if (headerIdx < 0) {
      msg.className = 'import-parse-msg err';
      msg.textContent = '✗ Could not find a valid TOS Account Statement header row. Make sure you exported from Monitor → Activity & Positions.';
      return;
    }

    const sep = lines[headerIdx].includes('\t') ? '\t' : ',';
    const rawHeaders = sep === '\t' ? lines[headerIdx].split('\t') : parseCSVRow(lines[headerIdx]);
    const headers = rawHeaders.map(h => h.trim().replace(/^"|"$/g, ''));

    const colIdx = name => {
      const n = name.toLowerCase();
      return headers.findIndex(h => h.toLowerCase() === n || h.toLowerCase().includes(n));
    };

    const idxTime    = colIdx('exec time');
    const idxSpread  = colIdx('spread');
    const idxSide    = colIdx('side');
    const idxQty     = colIdx('qty');
    const idxSymbol  = colIdx('symbol');
    const idxPrice   = colIdx('price');

    if (idxSymbol < 0 || idxSide < 0 || idxQty < 0) {
      msg.className = 'import-parse-msg err';
      msg.textContent = '✗ Required columns (Symbol, Side, Qty) not found. Check the file format.';
      return;
    }

    const fills = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('---') || line.startsWith('Account') || line.startsWith('Net')) continue;

      const vals = sep === '\t' ? line.split('\t').map(v => v.trim().replace(/^"|"$/g, ''))
                                 : parseCSVRow(line);
      if (vals.length < 3) continue;

      const spread = idxSpread >= 0 ? vals[idxSpread] : 'STOCK';
      if (spread && spread.toUpperCase() !== 'STOCK') continue; // skip options

      const side = (vals[idxSide] || '').toUpperCase().trim();
      if (side !== 'BUY' && side !== 'SELL') continue;

      const symbol = (vals[idxSymbol] || '').toUpperCase().trim();
      if (!symbol || symbol.length > 5 || /[^A-Z]/.test(symbol)) continue;

      const qty = parseFloat(vals[idxQty]) || 0;
      if (qty <= 0) continue;

      const priceRaw = idxPrice >= 0 ? vals[idxPrice] : '0';
      const price = parseFloat(priceRaw.replace(/[^0-9.]/g, '')) || 0;
      if (price <= 0) continue;

      let timestamp = new Date().toISOString();
      if (idxTime >= 0 && vals[idxTime]) {
        // TOS format: "M/D/YY H:MM:SS" or "M/D/YYYY H:MM:SS" or "YYYY/MM/DD HH:MM:SS"
        const rawTime = vals[idxTime].trim();
        const parsed = new Date(rawTime);
        if (!isNaN(parsed.getTime())) timestamp = parsed.toISOString();
      }

      fills.push({ symbol, side, qty, price, timestamp });
    }

    if (fills.length === 0) {
      msg.className = 'import-parse-msg err';
      msg.textContent = '✗ No valid stock fills found. Make sure the file contains STOCK trades with BUY/SELL rows.';
      return;
    }

    // Sort by timestamp
    fills.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Pair into round-trip trades
    importParsedTrades = pairFillsToTrades(fills);

    if (importParsedTrades.length === 0) {
      msg.className = 'import-parse-msg err';
      msg.textContent = `✗ Found ${fills.length} fills but no completed round-trips (all positions may still be open).`;
      return;
    }

    msg.className = 'import-parse-msg ok';
    msg.textContent = `✓ Found ${fills.length} fills → ${importParsedTrades.length} completed trades.`;
    setTimeout(showImportPreview, 300);
  }

  function pairFillsToTrades(fills) {
    const positions = {}; // symbol → [{side, avgPrice, qty, openTime}]
    const trades    = [];

    function addToPos(pos, side, price, qty, openTime) {
      const existing = pos.find(p => p.side === side);
      if (existing) {
        const total = existing.qty + qty;
        existing.avgPrice = (existing.avgPrice * existing.qty + price * qty) / total;
        existing.qty = total;
      } else {
        pos.push({ side, avgPrice: price, qty, openTime });
      }
    }

    for (const fill of fills) {
      const { symbol, side, qty, price, timestamp } = fill;
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
        } else {
          addToPos(pos, 'LONG', price, qty, timestamp);
        }
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
        } else {
          addToPos(pos, 'SHORT', price, qty, timestamp);
        }
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
    for (const t of importParsedTrades) {
      const isWin = t.pnlDollar >= 0;
      if (isWin) wins++; else losses++;

      // Check if ticker is on scanner
      const onScanner = tickerPriceMap.has(t.ticker);
      const sourcePick = ($('importAutoTag') && $('importAutoTag').checked && onScanner)
        ? (scannerSourceMap.get(t.ticker) || 'Scanner') : 'TOS Import';

      const pnlFmt  = (t.pnlDollar >= 0 ? '+' : '') + '$' + t.pnlDollar.toFixed(2);
      const pctFmt  = (t.pnlPercent >= 0 ? '+' : '') + t.pnlPercent.toFixed(2) + '%';
      const timeStr = new Date(t.exitTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
      const pnlColor = isWin ? 'var(--green)' : 'var(--red)';

      const tr = document.createElement('tr');
      tr.className = isWin ? 'import-row-win' : 'import-row-loss';
      tr.innerHTML = `
        <td>${timeStr} ET</td>
        <td><b>${t.ticker}</b>${onScanner ? ' <span style="color:var(--cyan);font-size:9px">●SCAN</span>' : ''}</td>
        <td style="color:${t.direction==='LONG'?'var(--green)':'var(--red)'}">${t.direction}</td>
        <td>$${t.entryPrice.toFixed(2)}</td>
        <td>$${t.exitPrice.toFixed(2)}</td>
        <td>${t.shares}</td>
        <td style="color:${pnlColor};font-weight:700">${pnlFmt}</td>
        <td style="color:${pnlColor}">${pctFmt}</td>
        <td style="color:var(--text-muted)">${sourcePick}</td>`;
      tbody.appendChild(tr);
    }

    $('importPreviewTitle').textContent = `${importParsedTrades.length} trades — ${wins} winners / ${losses} losers`;
    const totalPnl = importParsedTrades.reduce((s, t) => s + t.pnlDollar, 0);
    const pnlFmt = (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(2);
    $('importCountLabel').textContent = `Total P&L: ${pnlFmt}`;
  }

  async function confirmImportAll() {
    const btn = $('importAllBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Importing...';

    const autoTag = $('importAutoTag') && $('importAutoTag').checked;
    const tradesToSave = importParsedTrades.map(t => {
      const onScanner = tickerPriceMap.has(t.ticker);
      return {
        id:            `tos-csv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp:     t.exitTime,
        ticker:        t.ticker,
        direction:     t.direction,
        entryPrice:    t.entryPrice,
        exitPrice:     t.exitPrice,
        shares:        t.shares,
        setupType:     'Imported',
        scannerSource: autoTag && onScanner ? (scannerSourceMap.get(t.ticker) || 'Scanner') : 'TOS Import',
        notes:         `Imported from TOS AccountStatement.csv`,
        pnlDollar:     t.pnlDollar,
        pnlPercent:    t.pnlPercent,
        externalId:    `csv-${t.ticker}-${t.entryTime}-${t.exitTime}`,
      };
    });

    try {
      const res = await fetch('/api/journal/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tradesToSave),
      });
      const data = await res.json();
      closeImportModal();
      await loadJournalTrades();
      renderJournalTab();
      // Show success notification in alert log
      addAlert('system', `📥 Imported ${data.added} trades from TOS CSV`);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '⚡ Import All';
      $('importCountLabel').textContent = `Error: ${e.message}`;
    }
  }

  // ── Settings tab ─────────────────────────────────────────────

  async function loadSettings() {
    try {
      const r = await fetch('/api/settings');
      const s = await r.json();
      if (s.tosAlertLogPath) $('tosLogPath').value = s.tosAlertLogPath;
      updateTosWatcherStatus(s.tosWatcherActive, s.tosWatcherPath);
      if (s.schwabAutoSync) $('schwabAutoSyncToggle').checked = true;
    } catch {}
  }

  function updateTosWatcherStatus(active, path) {
    const el = $('tosWatcherStatus');
    if (active) {
      el.className = 'tos-watcher-status active';
      el.textContent = `✓ Watching: ${path}`;
    } else {
      el.className = 'tos-watcher-status inactive';
      el.textContent = 'Not active — enter a path and click Save to start';
    }
  }

  async function saveTosPath() {
    const path = $('tosLogPath').value.trim();
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tosAlertLogPath: path }),
      });
      const s = await r.json();
      updateTosWatcherStatus(s.settings.tosAlertLogPath && path, path);
      addAlert('system', path ? `🔔 TOS Watcher started: ${path}` : '🔔 TOS Watcher stopped');
    } catch (e) { alert('Failed to save: ' + e.message); }
  }

  async function stopTosWatcherUI() {
    $('tosLogPath').value = '';
    await saveTosPath();
  }
  // Named stopTosWatcher conflicts with imported backend name — alias
  const stopTosWatcher = stopTosWatcherUI;

  // ── Schwab settings ──────────────────────────────────────────

  async function loadSchwabStatus() {
    try {
      const r = await fetch('/api/schwab/status');
      const s = await r.json();
      updateSchwabStatusUI(s);
      if (s.config) {
        if (s.config.appKey)      $('schwabAppKey').value      = s.config.appKey;
        if (s.config.callbackUrl) $('schwabCallbackUrl').value = s.config.callbackUrl;
        if (s.config.accountId)   $('schwabAccountId').value   = s.config.accountId;
        // appSecretMasked — show placeholder
        if (s.config.appSecretMasked) $('schwabAppSecret').placeholder = s.config.appSecretMasked;
      }
      if (s.autoSync) $('schwabAutoSyncToggle').checked = true;
    } catch {}
  }

  function updateSchwabStatusUI(s) {
    const badge = $('schwabStatusBadge');
    if (!badge) return;
    badge.className = `schwab-status-badge ${s.status}`;
    badge.textContent = s.status === 'connected' ? '✓ Connected'
                      : s.status === 'expired'   ? '⚠ Token Expired'
                      : '⚫ Not Configured';

    // Header sync badge
    const syncBadge = $('schwabSyncBadge');
    if (syncBadge) syncBadge.classList.toggle('show', s.autoSync);

    // Disable connect/refresh/disconnect based on state
    if ($('schwabConnectBtn')) $('schwabConnectBtn').disabled = !s.configured;
    if ($('schwabRefreshBtn')) $('schwabRefreshBtn').disabled = s.status !== 'connected' && s.status !== 'expired';
  }

  async function saveSchwabCredentials() {
    const body = {};
    const key   = $('schwabAppKey').value.trim();
    const sec   = $('schwabAppSecret').value.trim();
    const url   = $('schwabCallbackUrl').value.trim();
    const acc   = $('schwabAccountId').value.trim();
    if (key) body.appKey      = key;
    if (sec) body.appSecret   = sec;
    if (url) body.callbackUrl = url;
    if (acc) body.accountId   = acc;
    if (!Object.keys(body).length) { alert('Enter at least one credential field'); return; }
    try {
      const r = await fetch('/api/schwab/credentials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.ok) { addAlert('system', '💾 Schwab credentials saved'); loadSchwabStatus(); }
    } catch (e) { alert('Failed: ' + e.message); }
  }

  function connectSchwab() {
    window.open('/auth/schwab', '_blank', 'width=600,height=700');
    // Poll for auth completion
    const poll = setInterval(async () => {
      const r = await fetch('/api/schwab/status').catch(() => null);
      if (!r) return;
      const s = await r.json();
      if (s.status === 'connected') { clearInterval(poll); loadSchwabStatus(); addAlert('system', '✅ Schwab connected!'); }
    }, 3000);
    setTimeout(() => clearInterval(poll), 120_000); // 2 min timeout
  }

  async function refreshSchwabToken() {
    try {
      const r = await fetch('/api/schwab/refresh-token', { method: 'POST' });
      const d = await r.json();
      if (d.ok) { loadSchwabStatus(); addAlert('system', '🔄 Schwab token refreshed'); }
      else alert('Refresh failed: ' + d.error);
    } catch (e) { alert('Failed: ' + e.message); }
  }

  async function disconnectSchwab() {
    if (!confirm('Disconnect Schwab and clear stored tokens?')) return;
    await fetch('/api/schwab/disconnect', { method: 'POST' });
    loadSchwabStatus();
    $('schwabAutoSyncToggle').checked = false;
    addAlert('system', 'Schwab disconnected');
  }

  async function toggleSchwabAutoSync(enabled) {
    try {
      await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schwabAutoSync: enabled }),
      });
      const syncBadge = $('schwabSyncBadge');
      if (syncBadge) syncBadge.classList.toggle('show', enabled);
      $('schwabSyncResult').textContent = enabled ? 'Auto-sync active — syncing every 60s' : 'Auto-sync disabled';
      if (enabled) {
        // Trigger immediate sync
        triggerSchwabSync();
      }
    } catch (e) { alert('Failed: ' + e.message); }
  }

  async function triggerSchwabSync() {
    const result = $('schwabSyncResult');
    if (result) result.textContent = '⏳ Syncing...';
    try {
      const r = await fetch('/api/schwab/sync', { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        if (result) result.textContent = `✓ Synced: ${d.imported} new, ${d.skipped} already present`;
        if (d.imported > 0) { await loadJournalTrades(); renderJournalTab(); }
      } else {
        if (result) result.textContent = `✗ ${d.error}`;
      }
    } catch (e) {
      if (result) result.textContent = `✗ ${e.message}`;
    }
  }

  // Listen for Schwab SSE status updates (syncing / synced / error)
  function connectSchwabSSE() {
    try {
      const es = new EventSource('/api/schwab/stream');
      es.addEventListener('message', e => {
        const d = JSON.parse(e.data);
        const badge = $('schwabSyncBadge');
        if (!badge) return;
        if (d.status === 'syncing') { badge.textContent = 'SYNCING…'; badge.classList.add('syncing'); }
        else if (d.status === 'synced') {
          badge.textContent = 'SYNCED ✓'; badge.classList.remove('syncing');
          setTimeout(() => { badge.textContent = 'SCHWAB'; }, 3000);
          // Reload journal if on journal tab
          if (document.querySelector('.tab[data-panel="journal"]')?.classList.contains('active')) {
            loadJournalTrades().then(renderJournalTab);
          }
        } else if (d.status === 'error') {
          badge.textContent = 'SYNC ERR'; badge.classList.remove('syncing');
        }
      });
    } catch {}
  }

  // Wire Settings tab activation
  document.querySelectorAll('.tab[data-panel="settings"]').forEach(btn => {
    btn.addEventListener('click', () => {
      loadSettings();
      loadSchwabStatus();
    });
  });


  // ── Keyboard tab shortcuts (1-6) ─────────────────────────────
  document.addEventListener('keydown', e => {
    // Ignore when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    const panels = ['gap', 'momentum', 'reversal', 'news', 'journal', 'settings', 'mike', 'entry-guide'];
    const n = parseInt(e.key);
    if (n >= 1 && n <= 8) {
      const btn = document.querySelector(`.tab[data-panel="${panels[n-1]}"]`);
      if (btn) btn.click();
    }
  });

  // ── News ticker update ────────────────────────────────────────
  function updateNewsTicker(newsItems) {
    const inner = $('newsTickerInner');
    if (!inner || !newsItems || newsItems.length === 0) return;
    inner.innerHTML = newsItems.slice(0, 20).map(n => {
      const t = n.ticker ? `<span class="nt-ticker">${n.ticker}</span><span class="nt-sep">//</span>` : '';
      const h = (n.title || n.headline || '').substring(0, 100);
      return `<span class="news-ticker-item">${t}<span>${h}</span></span>`;
    }).join('');
  }

  // ── Boot ─────────────────────────────────────────────────────
  requestNotifPermission();
  checkAutoShowChecklist();
  connectSSE();
  connectSchwabSSE();

  // Show app shell after 3s even if no data yet (avoid blank screen)
  setTimeout(() => {
    if ($('loading').style.display !== 'none') {
      pollFallback();
    }
  }, 3000);

  // ── Entry Guide ──────────────────────────────────────────────
  let egActiveIdx = 0;

  const EG_SETUPS = [
    {
      id: 'first-pullback',
      name: 'Gap & Go: First Pullback',
      tier: 'TIER 1', tierClass: 'tier1',
      description: 'The most common and safest gap & go entry. Stock gaps up on news, surges at the open, pulls back for 2+ candles, then the first candle to make a new high is your entry.',
      rules: [
        { icon: '▶', text: 'Entry: First 5-min candle to make a new high after 2+ red pullback candles' },
        { icon: '▶', text: 'Stop: Below the low of the pullback (or last red candle)' },
        { icon: '▶', text: 'Target: 2:1 reward-to-risk minimum — nearest half/whole dollar' },
        { icon: '▶', text: 'Exit: First red candle after entry, or if not green within 1-2 min' },
        { icon: '▶', text: 'Pullback should NOT retrace more than 50% of the initial move' },
        { icon: '▶', text: 'Perfect pullback taps the 9 EMA on the 5-min chart' },
      ],
      candles: [
        { o:3.20,h:3.85,l:3.15,c:3.80,vol:9,  label:null },
        { o:3.80,h:4.50,l:3.75,c:4.45,vol:18, label:'Gap up surge' },
        { o:4.45,h:4.90,l:4.40,c:4.85,vol:15, label:null },
        { o:4.85,h:5.10,l:4.80,c:4.95,vol:12, label:'High of move' },
        { o:4.95,h:5.00,l:4.55,c:4.60,vol:8,  label:'Pullback begins' },
        { o:4.60,h:4.65,l:4.35,c:4.40,vol:6,  label:'Taps 9 EMA' },
        { o:4.40,h:4.75,l:4.38,c:4.70,vol:14, label:null },
        { o:4.70,h:5.25,l:4.68,c:5.20,vol:20, label:null },
        { o:5.20,h:5.55,l:5.10,c:5.50,vol:16, label:'Target hit' },
      ],
      annotations: [
        { candle:6, type:'entry', label:'ENTRY',  sublabel:'1st candle new high' },
        { candle:5, type:'stop',  label:'STOP',   sublabel:'Below pullback low' },
        { candle:8, type:'target',label:'TARGET', sublabel:'$5.50 whole dollar' },
      ],
      zones: [
        { from:4, to:5, label:'PULLBACK ZONE', color:'rgba(204,0,0,0.07)' },
        { from:6, to:8, label:'BREAKOUT',      color:'rgba(0,204,0,0.07)' },
      ],
      emaLine: [3.20,3.45,3.80,4.15,4.40,4.42,4.45,4.60,4.85],
      vwapLine: null, abcdPoints: null, levelLines: null,
    },
    {
      id: 'abcd-pattern',
      name: 'ABCD Pattern',
      tier: 'TIER 2', tierClass: 'tier2',
      description: 'A continuation pattern where the stock surges (A→B), pulls back (B→C) without breaking below A, then sets up for a second leg (C→D). Entry is at the break of point B on the second attempt.',
      rules: [
        { icon: '▶', text: 'Entry: Break of point B (the high before first pullback) on the second leg up' },
        { icon: '▶', text: 'Stop: Below point C (the second pullback low) — must hold above A' },
        { icon: '▶', text: 'Target: D point = measured move (B-A distance added to C)' },
        { icon: '▶', text: '1-min ABCD inside a 5-min bull flag = multi-timeframe alignment' },
        { icon: '▶', text: 'The pullback to C should NOT go lower than A' },
        { icon: '▶', text: 'Volume should increase on the breakout through B' },
      ],
      candles: [
        { o:5.00,h:5.30,l:4.95,c:5.25,vol:10, label:'A' },
        { o:5.25,h:5.80,l:5.20,c:5.75,vol:16, label:null },
        { o:5.75,h:6.30,l:5.70,c:6.25,vol:18, label:'B' },
        { o:6.25,h:6.30,l:5.85,c:5.90,vol:8,  label:null },
        { o:5.90,h:5.95,l:5.60,c:5.65,vol:6,  label:'C' },
        { o:5.65,h:5.95,l:5.60,c:5.90,vol:9,  label:null },
        { o:5.90,h:6.20,l:5.85,c:6.15,vol:12, label:null },
        { o:6.15,h:6.45,l:6.10,c:6.40,vol:19, label:null },
        { o:6.40,h:6.95,l:6.35,c:6.90,vol:22, label:'D' },
      ],
      annotations: [
        { candle:7, type:'entry', label:'ENTRY',  sublabel:'Break of B ($6.25)' },
        { candle:4, type:'stop',  label:'STOP',   sublabel:'Below C ($5.55)' },
        { candle:8, type:'target',label:'TARGET', sublabel:'D = $6.90' },
      ],
      zones: [
        { from:3, to:5, label:'CONSOLIDATION', color:'rgba(204,0,0,0.07)' },
        { from:7, to:8, label:'BREAKOUT LEG',  color:'rgba(0,204,0,0.07)' },
      ],
      emaLine: [5.00,5.10,5.35,5.55,5.58,5.60,5.68,5.80,6.00],
      vwapLine: null,
      abcdPoints: [
        { candle:0, price:5.00, label:'A' },
        { candle:2, price:6.30, label:'B' },
        { candle:4, price:5.60, label:'C' },
        { candle:8, price:6.90, label:'D' },
      ],
      levelLines: null,
    },
    {
      id: 'vwap-breakout',
      name: 'Break of VWAP',
      tier: 'TIER 2', tierClass: 'tier2',
      description: 'Stock gaps up, sells off early below VWAP, then buyers step in and push it back through. Safest entry is the first 1-min pullback ABOVE VWAP after the break, confirming it as new support.',
      rules: [
        { icon: '▶', text: 'Entry: First 1-min pullback that holds ABOVE VWAP after the break' },
        { icon: '▶', text: 'Stop: Just below VWAP — if it loses VWAP, thesis is broken' },
        { icon: '▶', text: 'Target: Retest of high of day, potential halt on low-float stocks' },
        { icon: '▶', text: 'Exponentially more powerful on floats under 5M shares' },
        { icon: '▶', text: 'Early weakness = sell-side imbalance — short sellers will fight' },
        { icon: '▶', text: 'Most trades should be green within 1-2 minutes of entry' },
      ],
      candles: [
        { o:8.50,h:8.90,l:8.40,c:8.85,vol:14, label:'Gap up' },
        { o:8.85,h:8.90,l:8.20,c:8.25,vol:12, label:'Sells off' },
        { o:8.25,h:8.30,l:7.80,c:7.85,vol:10, label:null },
        { o:7.85,h:7.95,l:7.55,c:7.60,vol:8,  label:'Below VWAP' },
        { o:7.60,h:7.90,l:7.55,c:7.85,vol:9,  label:null },
        { o:7.85,h:8.25,l:7.80,c:8.20,vol:16, label:'Breaks VWAP!' },
        { o:8.20,h:8.25,l:8.00,c:8.05,vol:7,  label:'Holds VWAP' },
        { o:8.05,h:8.55,l:8.00,c:8.50,vol:20, label:null },
        { o:8.50,h:9.10,l:8.45,c:9.05,vol:24, label:'Target!' },
      ],
      annotations: [
        { candle:7, type:'entry', label:'ENTRY',  sublabel:'Pullback holds VWAP' },
        { candle:6, type:'stop',  label:'STOP',   sublabel:'Below VWAP ($7.90)' },
        { candle:8, type:'target',label:'TARGET', sublabel:'HOD retest $9.00' },
      ],
      zones: [
        { from:1, to:4, label:'SELL-OFF',     color:'rgba(204,0,0,0.07)' },
        { from:5, to:5, label:'VWAP BREAK',   color:'rgba(255,140,0,0.10)' },
        { from:7, to:8, label:'CONTINUATION', color:'rgba(0,204,0,0.07)' },
      ],
      emaLine: null,
      vwapLine: [8.10,8.10,8.05,8.00,7.98,7.98,8.00,8.02,8.05],
      abcdPoints: null, levelLines: null,
    },
    {
      id: 'micro-pullback',
      name: 'Micro Pullback (Advanced)',
      tier: 'TIER 3', tierClass: 'tier3',
      description: 'Ultra-fast entries on parabolic stocks. As the stock surges through half/whole dollar levels, it dips for just seconds before continuing. Requires Level 2 tape reading and hot keys. NOT for beginners.',
      rules: [
        { icon: '▶', text: 'Entry: Quick dip at half dollar or whole dollar as stock surges' },
        { icon: '▶', text: 'Stop: 10-20 cents below entry (tight stop — fast in, fast out)' },
        { icon: '▶', text: 'Target: Next half/whole dollar level (10-50 cent moves)' },
        { icon: '▶', text: 'Requires hot keys and Level 2 tape reading mastery' },
        { icon: '▶', text: 'Can easily spiral into 100+ trades/day — overtrading danger' },
        { icon: '▶', text: 'Prove profitability in simulator FIRST before attempting live' },
      ],
      candles: [
        { o:4.10,h:4.45,l:4.05,c:4.40,vol:14, label:null },
        { o:4.40,h:4.65,l:4.38,c:4.55,vol:16, label:null },
        { o:4.55,h:5.05,l:4.50,c:5.00,vol:22, label:'$5 whole dollar' },
        { o:5.00,h:5.10,l:4.85,c:4.90,vol:10, label:'Micro dip!' },
        { o:4.90,h:5.25,l:4.88,c:5.20,vol:18, label:null },
        { o:5.20,h:5.55,l:5.18,c:5.50,vol:24, label:'$5.50 half dollar' },
        { o:5.50,h:5.60,l:5.35,c:5.40,vol:11, label:'Another micro dip' },
        { o:5.40,h:5.80,l:5.38,c:5.75,vol:19, label:null },
        { o:5.75,h:6.10,l:5.70,c:6.05,vol:26, label:'$6 whole dollar!' },
      ],
      annotations: [
        { candle:4, type:'entry', label:'ENTRY 1', sublabel:'Dip off $5.00' },
        { candle:3, type:'stop',  label:'STOP',    sublabel:'$4.80 (20c stop)' },
        { candle:5, type:'target',label:'TARGET 1',sublabel:'$5.50 half dollar' },
      ],
      zones: [
        { from:2, to:4, label:'$5 LEVEL',   color:'rgba(255,140,0,0.09)' },
        { from:5, to:7, label:'$5.50 LEVEL',color:'rgba(255,140,0,0.09)' },
      ],
      emaLine: null, vwapLine: null, abcdPoints: null,
      levelLines: [5.00, 5.50, 6.00],
    },
  ];

  function egBuildChart(setup) {
    const { candles, annotations, zones, emaLine, vwapLine, abcdPoints, levelLines } = setup;
    const W = 660, H = 330;
    const padL = 52, padR = 22, padT = 38, padB = 44;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    let allPrices = candles.flatMap(c => [c.h, c.l]);
    if (emaLine)  allPrices.push(...emaLine);
    if (vwapLine) allPrices.push(...vwapLine);
    const minP = Math.min(...allPrices) - 0.15;
    const maxP = Math.max(...allPrices) + 0.25;
    const priceRange = maxP - minP;
    const maxVol = Math.max(...candles.map(c => c.vol));

    const toX = i  => padL + (i + 0.5) * (chartW / candles.length);
    const toY = p  => padT + (1 - (p - minP) / priceRange) * chartH;
    const cw  = Math.min(24, (chartW / candles.length) * 0.54);

    const step = priceRange > 3 ? 0.50 : priceRange > 1.5 ? 0.25 : 0.20;
    const gridLines = [];
    for (let p = Math.ceil(minP / step) * step; p <= maxP + 0.001; p = Math.round((p + step) * 1000) / 1000) {
      gridLines.push(p);
    }

    let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block">`;
    s += `<rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}" fill="#070707"/>`;

    // Grid
    gridLines.forEach(p => {
      const y = toY(p).toFixed(1);
      s += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#181818" stroke-width="0.5"/>`;
      s += `<text x="${padL-4}" y="${(+y+3).toFixed(0)}" text-anchor="end" fill="#3a3a3a" font-size="9" font-family="Consolas,monospace">$${p.toFixed(2)}</text>`;
    });

    // Zones
    if (zones) zones.forEach(z => {
      const x1 = toX(z.from) - cw;
      const x2 = toX(z.to) + cw;
      s += `<rect x="${x1.toFixed(1)}" y="${padT}" width="${(x2-x1).toFixed(1)}" height="${chartH}" fill="${z.color}"/>`;
      s += `<text x="${((x1+x2)/2).toFixed(1)}" y="${padT+11}" text-anchor="middle" fill="#3a3a3a" font-size="7.5" font-weight="bold" font-family="Consolas,monospace" letter-spacing="1">${z.label}</text>`;
    });

    // Level lines
    if (levelLines) levelLines.forEach(p => {
      const y = toY(p).toFixed(1);
      s += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#ff8c00" stroke-width="1" stroke-dasharray="6,3" opacity="0.55"/>`;
      s += `<text x="${(W-padR-4)}" y="${(+y-4).toFixed(0)}" text-anchor="end" fill="#ff8c00" font-size="9" font-weight="bold" font-family="Consolas,monospace">$${p.toFixed(2)}</text>`;
    });

    // EMA
    if (emaLine) {
      const pts = emaLine.map((p, i) => `${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(' ');
      s += `<polyline points="${pts}" fill="none" stroke="#ff8c00" stroke-width="1.5" stroke-dasharray="4,2" opacity="0.65"/>`;
      const li = emaLine.length - 1;
      s += `<text x="${(toX(li)+5).toFixed(0)}" y="${toY(emaLine[li]).toFixed(0)}" fill="#ff8c00" font-size="8" font-family="Consolas,monospace">9 EMA</text>`;
    }

    // VWAP
    if (vwapLine) {
      const pts = vwapLine.map((p, i) => `${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(' ');
      s += `<polyline points="${pts}" fill="none" stroke="#ffcc00" stroke-width="2" stroke-dasharray="6,3" opacity="0.75"/>`;
      s += `<text x="${(toX(0)+4).toFixed(0)}" y="${(toY(vwapLine[0])-6).toFixed(0)}" fill="#ffcc00" font-size="8.5" font-weight="bold" font-family="Consolas,monospace">VWAP</text>`;
    }

    // ABCD
    if (abcdPoints) {
      const pts = abcdPoints.map(p => `${toX(p.candle).toFixed(1)},${toY(p.price).toFixed(1)}`).join(' ');
      s += `<polyline points="${pts}" fill="none" stroke="#cc0000" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.45"/>`;
      abcdPoints.forEach(p => {
        const cx = toX(p.candle).toFixed(1);
        const cy = toY(p.price).toFixed(1);
        const isLow = p.label === 'A' || p.label === 'C';
        s += `<circle cx="${cx}" cy="${cy}" r="9" fill="#cc0000" opacity="0.15"/>`;
        s += `<text x="${cx}" y="${(+cy + (isLow ? 16 : -9)).toFixed(0)}" text-anchor="middle" fill="#cc4444" font-size="13" font-weight="bold" font-family="Consolas,monospace">${p.label}</text>`;
      });
    }

    // Candles + volume bars
    candles.forEach((c, i) => {
      const x  = toX(i);
      const isG = c.c >= c.o;
      const col = isG ? '#00cc00' : '#cc0000';
      const volCol = isG ? 'rgba(0,204,0,0.22)' : 'rgba(204,0,0,0.22)';
      const bodyTop = toY(Math.max(c.o, c.c));
      const bodyBot = toY(Math.min(c.o, c.c));
      const bh = Math.max(bodyBot - bodyTop, 1);
      const vh = (c.vol / maxVol) * 26;
      const volY = H - padB + 4 - vh;

      s += `<rect x="${(x - cw*0.6).toFixed(1)}" y="${volY.toFixed(1)}" width="${(cw*1.2).toFixed(1)}" height="${vh.toFixed(1)}" fill="${volCol}"/>`;
      s += `<line x1="${x.toFixed(1)}" y1="${toY(c.h).toFixed(1)}" x2="${x.toFixed(1)}" y2="${toY(c.l).toFixed(1)}" stroke="${col}" stroke-width="1.5"/>`;
      s += `<rect x="${(x - cw/2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${cw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}"/>`;
      if (c.label) {
        s += `<text x="${x.toFixed(1)}" y="${(toY(c.h)-7).toFixed(0)}" text-anchor="middle" fill="#666" font-size="7.5" font-family="Consolas,monospace">${c.label}</text>`;
      }
    });

    // Annotations
    const annColors = { entry:'#00cc00', stop:'#cc0000', target:'#ff8c00' };
    annotations.forEach(a => {
      const x = toX(a.candle);
      const c = candles[a.candle];
      const col = annColors[a.type];
      const isStop = a.type === 'stop';
      const lineY = isStop ? toY(c.l) : toY(c.h);
      const boxY  = isStop ? lineY + 10 : lineY - 33;
      s += `<line x1="${(x-26).toFixed(1)}" y1="${lineY.toFixed(1)}" x2="${(x+26).toFixed(1)}" y2="${lineY.toFixed(1)}" stroke="${col}" stroke-width="1.5" stroke-dasharray="3,2"/>`;
      s += `<rect x="${(x-35).toFixed(1)}" y="${boxY.toFixed(1)}" width="70" height="25" fill="${col}"/>`;
      s += `<text x="${x.toFixed(1)}" y="${(boxY+10).toFixed(0)}" text-anchor="middle" fill="#000" font-size="9" font-weight="bold" font-family="Consolas,monospace">${a.label}</text>`;
      s += `<text x="${x.toFixed(1)}" y="${(boxY+21).toFixed(0)}" text-anchor="middle" fill="rgba(0,0,0,0.75)" font-size="7" font-family="Consolas,monospace">${a.sublabel}</text>`;
    });

    s += `<text x="${padL+4}" y="${H-5}" fill="#2a2a2a" font-size="8" font-family="Consolas,monospace">VOL bars at bottom  |  simulated candle data</text>`;
    s += `</svg>`;
    return s;
  }

  function renderEntryGuide(idx) {
    egActiveIdx = idx;
    const container = document.getElementById('entryGuideContainer');
    if (!container) { console.error('EG: container not found'); return; }
    if (typeof EG_SETUPS === 'undefined') { container.innerHTML = '<div style="color:#cc0000;padding:16px">EG_SETUPS not defined</div>'; return; }
    const setup = EG_SETUPS[idx];
    const tc = setup.tierClass;

    // Selector buttons
    const btns = EG_SETUPS.map((s, i) => {
      const cls = `eg-setup-btn ${s.tierClass}` + (i === idx ? ' active' : '');
      return `<button class="${cls}" onclick="renderEntryGuide(${i})"><span class="eg-tier-lbl">${s.tier}</span>${s.name.split(':')[0].trim()}</button>`;
    }).join('');

    // Legend items
    const legendItems = [
      { color: '#00cc00', label: 'Green candle (close > open)' },
      { color: '#cc0000', label: 'Red candle (close < open)' },
      ...(setup.vwapLine ? [{ color: '#ffcc00', label: 'VWAP' }] : []),
      ...(setup.emaLine  ? [{ color: '#ff8c00', label: '9 EMA' }] : []),
      ...(setup.levelLines ? [{ color: '#ff8c00', label: 'Key levels' }] : []),
    ].map(item =>
      `<div class="eg-legend-item"><div class="eg-legend-dot" style="background:${item.color}"></div><span class="eg-legend-lbl">${item.label}</span></div>`
    ).join('');

    // Rules
    const iconMap = ['[E]', '[S]', '[$]'];
    const rules = setup.rules.map((r, i) =>
      `<div class="eg-rule-row"><span class="eg-rule-icon">${iconMap[i] || '[+]'}</span><span class="eg-rule-text">${r.text}</span></div>`
    ).join('');

    // Warning (micro pullback only)
    const warn = setup.id === 'micro-pullback' ? `
      <div class="eg-warn">
        <span class="eg-warn-icon">[!]</span>
        <span class="eg-warn-text">Do NOT attempt this setup with real money until you've proven consistent profitability in a simulator. This is where overtrading and blown accounts happen.</span>
      </div>` : '';

    container.innerHTML = `
      <div class="eg-setup-btns">${btns}</div>
      <div class="eg-card">
        <div class="eg-card-header">
          <span class="eg-tier-badge ${tc}">${setup.tier}</span>
          <span class="eg-card-title">${setup.name}</span>
        </div>
        <div class="eg-desc">${setup.description}</div>
        <div class="eg-chart-wrap">${egBuildChart(setup)}</div>
        <div class="eg-legend">${legendItems}</div>
      </div>
      <div class="eg-rules">
        <div class="eg-rules-title">RULES FOR THIS SETUP</div>
        ${rules}
        ${warn}
      </div>
      <div class="eg-quote">
        <span class="eg-quote-text">"The best trades work INSTANTLY. The worst ones fail instantly. Breakout or bailout."</span>
      </div>
    `;
  }