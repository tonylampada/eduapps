// Short synthesized sound effects (WebAudio). The game never talks: these and
// the animation are all its feedback. Short and soft, so the mic (open the
// whole time) has little to hear; the launch rumble is the one long sound.

let ctx = null;
let out = null;
let muted = false;
let horn = null; // decoded horn.mp3, or null: the synth honk stands in
let hornLoading = false;

// The horn is a recording (CC0, see games/foguete/CREDITS.md). Written this
// way so Vite emits it with a hashed name.
const HORN_URL = new URL('./horn.mp3', import.meta.url);

// Decoded only after the start tap has created the context, so iOS plays it.
function loadHorn() {
  if (hornLoading || !ctx) return;
  hornLoading = true;
  fetch(HORN_URL)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`horn.mp3 ${r.status}`))))
    // callback form: older Safari's decodeAudioData returns no promise
    .then((data) => new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail)))
    .then((buf) => {
      horn = buf;
      document.body.dataset.horn = 'sample';
    })
    .catch(() => (document.body.dataset.horn = 'synth')); // the synth honk stays
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
  loadHorn();
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
  honk() {
    if (horn) return sample(horn, { vol: 1.1 });
    [0, 0.26].forEach((at) => [392, 494].forEach((f) => voice({ type: 'square', at, dur: 0.2, freq: [[0, f]], vol: 0.16, filter: { type: 'lowpass', freq: [[0, 1800]] } })));
  },
  ignite() {
    // cough, cough, vrooom
    [0, 0.2].forEach((at) => noise({ at, dur: 0.12, vol: 0.3, filter: { type: 'lowpass', freq: [[0, 500]] } }));
    voice({ type: 'sawtooth', at: 0.42, dur: 0.6, attack: 0.05, freq: [[0, 55], [0.25, 120], [0.58, 70]], vol: 0.3, filter: { type: 'lowpass', freq: [[0, 600]] } });
  },
  vroom() {
    voice({ type: 'sawtooth', dur: 0.7, attack: 0.04, freq: [[0, 60], [0.3, 150], [0.68, 75]], vol: 0.3, filter: { type: 'lowpass', freq: [[0, 700]] } });
  },
  cough() {
    [0, 0.22, 0.44].forEach((at) => noise({ at, dur: 0.12, vol: 0.28, filter: { type: 'lowpass', freq: [[0, 450]] } }));
  },
  drive() {
    voice({ type: 'sawtooth', dur: 1.2, attack: 0.08, freq: [[0, 70], [0.4, 110], [1.1, 95]], vol: 0.22, filter: { type: 'lowpass', freq: [[0, 500]] } });
  },
  brake() {
    voice({ type: 'triangle', dur: 0.45, attack: 0.02, freq: [[0, 1900], [0.42, 1500]], vol: 0.1 });
    noise({ dur: 0.35, vol: 0.15, filter: { freq: [[0, 3000]], q: 2 } });
  },
  boing() {
    voice({ type: 'triangle', dur: 0.4, freq: [[0, 220], [0.18, 620], [0.38, 300]], vol: 0.45 });
  },
  bonk() {
    voice({ type: 'square', dur: 0.18, freq: [[0, 160], [0.15, 70]], vol: 0.3, filter: { type: 'lowpass', freq: [[0, 800]] } });
    notes([1568, 1760, 2093], { at: 0.15, gap: 0.07, dur: 0.25, vol: 0.12 });
  },
  whoosh() {
    noise({ dur: 0.7, vol: 0.3, filter: { freq: [[0, 400], [0.35, 1800], [0.7, 500]], q: 1.5 } });
  },
  poof() {
    noise({ dur: 0.3, vol: 0.25, filter: { freq: [[0, 1500], [0.3, 600]], q: 0.7 } });
    notes([784, 1046], { gap: 0.08, dur: 0.25, vol: 0.12, type: 'triangle' });
  },
  ding() {
    notes([1046, 1568], { type: 'triangle', gap: 0.1, dur: 0.4, vol: 0.18 });
  },
  launch() {
    // countdown blips, then a rumble that rises with the rocket
    notes([660, 660, 990], { type: 'square', gap: 0.18, dur: 0.1, vol: 0.06 });
    noise({ at: 0.55, dur: 2.2, vol: 0.4, filter: { type: 'lowpass', freq: [[0, 300], [1.2, 900], [2.2, 300]] } });
    voice({ type: 'sawtooth', at: 0.55, dur: 1.6, attack: 0.2, freq: [[0, 50], [1.5, 160]], vol: 0.12, filter: { type: 'lowpass', freq: [[0, 400]] } });
  },
  land() {
    noise({ dur: 0.3, vol: 0.3, filter: { type: 'lowpass', freq: [[0, 400]] } });
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
