// Short sound effects (WebAudio). The game never talks: these and the
// animation are all its feedback. Kept under a second and soft, so the mic
// (open the whole time) has little to hear. play(name, pan) places a sound
// left (-1) or right (+1): the meow comes from the side the cat hides on.

let ctx = null;
let out = null;
let muted = false;
let dest = null; // where sounds connect: `out`, or a stereo panner in front of it
let meowBuf = null; // decoded meow.mp3, or null: the synth meow stands in
let meowLoading = false;

// The meow is a recording (CC0, see games/casa/CREDITS.md). Written this way
// so Vite emits it with a hashed name.
const MEOW_URL = new URL('./meow.mp3', import.meta.url);

// Decoded only after the start tap has created the context, so iOS plays it.
function loadMeow() {
  if (meowLoading || !ctx) return;
  meowLoading = true;
  fetch(MEOW_URL)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`meow.mp3 ${r.status}`))))
    // callback form: older Safari's decodeAudioData returns no promise
    .then((data) => new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail)))
    .then((buf) => {
      meowBuf = buf;
      document.body.dataset.meow = 'sample';
    })
    .catch(() => (document.body.dataset.meow = 'synth')); // the synth meow stays
}

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
  loadMeow();
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
  node.connect(g).connect(dest);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise({ at = 0, dur = 0.4, vol = 0.4, filter }) {
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
  g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t0);
}

const notes = (list, { type = 'sine', gap = 0.14, dur = 0.6, vol = 0.35, at = 0 } = {}) =>
  list.forEach((f, i) => voice({ type, at: at + i * gap, dur, freq: [[0, f]], vol }));

function sample(buf, { at = 0, vol = 1, rate = 1 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(g).connect(dest);
  src.start(ctx.currentTime + at);
}

// Old Safari has no StereoPannerNode: then the sound stays in the middle.
function panner(pan) {
  if (!pan || !ctx.createStereoPanner) return out;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(out);
  return p;
}

const SOUNDS = {
  meow() {
    if (meowBuf) return sample(meowBuf, { vol: 1.3, rate: 0.96 + Math.random() * 0.1 });
    voice({ type: 'sawtooth', dur: 0.7, attack: 0.06, freq: [[0, 520], [0.25, 820], [0.65, 480]], vol: 0.25, filter: { freq: [[0, 900], [0.3, 1800], [0.65, 900]], q: 3 } });
  },
  purr() {
    for (let i = 0; i < 5; i++) noise({ at: i * 0.16, dur: 0.15, vol: 0.18, filter: { type: 'lowpass', freq: [[0, 220]], q: 2 } });
  },
  click() {
    voice({ type: 'square', dur: 0.05, freq: [[0, 1800]], vol: 0.12, filter: { type: 'highpass', freq: [[0, 1200]] } });
  },
  light() {
    SOUNDS.click();
    notes([523, 659, 784], { at: 0.12, type: 'triangle', gap: 0.07, dur: 0.4, vol: 0.18 });
  },
  flicker() {
    [0, 0.25, 0.5, 0.75].forEach((at) => voice({ type: 'square', at, dur: 0.05, freq: [[0, 1800]], vol: 0.1, filter: { type: 'highpass', freq: [[0, 1200]] } }));
    voice({ type: 'sawtooth', dur: 0.9, freq: [[0, 110]], vol: 0.05, filter: { type: 'lowpass', freq: [[0, 600]] } });
  },
  creak() {
    voice({ type: 'sawtooth', dur: 0.7, attack: 0.08, freq: [[0, 180], [0.35, 260], [0.68, 150]], vol: 0.18, filter: { freq: [[0, 900], [0.7, 1400]], q: 8 } });
  },
  swish() {
    noise({ dur: 0.5, vol: 0.3, filter: { freq: [[0, 900], [0.5, 3000]], q: 0.8 } });
  },
  slide() {
    noise({ dur: 0.45, vol: 0.25, filter: { type: 'lowpass', freq: [[0, 400], [0.45, 900]], q: 1 } });
  },
  pop() {
    voice({ type: 'sine', dur: 0.18, freq: [[0, 300], [0.15, 900]], vol: 0.35 });
  },
  boing() {
    voice({ type: 'triangle', dur: 0.4, freq: [[0, 220], [0.18, 620], [0.38, 300]], vol: 0.45 });
  },
  squeak() {
    [0, 0.14, 0.28].forEach((at) => voice({ type: 'sine', at, dur: 0.08, freq: [[0, 2400], [0.07, 3200]], vol: 0.15 }));
  },
  quack() {
    [0, 0.22].forEach((at) => voice({ type: 'sawtooth', at, dur: 0.16, freq: [[0, 600], [0.15, 420]], vol: 0.18, filter: { freq: [[0, 1200]], q: 4 } }));
  },
  steps() {
    for (let i = 0; i < 6; i++) voice({ type: 'triangle', at: i * 0.13, dur: 0.05, freq: [[0, i % 2 ? 420 : 480]], vol: 0.18 });
  },
  party() {
    notes([523, 659, 784, 1046, 1318], { type: 'triangle', gap: 0.12, dur: 0.6, vol: 0.28 });
    notes([1568, 2093, 1568, 2093], { at: 0.7, gap: 0.08, dur: 0.3, vol: 0.12 });
  },
};

export function play(name, pan = 0) {
  if (muted || !ctx || !SOUNDS[name]) return;
  try {
    dest = panner(pan);
    SOUNDS[name]();
  } catch {
    // a missing WebAudio feature should never break the game
  } finally {
    dest = out;
  }
}
