export const sortState: Record<string, { col: string; dir: number }> = {
  up:             { col: 'gapPercent',      dir: -1 },
  down:           { col: 'gapPercent',      dir: -1 },
  mom:            { col: 'changePercent',   dir: -1 },
  rev:            { col: 'rsi2',            dir: -1 },
  news:           { col: 'publishedUtc',    dir: -1 },
  'mike-long':    { col: 'convictionScore', dir: -1 },
  'mike-short':   { col: 'convictionScore', dir: -1 },
  'hod-small':    { col: 'distanceFromHigh', dir:  1 },
  'hod-mid':      { col: 'distanceFromHigh', dir:  1 },
  'hod-penny':    { col: 'distanceFromHigh', dir:  1 },
  penny:          { col: 'changePercent',   dir: -1 },
  'top-gap':      { col: 'gapPercent',      dir: -1 },
  'top-rvol':     { col: 'relativeVolume',  dir: -1 },
  'top-after':    { col: 'changePercent',   dir: -1 },
  earnings:       { col: 'gapPercent',      dir: -1 },
  vol:            { col: 'atrExpansion',    dir: -1 },
  pillar:         { col: 'pillarScore',     dir: -1 },
};

export const reRenderRegistry: Record<string, () => void> = {};

export function sortRows<T extends Record<string, unknown>>(rows: T[], col: string, dir: number): T[] {
  return [...rows].sort((a, b) => {
    const av = a[col], bv = b[col];
    if (av == null) return 1; if (bv == null) return -1;
    if (typeof av === 'boolean') return dir * ((av ? 1 : 0) - ((bv as boolean) ? 1 : 0));
    if (typeof av === 'string')  return dir * (av as string).localeCompare(bv as string);
    return dir * ((av as number) - (bv as number));
  });
}

export function th(id: string, col: string, label: string, align?: string): string {
  const s = sortState[id] ?? { col: '', dir: -1 };
  const active = s.col === col;
  const ind = active ? `<span class="sort-ind">${s.dir === -1 ? '▼' : '▲'}</span>` : '<span class="sort-hint">⇅</span>';
  const cls = (align === 'left' ? 'left ' : '') + (active ? 'sorted' : '');
  return `<th class="${cls}" onclick="sortTable('${id}','${col}')">${label}${ind}</th>`;
}

export function sortTable(id: string, col: string): void {
  const s = sortState[id];
  if (!s) return;
  if (s.col === col) s.dir *= -1; else { s.col = col; s.dir = -1; }
  reRenderRegistry[id]?.();
}

(window as unknown as Record<string, unknown>).sortTable = sortTable;
