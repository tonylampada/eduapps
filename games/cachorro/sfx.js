// Short synthesized sound effects (WebAudio). The game never talks: these and
// the animation are all its feedback. Kept under a second and soft, so the mic
// (open the whole time) has little to hear.

let ctx = null;
let out = null;
let muted = false;
let bark = null; // decoded bark.mp3, or null: the synth woof stands in
let barkLoading = false;

// The bark is a recording (CC0, see games/cachorro/CREDITS.md). Written this
// way so Vite emits it with a hashed name.
const BARK_URL = new URL('./bark.mp3', import.meta.url);

// Decoded only after the start tap has created the context, so iOS plays it.
function loadBark() {
  if (barkLoading || !ctx) return;
  barkLoading = true;
  fetch(BARK_URL)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`bark.mp3 ${r.status}`))))
    // callback form: older Safari's decodeAudioData returns no promise
    .then((data) => new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail)))
    .then((buf) => {
      bark = buf;
      document.body.dataset.bark = 'sample';
    })
    .catch(() => (document.body.dataset.bark = 'synth')); // the synth woof stays
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
  loadBark();
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
  src.connect(f).connect(g).connect(out);
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
  src.connect(g).connect(out);
  src.start(ctx.currentTime + at);
}

const SOUNDS = {
  woof() {
    // "au au": two barks, the second a touch higher so it isn't a copy
    if (bark) return [[0, 1], [0.32, 1.06]].forEach(([at, rate]) => sample(bark, { at, rate, vol: 1.4 }));
    [0, 0.3].forEach((at) => {
      noise({ at, dur: 0.15, vol: 0.35, filter: { freq: [[0, 700], [0.15, 400]], q: 2 } });
      voice({ type: 'sawtooth', at, dur: 0.17, freq: [[0, 280], [0.15, 120]], vol: 0.3, filter: { type: 'lowpass', freq: [[0, 900]] } });
    });
  },
  boing() {
    voice({ type: 'triangle', dur: 0.4, freq: [[0, 220], [0.18, 620], [0.38, 300]], vol: 0.45 });
  },
  steps() {
    for (let i = 0; i < 6; i++) voice({ type: 'triangle', at: i * 0.13, dur: 0.06, freq: [[0, i % 2 ? 190 : 230]], vol: 0.3 });
  },
  splash() {
    noise({ dur: 0.55, vol: 0.5, filter: { freq: [[0, 2500], [0.5, 600]], q: 0.8 } });
    [0.1, 0.22, 0.36].forEach((at) => voice({ at, dur: 0.1, freq: [[0, 300], [0.09, 1100]], vol: 0.3 }));
  },
  bonk() {
    voice({ type: 'square', dur: 0.18, freq: [[0, 160], [0.15, 70]], vol: 0.3, filter: { type: 'lowpass', freq: [[0, 800]] } });
    notes([1568, 1760, 2093], { at: 0.15, gap: 0.07, dur: 0.25, vol: 0.12 });
  },
  creak() {
    voice({ type: 'sawtooth', dur: 0.7, attack: 0.08, freq: [[0, 180], [0.35, 260], [0.68, 150]], vol: 0.18, filter: { freq: [[0, 900], [0.7, 1400]], q: 8 } });
  },
  jingle() {
    notes([2637, 3136, 2637, 3520], { type: 'triangle', gap: 0.06, dur: 0.18, vol: 0.12 });
  },
  chomp() {
    [0, 0.16].forEach((at) => noise({ at, dur: 0.08, vol: 0.4, filter: { freq: [[0, 1800]], q: 1 } }));
  },
  sit() {
    voice({ type: 'sine', dur: 0.45, freq: [[0, 900], [0.42, 300]], vol: 0.3 });
  },
  lie() {
    voice({ type: 'sine', dur: 0.75, freq: [[0, 600], [0.7, 150]], vol: 0.28 });
    noise({ at: 0.35, dur: 0.4, vol: 0.12, filter: { type: 'lowpass', freq: [[0, 500]] } });
  },
  spin() {
    voice({ type: 'sine', dur: 0.7, freq: [[0, 400], [0.35, 1000], [0.68, 400]], vol: 0.25 });
  },
  zoom() {
    noise({ dur: 0.8, vol: 0.3, filter: { freq: [[0, 300], [0.4, 1500], [0.8, 400]], q: 1.5 } });
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
