// Live mic level, so an adult can SEE the mic hears: a second capture
// (getUserMedia + AnalyserNode) next to SpeechRecognition. It may upset iOS,
// hence ?meter=0.

let stream = null;
let want = false;
let state = 'off'; // off | asking | live | ended | failed (failed: don't ask again until stop())
let raf = 0;
let nodes = [];
let level = 0;

export const status = () => (state === 'live' && stream?.getAudioTracks()[0]?.muted ? 'muted' : state);
export const live = () => status() === 'live';
export const getLevel = () => level;

// Call inside a tap: iOS wants the gesture for getUserMedia and the AudioContext.
export function start(ctx, onLevel, log) {
  if (want && ['asking', 'live', 'failed'].includes(state)) return;
  stop();
  want = true;
  if (!ctx || !navigator.mediaDevices?.getUserMedia) {
    state = 'failed';
    return log(`meter: unavailable (${ctx ? 'no getUserMedia' : 'no AudioContext'})`);
  }
  state = 'asking';
  log('meter: getUserMedia()');
  navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (st) => {
      if (!want) return st.getTracks().forEach((t) => t.stop());
      stream = st;
      state = 'live';
      const [t] = st.getAudioTracks();
      log(`meter: live (${t?.label || 'mic'}), audio ctx ${ctx.state}`);
      if (t) {
        t.onmute = () => log('meter: track muted');
        t.onunmute = () => log('meter: track unmuted');
        t.onended = () => {
          state = 'ended';
          log('meter: track ended');
        };
      }
      if (ctx.state === 'suspended') ctx.resume();
      const src = ctx.createMediaStreamSource(st);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      // Safari only runs an analyser whose output leads somewhere: a silent sink.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      src.connect(an);
      an.connect(sink);
      sink.connect(ctx.destination);
      nodes = [src, an, sink];
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        level = Math.max(Math.min(1, Math.sqrt(sum / buf.length) * 6), level * 0.9);
        onLevel(level);
        raf = requestAnimationFrame(tick);
      };
      tick();
    },
    (err) => {
      if (!want) return;
      state = 'failed';
      log(`meter: getUserMedia failed: ${err.name} ${err.message}`);
    },
  );
}

export function stop() {
  want = false;
  cancelAnimationFrame(raf);
  nodes.forEach((n) => n.disconnect());
  nodes = [];
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  level = 0;
  state = 'off';
}
