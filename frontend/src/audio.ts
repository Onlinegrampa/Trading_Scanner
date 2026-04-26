let _actx: AudioContext | null = null;
export let muted = false;

export function setMuted(val: boolean) { muted = val; }

function ctx(): AudioContext {
  if (!_actx) _actx = new AudioContext();
  if (_actx.state === 'suspended') _actx.resume();
  return _actx;
}

document.addEventListener('click', () => ctx(), { once: true });

function playNote(freq: number, tOffset: number, dur: number, type: OscillatorType = 'sine', vol = 0.22) {
  const c    = ctx();
  const osc  = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(c.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + tOffset);
  const t = c.currentTime + tOffset;
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export function soundGap()          { if (muted) return; playNote(880, 0, 0.15); playNote(1108, 0.12, 0.25); }
export function soundMomentum()     { if (muted) return; [880,1108,1318].forEach((f,i) => playNote(f, i*0.08, 0.20)); }
export function soundReversal()     { if (muted) return; playNote(660, 0, 0.18, 'triangle'); playNote(880, 0.15, 0.22, 'triangle'); }
export function soundNewsStrong()   { if (muted) return; [1047,1319,1568].forEach((f,i) => playNote(f, i*0.07, 0.18)); }
export function soundNewsModerate() { if (muted) return; playNote(880, 0, 0.12); playNote(1047, 0.10, 0.18); }
export function soundNewsNegative() { if (muted) return; playNote(440, 0, 0.20, 'sawtooth', 0.15); playNote(330, 0.18, 0.25, 'sawtooth', 0.12); }

// HIGH PRIORITY bell — 5-Pillar and Halt alerts
export function soundHighPriority() {
  if (muted) return;
  [1047, 1319, 1568, 2093].forEach((f, i) => playNote(f, i * 0.06, 0.22, 'sine', 0.28));
}
