// Short synthesized sound effects (WebAudio). The game never talks during play:
// these and the animation are all its feedback. The "chhhhh" whoosh is filtered
// white noise, the sound the child is asked to make.

let ctx = null;
let out = null;
let muted = false;

export function unlock() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = 0.3;
    out.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export const context = () => ctx;

export function setMuted(m) {
  muted = m;
}

function voice({ type = 'sine', at = 0, dur = 0.3, freq, vol = 0.6, attack = 0.01, filter }) {
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = type;
  freq.forEach(([t, f], i) => (i ? o.frequency.exponentialRampToValueAtTime(f, t0 + t) : o.frequency.setValueAtTime(f, t0)));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = o;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = filter.type || 'bandpass';
    f.Q.value = filter.q || 1;
    filter.freq.forEach(([t, v], i) => (i ? f.frequency.linearRampToValueAtTime(v, t0 + t) : f.frequency.setValueAtTime(v, t0)));
    o.connect(f);
    node = f;
  }
  node.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise({ at = 0, dur = 0.4, vol = 0.4, peak = 0.3, filter }) {
  const t0 = ctx.currentTime + at;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = filter.type || 'bandpass';
  f.Q.value = filter.q || 1;
  filter.freq.forEach(([t, v], i) => (i ? f.frequency.linearRampToValueAtTime(v, t0 + t) : f.frequency.setValueAtTime(v, t0)));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + dur * peak);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t0);
}

const notes = (list, { type = 'sine', gap = 0.14, dur = 0.6, vol = 0.35, at = 0 } = {}) =>
  list.forEach((f, i) => voice({ type, at: at + i * gap, dur, freq: [[0, f]], vol }));

const SOUNDS = {
  steps() {
    for (let i = 0; i < 6; i++) voice({ type: 'triangle', at: i * 0.12, dur: 0.06, freq: [[0, i % 2 ? 190 : 230]], vol: 0.3 });
  },
  // "chhhhh": a hiss that swells and fades, high-passed white noise
  whoosh() {
    noise({ dur: 1, vol: 0.55, peak: 0.25, filter: { type: 'highpass', freq: [[0, 2500], [0.5, 4200], [1, 3000]], q: 0.7 } });
    voice({ type: 'sine', dur: 0.5, freq: [[0, 300], [0.45, 900]], vol: 0.12 });
  },
  boing() {
    voice({ type: 'triangle', dur: 0.4, freq: [[0, 220], [0.18, 620], [0.38, 300]], vol: 0.45 });
  },
  superboing() {
    voice({ type: 'triangle', dur: 0.6, freq: [[0, 220], [0.3, 1100], [0.58, 400]], vol: 0.45 });
    notes([1568, 2093, 2637, 3136], { type: 'triangle', at: 0.25, gap: 0.07, dur: 0.25, vol: 0.12 });
  },
  bump() {
    voice({ type: 'square', dur: 0.18, freq: [[0, 160], [0.15, 70]], vol: 0.3, filter: { type: 'lowpass', freq: [[0, 800]] } });
  },
  brake() {
    voice({ type: 'sawtooth', dur: 0.35, freq: [[0, 900], [0.3, 500]], vol: 0.1, filter: { freq: [[0, 1400]], q: 6 } });
  },
  vroom() {
    voice({ type: 'sawtooth', dur: 0.9, attack: 0.1, freq: [[0, 70], [0.5, 130], [0.88, 90]], vol: 0.2, filter: { type: 'lowpass', freq: [[0, 500]] } });
  },
  wave() {
    notes([784, 988], { type: 'triangle', gap: 0.1, dur: 0.3, vol: 0.18 });
  },
  party() {
    notes([523, 659, 784, 1046, 1318], { type: 'triangle', gap: 0.12, dur: 0.6, vol: 0.28 });
    notes([1568, 2093, 1568, 2093], { at: 0.7, gap: 0.08, dur: 0.3, vol: 0.12 });
  },
};

export function play(name) {
  if (muted || !ctx || !SOUNDS[name]) return;
  try {
    SOUNDS[name]();
  } catch {
    // a missing WebAudio feature should never break the game
  }
}
