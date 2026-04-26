interface Candle { o: number; h: number; l: number; c: number; vol: number; label: string | null; }
interface Annotation { candle: number; type: 'entry' | 'stop' | 'target'; label: string; sublabel: string; }
interface Zone { from: number; to: number; label: string; color: string; }
interface AbcdPoint { candle: number; price: number; label: string; }

interface EgSetup {
  id: string; name: string; tier: string; tierClass: string; description: string;
  rules: Array<{ icon: string; text: string }>;
  candles: Candle[]; annotations: Annotation[]; zones: Zone[];
  emaLine: number[] | null; vwapLine: number[] | null;
  abcdPoints: AbcdPoint[] | null; levelLines: number[] | null;
}

let egActiveIdx = 0;

const EG_SETUPS: EgSetup[] = [
  {
    id: 'first-pullback', name: 'Gap & Go: First Pullback', tier: 'TIER 1', tierClass: 'tier1',
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
    id: 'abcd-pattern', name: 'ABCD Pattern', tier: 'TIER 2', tierClass: 'tier2',
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
      { candle:0, price:5.00, label:'A' }, { candle:2, price:6.30, label:'B' },
      { candle:4, price:5.60, label:'C' }, { candle:8, price:6.90, label:'D' },
    ],
    levelLines: null,
  },
  {
    id: 'vwap-breakout', name: 'Break of VWAP', tier: 'TIER 2', tierClass: 'tier2',
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
    id: 'micro-pullback', name: 'Micro Pullback (Advanced)', tier: 'TIER 3', tierClass: 'tier3',
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
      { from:2, to:4, label:'$5 LEVEL',    color:'rgba(255,140,0,0.09)' },
      { from:5, to:7, label:'$5.50 LEVEL', color:'rgba(255,140,0,0.09)' },
    ],
    emaLine: null, vwapLine: null, abcdPoints: null,
    levelLines: [5.00, 5.50, 6.00],
  },
];

function buildChart(setup: EgSetup): string {
  const { candles, annotations, zones, emaLine, vwapLine, abcdPoints, levelLines } = setup;
  const W = 660, H = 330;
  const padL = 52, padR = 22, padT = 38, padB = 44;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const allPrices = candles.flatMap(c => [c.h, c.l]);
  if (emaLine)  allPrices.push(...emaLine);
  if (vwapLine) allPrices.push(...vwapLine);
  const minP = Math.min(...allPrices) - 0.15;
  const maxP = Math.max(...allPrices) + 0.25;
  const priceRange = maxP - minP;
  const maxVol = Math.max(...candles.map(c => c.vol));

  const toX = (i: number)  => padL + (i + 0.5) * (chartW / candles.length);
  const toY = (p: number)  => padT + (1 - (p - minP) / priceRange) * chartH;
  const cw  = Math.min(24, (chartW / candles.length) * 0.54);

  const step = priceRange > 3 ? 0.50 : priceRange > 1.5 ? 0.25 : 0.20;
  const gridLines: number[] = [];
  for (let p = Math.ceil(minP / step) * step; p <= maxP + 0.001; p = Math.round((p + step) * 1000) / 1000) {
    gridLines.push(p);
  }

  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block">`;
  s += `<rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}" fill="#070707"/>`;

  gridLines.forEach(p => {
    const y = toY(p).toFixed(1);
    s += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#181818" stroke-width="0.5"/>`;
    s += `<text x="${padL-4}" y="${(+y+3).toFixed(0)}" text-anchor="end" fill="#3a3a3a" font-size="9" font-family="Consolas,monospace">$${p.toFixed(2)}</text>`;
  });

  if (zones) zones.forEach(z => {
    const x1 = toX(z.from) - cw, x2 = toX(z.to) + cw;
    s += `<rect x="${x1.toFixed(1)}" y="${padT}" width="${(x2-x1).toFixed(1)}" height="${chartH}" fill="${z.color}"/>`;
    s += `<text x="${((x1+x2)/2).toFixed(1)}" y="${padT+11}" text-anchor="middle" fill="#3a3a3a" font-size="7.5" font-weight="bold" font-family="Consolas,monospace" letter-spacing="1">${z.label}</text>`;
  });

  if (levelLines) levelLines.forEach(p => {
    const y = toY(p).toFixed(1);
    s += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="#ff8c00" stroke-width="1" stroke-dasharray="6,3" opacity="0.55"/>`;
    s += `<text x="${(W-padR-4)}" y="${(+y-4).toFixed(0)}" text-anchor="end" fill="#ff8c00" font-size="9" font-weight="bold" font-family="Consolas,monospace">$${p.toFixed(2)}</text>`;
  });

  if (emaLine) {
    const pts = emaLine.map((p, i) => `${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="#ff8c00" stroke-width="1.5" stroke-dasharray="4,2" opacity="0.65"/>`;
    const li = emaLine.length - 1;
    s += `<text x="${(toX(li)+5).toFixed(0)}" y="${toY(emaLine[li]).toFixed(0)}" fill="#ff8c00" font-size="8" font-family="Consolas,monospace">9 EMA</text>`;
  }

  if (vwapLine) {
    const pts = vwapLine.map((p, i) => `${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="#ffcc00" stroke-width="2" stroke-dasharray="6,3" opacity="0.75"/>`;
    s += `<text x="${(toX(0)+4).toFixed(0)}" y="${(toY(vwapLine[0])-6).toFixed(0)}" fill="#ffcc00" font-size="8.5" font-weight="bold" font-family="Consolas,monospace">VWAP</text>`;
  }

  if (abcdPoints) {
    const pts = abcdPoints.map(p => `${toX(p.candle).toFixed(1)},${toY(p.price).toFixed(1)}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="#cc0000" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.45"/>`;
    abcdPoints.forEach(p => {
      const cx = toX(p.candle).toFixed(1), cy = toY(p.price).toFixed(1);
      const isLow = p.label === 'A' || p.label === 'C';
      s += `<circle cx="${cx}" cy="${cy}" r="9" fill="#cc0000" opacity="0.15"/>`;
      s += `<text x="${cx}" y="${(+cy + (isLow ? 16 : -9)).toFixed(0)}" text-anchor="middle" fill="#cc4444" font-size="13" font-weight="bold" font-family="Consolas,monospace">${p.label}</text>`;
    });
  }

  candles.forEach((c, i) => {
    const x = toX(i);
    const isG = c.c >= c.o;
    const col = isG ? '#00cc00' : '#cc0000';
    const volCol = isG ? 'rgba(0,204,0,0.22)' : 'rgba(204,0,0,0.22)';
    const bodyTop = toY(Math.max(c.o, c.c));
    const bodyBot = toY(Math.min(c.o, c.c));
    const bh = Math.max(bodyBot - bodyTop, 1);
    const vh = (c.vol / maxVol) * 26;
    const volY = H - padB + 4 - vh;
    s += `<rect x="${(x-cw*0.6).toFixed(1)}" y="${volY.toFixed(1)}" width="${(cw*1.2).toFixed(1)}" height="${vh.toFixed(1)}" fill="${volCol}"/>`;
    s += `<line x1="${x.toFixed(1)}" y1="${toY(c.h).toFixed(1)}" x2="${x.toFixed(1)}" y2="${toY(c.l).toFixed(1)}" stroke="${col}" stroke-width="1.5"/>`;
    s += `<rect x="${(x-cw/2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${cw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}"/>`;
    if (c.label) s += `<text x="${x.toFixed(1)}" y="${(toY(c.h)-7).toFixed(0)}" text-anchor="middle" fill="#666" font-size="7.5" font-family="Consolas,monospace">${c.label}</text>`;
  });

  const annColors: Record<string, string> = { entry:'#00cc00', stop:'#cc0000', target:'#ff8c00' };
  annotations.forEach(a => {
    const x   = toX(a.candle);
    const c   = candles[a.candle];
    const col = annColors[a.type];
    const isStop = a.type === 'stop';
    const lineY = isStop ? toY(c.l) : toY(c.h);
    const boxY  = isStop ? lineY + 10 : lineY - 33;
    s += `<line x1="${(x-26).toFixed(1)}" y1="${lineY.toFixed(1)}" x2="${(x+26).toFixed(1)}" y2="${lineY.toFixed(1)}" stroke="${col}" stroke-width="1.5" stroke-dasharray="3,2"/>`;
    s += `<rect x="${(x-35).toFixed(1)}" y="${boxY.toFixed(1)}" width="70" height="25" fill="${col}"/>`;
    s += `<text x="${x.toFixed(1)}" y="${(boxY+10).toFixed(0)}" text-anchor="middle" fill="#000" font-size="9" font-weight="bold" font-family="Consolas,monospace">${a.label}</text>`;
    s += `<text x="${x.toFixed(1)}" y="${(boxY+21).toFixed(0)}" text-anchor="middle" fill="rgba(0,0,0,0.75)" font-size="7" font-family="Consolas,monospace">${a.sublabel}</text>`;
  });

  s += `<text x="${padL+4}" y="${H-5}" fill="#2a2a2a" font-size="8" font-family="Consolas,monospace">VOL bars at bottom  |  simulated candle data</text></svg>`;
  return s;
}

export function renderEntryGuide(idx: number) {
  egActiveIdx = idx;
  const container = document.getElementById('entryGuideContainer');
  if (!container) return;
  const setup = EG_SETUPS[idx];
  if (!setup) return;

  const btns = EG_SETUPS.map((s, i) =>
    `<button class="eg-setup-btn ${s.tierClass}${i === idx ? ' active' : ''}" data-eg-idx="${i}">
      <span class="eg-tier-lbl">${s.tier}</span>${s.name.split(':')[0].trim()}</button>`
  ).join('');

  const legendItems = [
    { color: '#00cc00', label: 'Green candle (close > open)' },
    { color: '#cc0000', label: 'Red candle (close < open)' },
    ...(setup.vwapLine  ? [{ color: '#ffcc00', label: 'VWAP' }] : []),
    ...(setup.emaLine   ? [{ color: '#ff8c00', label: '9 EMA' }] : []),
    ...(setup.levelLines ? [{ color: '#ff8c00', label: 'Key levels' }] : []),
  ].map(item => `<div class="eg-legend-item"><div class="eg-legend-dot" style="background:${item.color}"></div><span class="eg-legend-lbl">${item.label}</span></div>`).join('');

  const iconMap = ['[E]', '[S]', '[$]'];
  const rules = setup.rules.map((r, i) =>
    `<div class="eg-rule-row"><span class="eg-rule-icon">${iconMap[i] || '[+]'}</span><span class="eg-rule-text">${r.text}</span></div>`
  ).join('');

  const warn = setup.id === 'micro-pullback' ? `
    <div class="eg-warn">
      <span class="eg-warn-icon">[!]</span>
      <span class="eg-warn-text">Do NOT attempt this setup with real money until you've proven consistent profitability in a simulator. This is where overtrading and blown accounts happen.</span>
    </div>` : '';

  container.innerHTML = `
    <div class="eg-setup-btns">${btns}</div>
    <div class="eg-card">
      <div class="eg-card-header">
        <span class="eg-tier-badge ${setup.tierClass}">${setup.tier}</span>
        <span class="eg-card-title">${setup.name}</span>
      </div>
      <div class="eg-desc">${setup.description}</div>
      <div class="eg-chart-wrap">${buildChart(setup)}</div>
      <div class="eg-legend">${legendItems}</div>
    </div>
    <div class="eg-rules">
      <div class="eg-rules-title">RULES FOR THIS SETUP</div>
      ${rules}${warn}
    </div>
    <div class="eg-quote">
      <span class="eg-quote-text">"The best trades work INSTANTLY. The worst ones fail instantly. Breakout or bailout."</span>
    </div>`;

  // Wire selector buttons
  container.querySelectorAll<HTMLElement>('[data-eg-idx]').forEach(btn => {
    btn.addEventListener('click', () => renderEntryGuide(parseInt(btn.dataset['egIdx']!)));
  });
}

export function getEgActiveIdx() { return egActiveIdx; }
