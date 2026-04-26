  // ── History tab ───────────────────────────────────────────────
  // Self-contained: defines its own helpers so it doesn't rely on
  // const-scoped variables from the main inline <script> block,
  // which are not reliably accessible across separate <script src> tags
  // in all Chrome versions.

  var historyCache = [];

  function _hst$(id) { return document.getElementById(id); }
  function _hstFmt2(n) { return Number(n).toFixed(2); }
  function _hstFmtSign(n) { return (n >= 0 ? '+' : '') + _hstFmt2(n) + '%'; }
  function _hstFmtPrice(n) { return '$' + _hstFmt2(n); }
  function _hstFmtFloat(f) {
    if (f === null || f === undefined) return '—';
    if (f >= 1e9) return (f / 1e9).toFixed(1) + 'B';
    if (f >= 1e6) return (f / 1e6).toFixed(1) + 'M';
    return (f / 1e3).toFixed(0) + 'K';
  }
  function _hstFmtVol(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    if (v > 0)   return String(v);
    return '<span style="color:var(--text-dim)">—</span>';
  }
  function _hstToast(msg) {
    // Fall back to alert if main toastMsg is unavailable
    if (typeof toastMsg === 'function') toastMsg(msg);
    else alert(msg);
  }
  function _hstSetError(msg) {
    var el = _hst$('historyTableContainer');
    if (el) el.innerHTML =
      '<div style="padding:20px;color:#cc4400;font-size:12px;border:1px dashed #444">' +
      'History error: ' + msg + '</div>';
  }

  async function loadHistoryData(filter, ticker, from, to) {
    filter = filter || 'today';
    ticker = ticker || null;
    from   = from   || null;
    to     = to     || null;
    try {
      var url = '/api/history?limit=2000';
      if (filter === 'today') url += '&today=true';
      else if (from && to) url += '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
      if (ticker) url += '&ticker=' + encodeURIComponent(ticker);

      var resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      historyCache = data;
      renderHistoryTable(data);
      var badge = _hst$('historyTotalBadge');
      if (badge) badge.textContent = data.length;
    } catch (e) {
      console.error('[History] loadHistoryData failed:', e);
      _hstSetError(e.message);
    }
  }

  function renderHistoryTable(entries) {
    var container = _hst$('historyTableContainer');
    if (!container) return;

    if (!entries || entries.length === 0) {
      container.innerHTML =
        '<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:12px;' +
        'border:1px dashed var(--border);margin-bottom:16px">No scan history found for this filter.</div>';
      return;
    }

    try {
      var html = '<table class="scanner-table hist-table"><thead><tr>';
      html += '<th class="sorted left">Time</th>';
      html += '<th class="left">Ticker</th>';
      html += '<th class="left">Source</th>';
      html += '<th>Price</th>';
      html += '<th>Gap %</th>';
      html += '<th>Chg %</th>';
      html += '<th>Volume</th>';
      html += '<th>Float</th>';
      html += '<th>Dir</th>';
      html += '<th class="left">Details</th>';
      html += '</tr></thead><tbody>';

      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];

        var gapHtml = (e.gapPercent != null)
          ? '<span class="' + (e.gapPercent >= 0 ? 'chg-pos' : 'chg-neg') + '">' + _hstFmtSign(e.gapPercent) + '</span>'
          : '<span style="color:var(--text-dim)">—</span>';

        var chgHtml = (e.changePercent != null)
          ? '<span class="' + (e.changePercent >= 0 ? 'chg-pos' : 'chg-neg') + '">' + _hstFmtSign(e.changePercent) + '</span>'
          : '<span style="color:var(--text-dim)">—</span>';

        var details = [];
        if (e.qualityScore != null) details.push('Score:' + e.qualityScore);
        if (e.dailyGrade)           details.push('Grade:' + e.dailyGrade);
        if (e.triggerType)          details.push(e.triggerType);
        if (e.rsi2 != null)         details.push('RSI:' + Number(e.rsi2).toFixed(1));
        if (e.convictionScore != null) details.push('Conv:' + e.convictionScore);
        if (e.rsvsSPY != null)      details.push('RS:' + Number(e.rsvsSPY).toFixed(2));
        details.push('vwap:' + (e.vwap != null ? _hstFmtPrice(e.vwap) : '—'));

        html += '<tr>';
        html += '<td style="font-size:10px;color:var(--text-dim);white-space:nowrap">' + (e.timestamp || '—') + '</td>';
        html += '<td><span class="ticker">' + (e.ticker || '—') + '</span></td>';
        html += '<td style="color:var(--text-dim)">' + (e.source || '—') + '</td>';
        html += '<td>' + (e.price != null ? _hstFmtPrice(e.price) : '—') + '</td>';
        html += '<td>' + gapHtml + '</td>';
        html += '<td>' + chgHtml + '</td>';
        html += '<td>' + _hstFmtVol(e.volume || 0) + '</td>';
        html += '<td style="color:var(--text-dim)">' + _hstFmtFloat(e.floatShares) + '</td>';
        html += '<td style="font-size:11px">' + (e.direction || '—') + '</td>';
        html += '<td style="font-size:10px;color:var(--text-dim)">' + details.join(' | ') + '</td>';
        html += '</tr>';
      }

      html += '</tbody></table>';
      container.innerHTML = html;
    } catch (err) {
      console.error('[History] renderHistoryTable failed:', err);
      _hstSetError(err.message);
    }
  }

  async function loadHistorySummary() {
    try {
      var resp = await fetch('/api/history/summary');
      if (!resp.ok) return;
      var s = await resp.json();
      var summaryEl = _hst$('historySummary');
      if (summaryEl) {
        summaryEl.style.display = 'block';
        summaryEl.textContent =
          'TODAY: ' + s.todayTotal + ' hits | WEEK: ' + s.freq.length + ' tickers | LOG: ' +
          s.range.totalEntries + ' total (' + s.range.firstDate + ' → ' + s.range.lastDate + ')';
      }
      var badge = _hst$('tabHistoryCount');
      if (badge && s.todayTotal != null) badge.textContent = s.todayTotal;
    } catch(e) {
      console.error('[History] loadHistorySummary failed:', e);
    }
  }

  function historyFilterToday(btn) {
    document.querySelectorAll('.hist-filter').forEach(function(b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    loadHistoryData('today');
  }

  function historyFilterWeek(btn) {
    document.querySelectorAll('.hist-filter').forEach(function(b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    loadHistoryData('week');
  }

  function historyFilterAll(btn) {
    document.querySelectorAll('.hist-filter').forEach(function(b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    loadHistoryData('all', null);
  }

  function historyFilterRange() {
    var from = (_hst$('histFrom') || {}).value;
    var to   = (_hst$('histTo')   || {}).value;
    if (!from || !to) { _hstToast('Select both dates'); return; }
    document.querySelectorAll('.hist-filter').forEach(function(b) { b.classList.remove('active'); });
    loadHistoryData('range', null, from, to);
  }

  function historyFilterTicker() {
    var el = _hst$('histTickerFilter');
    var ticker = el ? el.value.trim().toUpperCase() : '';
    if (!ticker) { _hstToast('Enter a ticker'); return; }
    document.querySelectorAll('.hist-filter').forEach(function(b) { b.classList.remove('active'); });
    loadHistoryData('all', ticker);
  }

  // Refresh summary + table (when history tab active) every 35s
  setInterval(function() {
    var historyTabActive = false;
    document.querySelectorAll('.tab').forEach(function(t) {
      if (t.classList.contains('active') && t.dataset.panel === 'history') {
        historyTabActive = true;
      }
    });
    loadHistorySummary();
    if (historyTabActive) {
      var activeFilter = document.querySelector('.hist-filter.active');
      if (activeFilter) {
        var filt = activeFilter.dataset.filt;
        if (filt === 'today')     loadHistoryData('today');
        else if (filt === 'week') loadHistoryData('week');
        else                       loadHistoryData('all', null);
      }
    }
  }, 35000);

  loadHistorySummary();
  loadHistoryData('today');
