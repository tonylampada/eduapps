// Short sound effects (WebAudio): synthesized, plus one recorded bite. The game
// never talks: these and the animation are all its feedback. Kept under a second and soft, so the mic
// (open the whole time) has little to hear.

let ctx = null;
let out = null;
let muted = false;
let bite = null; // decoded bite.mp3, or null: the synth crunch stands in
let biteLoading = false;

// The bite is a recording (CC0, see games/monstro/CREDITS.md). Written this
// way so Vite emits it with a hashed name.
const BITE_URL = new URL('./bite.mp3', import.meta.url);

// Decoded only after the start tap has created the context, so iOS plays it.
function loadBite() {
  if (biteLoading || !ctx) return;
  biteLoading = true;
  fetch(BITE_URL)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`bite.mp3 ${r.status}`))))
    // callback form: older Safari's decodeAudioData returns no promise
    .then((data) => new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail)))
    .then((buf) => {
      bite = buf;
      document.body.dataset.bite = 'sample';
    })
    .catch(() => (document.body.dataset.bite = 'synth')); // the synth crunch stays
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
  loadBite();
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
  // food flying off the plate
  whoosh() {
    noise({ dur: 0.4, vol: 0.22, filter: { freq: [[0, 500], [0.35, 2200]], q: 1.2 } });
  },
  chomp() {
    if (bite) return sample(bite, { vol: 1.3 });
    [0, 0.16].forEach((at) => noise({ at, dur: 0.08, vol: 0.4, filter: { freq: [[0, 1800]], q: 1 } }));
  },
  munch() {
    // a couple of happy chews after the bite
    if (bite) return [[0, 1.25, 0.5], [0.3, 1.4, 0.4]].forEach(([at, rate, vol]) => sample(bite, { at, rate, vol }));
    [0, 0.25].forEach((at) => noise({ at, dur: 0.07, vol: 0.25, filter: { freq: [[0, 1400]], q: 1 } }));
  },
  yum() {
    notes([659, 784, 1046], { type: 'triangle', gap: 0.1, dur: 0.35, vol: 0.25 });
  },
  // "eca!": a raspberry, then "ptui"
  yuck() {
    voice({ type: 'sawtooth', dur: 0.45, freq: [[0, 140], [0.2, 110], [0.42, 150]], vol: 0.22, filter: { type: 'lowpass', freq: [[0, 700]] } });
    noise({ dur: 0.45, vol: 0.12, filter: { freq: [[0, 900]], q: 3 } });
  },
  ptui() {
    noise({ dur: 0.12, vol: 0.45, filter: { freq: [[0, 3000], [0.1, 1500]], q: 0.8 } });
    voice({ type: 'triangle', at: 0.05, dur: 0.4, freq: [[0, 900], [0.38, 250]], vol: 0.3 });
  },
  boing() {
    voice({ type: 'triangle', dur: 0.4, freq: [[0, 220], [0.18, 620], [0.38, 300]], vol: 0.4 });
  },
  hmm() {
    voice({ type: 'sine', dur: 0.25, freq: [[0, 330], [0.2, 360]], vol: 0.3 });
    voice({ type: 'sine', at: 0.25, dur: 0.35, freq: [[0, 360], [0.3, 560]], vol: 0.3 });
  },
  pop() {
    voice({ type: 'sine', dur: 0.12, freq: [[0, 500], [0.1, 1200]], vol: 0.25 });
  },
  grow() {
    voice({ type: 'triangle', dur: 1.1, attack: 0.05, freq: [[0, 150], [1, 600]], vol: 0.3 });
    notes([523, 659, 784, 1046, 1318], { at: 0.9, type: 'triangle', gap: 0.12, dur: 0.6, vol: 0.28 });
    notes([1568, 2093, 1568, 2093], { at: 1.6, gap: 0.08, dur: 0.3, vol: 0.12 });
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
