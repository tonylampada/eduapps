// The "chhhhh" sound (not a word, so no recognizer writes it down): read from
// the mic itself, on the meter's stream (lib/voice/meter.js getStream) in the
// game's AudioContext. A hiss is noise with its energy above ~3 kHz; vowels,
// and so all normal speech, keep theirs below. Sustained for HOLD_MS so the
// short "ch"/"s" inside words ("cachorro", "sim") never count.

const SPLIT_HZ = 3000;
const LOW_HZ = 150; // below this is hum and handling noise, not voice
const TOP_HZ = 9000;
const RATIO = 2; // energy above SPLIT_HZ at least this many times the energy below
const MIN_DB = -72; // and loud enough to be someone hissing, not the room
const HOLD_MS = 400;
const GAP_MS = 120; // a dip this short doesn't break a hiss

// One analyser frame (getFloatFrequencyData, dB per bin) -> is it hiss?
export function hissFrame(db, binHz) {
  let low = 0;
  let high = 0;
  let nHigh = 0;
  for (let i = 0; i < db.length; i++) {
    const hz = i * binHz;
    if (hz < LOW_HZ || hz > TOP_HZ) continue;
    const p = 10 ** (db[i] / 10);
    if (hz < SPLIT_HZ) low += p;
    else {
      high += p;
      nHigh++;
    }
  }
  const level = 10 * Math.log10(high / Math.max(1, nHigh) + 1e-20);
  const ratio = high / (low + 1e-20);
  return { hiss: ratio > RATIO && level > MIN_DB, ratio, level };
}

// Watches the mic while the game runs. onHiss() once per hiss, when it has
// lasted HOLD_MS. quiet(): true while the game's own noisy sounds play.
export function createHiss({ ctx, stream, onHiss, quiet, log }) {
  let an = null;
  let src = null;
  let sink = null;
  let buf = null;
  let on = null; // performance.now() the current hiss began, or null
  let lastHiss = 0;
  let fired = false;
  let peak = null;
  let last = { ratio: 0, level: -200 };
  let attached = null; // the stream the analyser listens to

  function attach(st) {
    detach();
    src = ctx.createMediaStreamSource(st);
    an = ctx.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0.2;
    // Safari only runs an analyser whose output leads somewhere: a silent sink.
    sink = ctx.createGain();
    sink.gain.value = 0;
    src.connect(an);
    an.connect(sink);
    sink.connect(ctx.destination);
    buf = new Float32Array(an.frequencyBinCount);
    attached = st;
    log(`hiss: listening (${ctx.sampleRate} Hz)`);
  }

  function detach() {
    [src, an, sink].forEach((n) => n?.disconnect());
    src = an = sink = null;
    attached = null;
  }

  function tick() {
    const st = stream();
    if (st !== attached) (st ? attach(st) : detach());
    if (!an) return;
    an.getFloatFrequencyData(buf);
    const now = performance.now();
    const f = hissFrame(buf, ctx.sampleRate / an.fftSize);
    last = f;
    if (quiet()) {
      on = null;
      fired = false;
      return;
    }
    if (f.hiss) {
      if (on === null) {
        on = now;
        peak = f;
      }
      lastHiss = now;
      if (f.ratio > peak.ratio) peak = f;
      if (!fired && now - on >= HOLD_MS) {
        fired = true;
        log(`hiss: DETECTED after ${Math.round(now - on)} ms (ratio ${peak.ratio.toFixed(1)}, ${peak.level.toFixed(0)} dB)`);
        onHiss();
      }
    } else if (on !== null && now - lastHiss > GAP_MS) {
      if (!fired && now - on > 150) log(`hiss: too short (${Math.round(lastHiss - on)} ms), ignored`);
      on = null;
      fired = false;
    }
  }

  const timer = setInterval(tick, 30);
  return {
    status: () => (an ? `hiss ${last.ratio.toFixed(1)}× ${last.level.toFixed(0)}dB${on !== null ? ' ▲' : ''}` : 'hiss off'),
    stop() {
      clearInterval(timer);
      detach();
    },
  };
}
