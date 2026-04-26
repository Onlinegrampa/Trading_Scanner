export const fmt2      = (n: number) => n.toFixed(2);
export const fmtSign   = (n: number) => (n >= 0 ? '+' : '') + fmt2(n) + '%';
export const fmtPrice  = (n: number) => '$' + fmt2(n);
export const fmtRelVol = (n: number) => n.toFixed(1) + 'x';
export const fmtMulti  = (n: number) => n.toFixed(2) + 'x';

export function fmtVol(v: number): string {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return v.toString();
}

export function fmtFloat(f: number | null | undefined): string {
  if (f == null) return '—';
  if (f >= 1e9)  return (f / 1e9).toFixed(1) + 'B';
  if (f >= 1e6)  return (f / 1e6).toFixed(1) + 'M';
  return (f / 1e3).toFixed(0) + 'K';
}

export function gapClass(pct: number, dir: 'UP' | 'DOWN'): string {
  const a = Math.abs(pct);
  const prefix = dir === 'UP' ? 'gap-up-' : 'gap-dn-';
  if (a >= 50) return prefix + '5';
  if (a >= 30) return prefix + '4';
  if (a >= 20) return prefix + '3';
  if (a >= 10) return prefix + '2';
  return prefix + '1';
}

export function volClass(rv: number): string {
  if (rv >= 10) return 'vol-high';
  if (rv >= 3)  return 'vol-med';
  return 'vol-low';
}

export function qualityColor(score: number): string {
  if (score >= 80) return '#00ff88';
  if (score >= 65) return '#00e676';
  if (score >= 50) return '#ffd600';
  if (score >= 35) return '#ff6d00';
  return '#444444';
}

export function qualityClass(score: number): string {
  if (score >= 80) return 'q-a-plus';
  if (score >= 65) return 'q-a';
  if (score >= 50) return 'q-b';
  if (score >= 35) return 'q-c';
  return 'q-d';
}

export function floatClass(f: number | null): string {
  return f !== null && f < 10e6 ? 'float-low' : 'float-norm';
}
