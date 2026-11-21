// Vosk (Kaldi compiled to WebAssembly, via vosk-browser) running on the device,
// behind a SpeechRecognition-shaped class so ear.js drives it exactly like the
// browser's recognizer: start/abort, onstart/onresult/onend, interim results.
//
// vosk-browser runs the model in a worker built from an inlined blob, and keeps
// the unpacked model in IndexedDB keyed by its URL, so the second visit loads
// without the network. Around that:
// - its createModel() never settles when the download fails, so the load is
//   watched here (load/error events, worker errors, a stall timer);
// - it says nothing while downloading, so its worker gets a prelude that wraps
//   fetch() to report progress and to keep the archive in the Cache API too;
// - the worker resolves relative URLs against its blob: origin, so the model
//   URL handed to it is absolute.
//
// iOS (WebKit): the worker is a classic blob worker (no SharedArrayBuffer, no
// cross-origin isolation needed) and the audio goes through a ScriptProcessor,
// which every WebKit still runs. The AudioContext is the game's, made in the
// start tap; resume() outside a tap may hang on iOS, hence the race below.

const CACHE = 'eduapps-vosk';
const STALL_MS = 60000; // no news from the loading worker for this long: give up
const RESUME_MS = 1500;
const CHUNK = 4096; // samples per ScriptProcessor callback (~85 ms at 48 kHz)

// Runs inside vosk-browser's worker, before its own code.
function prelude(cacheName) {
  // vosk-browser's async() helper reads `result.done` after reject(), so every
  // failed step also throws a stray TypeError; the real error is posted anyway.
  self.addEventListener('unhandledrejection', (e) => {
    if (/reading 'done'/.test(String(e.reason?.message))) e.preventDefault();
  });
  const net = self.fetch.bind(self);
  const say = (m) => self.postMessage({ event: 'progress', ...m });
  self.fetch = async (input, init) => {
    const url = String(input?.url || input);
    if (!/^https?:/.test(url)) return net(input, init);
    let cache = null;
    try {
      cache = await caches.open(cacheName);
      const hit = await cache.match(url);
      if (hit) {
        say({ phase: 'unpack', cached: true });
        return hit;
      }
    } catch {
      cache = null; // no Cache API here (or no room): the network it is
    }
    const res = await net(input, init);
    if (!res.ok || !res.body) return res;
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    let last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (Date.now() - last > 250) {
        last = Date.now();
        say({ phase: 'download', loaded, total });
      }
    }
    const blob = new Blob(chunks);
    const headers = { 'content-length': String(blob.size), 'content-type': 'application/gzip' };
    try {
      await cache?.put(url, new Response(blob, { headers }));
    } catch {
      // not kept; vosk-browser still keeps the unpacked model in IndexedDB
    }
    say({ phase: 'unpack', cached: false });
    return new Response(blob, { headers });
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (t) => String(t || '').replace(/\[unk\]/g, ' ').replace(/\s+/g, ' ').trim();

// grammar: the words the recognizer may hear; anything else comes out as [unk].
export function createVosk({ url, grammar, context, log, progress, failed }) {
  let state = 'loading';
  let stream = null;
  let streamP = null;
  const words = JSON.stringify([...new Set(grammar.map((w) => w.toLowerCase()))].concat('[unk]'));
  const t0 = performance.now();

  const ready = load().then(
    (model) => {
      const ms = Math.round(performance.now() - t0);
      state = 'ready';
      log(`vosk: model ready in ${ms} ms`);
      progress({ phase: 'ready', ms });
      return model;
    },
    (err) => {
      state = 'failed';
      log(`vosk: model FAILED after ${Math.round(performance.now() - t0)} ms: ${err?.message || err}`);
      failed(err?.message || String(err));
      throw err;
    },
  );
  ready.catch(() => {}); // the failure is reported through failed()

  async function load() {
    log(`vosk: loading ${url}`);
    if (typeof WebAssembly !== 'object' || typeof Worker !== 'function') throw new Error('no WebAssembly/Worker');
    const { Model } = await import('vosk-browser');
    // vosk-browser calls `new Worker(blobUrl)` inside the Model constructor:
    // put the prelude in front of it for that one call.
    const Real = window.Worker;
    window.Worker = function (src, opts) {
      const boot = `(${prelude})(${JSON.stringify(CACHE)});\nimportScripts(${JSON.stringify(String(src))});`;
      return new Real(URL.createObjectURL(new Blob([boot], { type: 'text/javascript' })), opts);
    };
    let model;
    try {
      model = new Model(url, -1);
    } finally {
      window.Worker = Real;
    }
    await new Promise((ok, fail) => {
      let timer = 0;
      const stall = () => {
        clearTimeout(timer);
        timer = setTimeout(() => fail(new Error('model load stalled')), STALL_MS);
      };
      stall();
      model.addEventListener('progress', (e) => {
        stall();
        const p = e.detail;
        if (p.phase === 'download') state = p.total ? `downloading ${Math.floor((100 * p.loaded) / p.total)}%` : 'downloading';
        else state = p.cached ? 'unpacking (from cache)' : 'unpacking';
        progress(p);
      });
      model.addEventListener('load', (e) => {
        clearTimeout(timer);
        e.detail.result ? ok() : fail(new Error('model load failed'));
      });
      model.addEventListener('error', (e) => {
        clearTimeout(timer);
        fail(new Error(e.detail.error));
      });
      // A worker error may come before the worker's own error message: give
      // that (the clearer one) a moment to arrive first.
      model.worker?.addEventListener('error', (e) => {
        log(`vosk: worker error: ${e.message}`);
        setTimeout(() => fail(new Error(e.message || 'worker error')), 1000);
      });
    });
    return model;
  }

  function micStream() {
    if (stream?.getAudioTracks().some((t) => t.readyState === 'live')) return Promise.resolve(stream);
    if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(Object.assign(new Error('no getUserMedia'), { name: 'NotSupportedError' }));
    if (!streamP) {
      log('vosk: getUserMedia()');
      streamP = navigator.mediaDevices
        .getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then((st) => (stream = st))
        .finally(() => (streamP = null));
    }
    return streamP;
  }

  // The mic goes off with the page, as the browser's recognizer does.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !stream) return;
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
    log('vosk: mic released (page hidden)');
  });

  class VoskSR {
    constructor() {
      this.lang = 'pt-BR';
      this.interimResults = true;
      this.maxAlternatives = 1;
      this.continuous = true;
      this.live = false;
      this.list = [];
      this.nodes = [];
      this.rec = null;
      this.partialText = '';
    }

    start() {
      if (this.live) throw new DOMException('already started', 'InvalidStateError');
      this.live = true;
      const ac = context();
      if (!ac) return this.later('audio-capture');
      // Both asked for here, synchronously: inside a tap iOS grants them.
      const resumed = ac.state === 'running' ? null : ac.resume();
      Promise.all([micStream(), Promise.race([resumed, wait(RESUME_MS)])]).then(
        ([st]) => {
          if (!this.live) return;
          if (ac.state !== 'running') {
            log(`vosk: audio ctx still ${ac.state}`);
            return this.end('not-allowed');
          }
          this.wire(ac, st);
        },
        (err) => {
          log(`vosk: getUserMedia failed: ${err?.name} ${err?.message}`);
          if (this.live) this.end(['NotAllowedError', 'SecurityError'].includes(err?.name) ? 'not-allowed' : 'audio-capture');
        },
      );
    }

    wire(ac, st) {
      const src = ac.createMediaStreamSource(st);
      const proc = ac.createScriptProcessor(CHUNK, 1, 1);
      // A ScriptProcessor only runs when its output leads somewhere: a silent sink.
      const sink = ac.createGain();
      sink.gain.value = 0;
      src.connect(proc);
      proc.connect(sink);
      sink.connect(ac.destination);
      this.nodes = [src, proc, sink];
      proc.onaudioprocess = (e) => this.rec?.acceptWaveformFloat(e.inputBuffer.getChannelData(0), ac.sampleRate);
      this.onCtx = () => ac.state !== 'running' && this.end('interrupted'); // iOS: a call, Siri, another app
      ac.addEventListener('statechange', this.onCtx);
      this.ctx = ac;
      this.track = st.getAudioTracks()[0];
      this.onTrack = () => this.end('interrupted');
      this.track?.addEventListener('ended', this.onTrack);
      log(`vosk: mic up, ${ac.sampleRate} Hz, ${this.track?.label || 'mic'}; model ${state}`);
      this.onstart?.({});
      this.onaudiostart?.({});
      ready.then(
        (model) => {
          if (!this.live) return;
          const rec = new model.KaldiRecognizer(ac.sampleRate, words);
          rec.on('partialresult', (m) => this.partial(m.result.partial));
          rec.on('result', (m) => this.final(m.result.text));
          rec.on('error', (m) => log(`vosk: recognizer error: ${m.error}`));
          this.rec = rec;
          log(`vosk: recognizer up (${ac.sampleRate} Hz, ${JSON.parse(words).length} words)`);
        },
        () => {}, // ear.js falls back to the web engine
      );
    }

    emit(text, isFinal) {
      const last = this.list[this.list.length - 1];
      const i = last && !last.isFinal ? this.list.length - 1 : this.list.length;
      this.list[i] = Object.assign([{ transcript: text, confidence: 0 }], { isFinal });
      this.onresult?.({ results: this.list, resultIndex: i });
    }

    partial(t) {
      const text = clean(t);
      if (!text || text === this.partialText) return;
      this.partialText = text;
      this.emit(text, false);
    }

    final(t) {
      const text = clean(t);
      this.partialText = '';
      const last = this.list[this.list.length - 1];
      if (text) this.emit(text, true);
      else if (last && !last.isFinal) this.emit(last[0].transcript, true);
    }

    teardown() {
      this.live = false;
      this.nodes.forEach((n) => n.disconnect());
      if (this.nodes[1]) this.nodes[1].onaudioprocess = null;
      this.nodes = [];
      this.ctx?.removeEventListener('statechange', this.onCtx);
      this.track?.removeEventListener('ended', this.onTrack);
      try {
        this.rec?.remove();
      } catch {
        // worker already gone
      }
      this.rec = null;
    }

    end(error) {
      if (!this.live) return;
      this.teardown();
      if (error) this.onerror?.({ error });
      this.onaudioend?.({});
      this.onend?.({});
    }

    later(error) {
      setTimeout(() => this.end(error));
    }

    stop() {
      this.later();
    }

    abort() {
      this.later('aborted');
    }
  }

  return {
    SR: VoskSR,
    stream: micStream,
    state: () => state,
  };
}
