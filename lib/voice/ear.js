// The voice games' ear: always listening. One recognition session kept alive as
// long as the browser allows; when it ends, restart it without a tap; if that
// fails, the whole screen becomes the tap target.
//
// Two engines behind the same SpeechRecognition-shaped class: the browser's
// (webkitSpeechRecognition) and Vosk on the device (?engine=vosk, see vosk.js).
// The game hands over its spotter and what to do with what was heard.

import * as meter from './meter.js';
import { dbg, describeResults, isIOS, readFlags } from './debug.js';
import { pickEngine, storage } from './engine.js';
import { createVosk } from './vosk.js';

const START_MS = 3000; // a start() with no `start` event by now failed silently
const FIRST_START_MS = 15000; // the first one may sit behind permission prompts
const MODEL_URL = '../../models/vosk-model-small-pt-0.3.tar.gz'; // from games/<name>/

const WEB_SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const IOS = isIOS(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
const ANDROID = /Android/i.test(navigator.userAgent);
const FLAGS = readFlags(location.search);

// sfx:     the game's sound module (unlock(), context()), whose AudioContext is made in the start tap
// spot:    (text, isFinal) -> what the game acts on, in order, for this text
// heard:   (text, fresh) -> show the text; act on `fresh` (the spotted items not yet acted on)
// note:    (text) -> a message for the adult
// grammar: every word the spotter knows, for Vosk's restricted recognizer
// ui:      { ear (grows with the mic level), tapResume, tapHint }
export function createEar({ sfx, spot, heard, note, grammar, ui }) {
  let engine = pickEngine(location.search, storage());
  let SR = WEB_SR;
  let vosk = null;
  let pill = null;

  const ear = { on: false, s: null, n: 0, worked: false, free: { ok: 0, fail: 0 }, tap: false, fails: 0, deaths: 0, timer: 0, lastEnd: 0 };

  if (engine === 'vosk') {
    pill = Object.assign(document.createElement('p'), { className: 'voice-model' });
    pill.style.cssText = 'position:fixed;top:max(10px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:60;margin:0;padding:6px 14px;border-radius:999px;background:rgba(0,0,0,.65);color:#fff;font:600 15px/1.3 system-ui,sans-serif;pointer-events:none;';
    pill.textContent = 'carregando a voz…';
    document.body.append(pill);
    vosk = createVosk({
      url: new URL(MODEL_URL, location.href).href,
      grammar,
      context: () => sfx.context(),
      log: dbg,
      progress: modelProgress,
      failed: fallback,
    });
    SR = vosk.SR;
  }

  function modelProgress(p) {
    document.body.dataset.voiceModel = p.phase;
    if (p.phase === 'download') {
      pill.textContent = p.total ? `baixando a voz… ${Math.floor((100 * p.loaded) / p.total)}%` : `baixando a voz… ${(p.loaded / 1e6).toFixed(1)} MB`;
    } else if (p.phase === 'unpack') {
      pill.textContent = 'preparando a voz…';
    } else if (p.phase === 'ready') {
      pill.remove();
    }
  }

  // Vosk could not load: the browser's recognizer takes over, from the next tap.
  function fallback(err) {
    dbg(`engine: vosk failed (${err}), falling back to web`);
    engine = 'web';
    SR = WEB_SR;
    vosk = null;
    pill.remove();
    document.body.dataset.voiceModel = 'failed';
    note(`Não consegui carregar o reconhecimento de voz local (${err}). Usando o do navegador.`);
    if (!ear.on) return;
    earDrop();
    if (SR) earWaitTap('engine fallback');
  }

  function earOn(gesture) {
    if (!SR) return;
    ear.on = true;
    if (gesture) ear.tap = false;
    earStart(gesture ? 'tap' : 'resume', gesture);
  }

  function earCue() {
    const b = document.body.classList;
    b.toggle('ear-on', ear.on && !!ear.s);
    const tap = ear.on && ear.tap && !ear.s;
    b.toggle('ear-tap', tap);
    ui.tapResume.hidden = !tap;
    ui.tapHint.hidden = !tap;
    if (!ear.s) ['capturing', 'sound', 'hearing'].forEach((c) => b.remove(c));
  }

  function earDrop() {
    const s = ear.s;
    if (!s) return;
    ear.s = null;
    clearTimeout(s.wd);
    dbg(`sr#${s.id} abort()`);
    try {
      s.r.abort();
    } catch {
      // already stopped
    }
    earCue();
  }

  function earStart(why, gesture = false) {
    clearTimeout(ear.timer);
    if (!ear.on || ear.s || document.hidden) return;
    if (ear.tap && !gesture) return earCue(); // only a tap brings it back now
    const r = new SR();
    r.lang = 'pt-BR';
    r.interimResults = true; // act on the word as it is heard, not after the pause
    r.maxAlternatives = 3;
    // Android Chrome repeats words in continuous mode.
    r.continuous = !ANDROID;
    const s = { r, id: ++ear.n, why, gesture, at: Date.now(), started: false, alive: false, fired: [], error: '' };
    const cue = (c, on) => document.body.classList.toggle(c, on);
    const on = (type, f) => {
      r[`on${type}`] = (e) => {
        if (type !== 'result') dbg(`sr#${s.id} ${type}${e?.error ? ` ${e.error}${e.message ? ` (${e.message})` : ''}` : ''}${ear.s === s ? '' : ' (old)'}`);
        if (ear.s === s) f?.(e);
      };
    };
    on('start', () => earBegan(s));
    on('audiostart', () => {
      earBegan(s);
      cue('capturing', true);
      dbg(`sr#${s.id} capturing; meter ${meter.status()}`);
    });
    on('soundstart', () => cue('sound', true));
    on('speechstart', () => cue('hearing', true));
    on('speechend', () => cue('hearing', false));
    on('soundend', () => cue('sound', false));
    on('audioend', () => cue('capturing', false));
    on('nomatch');
    on('result', (e) => {
      dbg(`sr#${s.id} result ${describeResults(e.results, e.resultIndex)}`);
      earHeard(s, e);
    });
    on('error', (e) => {
      s.error = e.error;
    });
    on('end', () => earEnded(s));
    ear.s = s;
    s.wd = setTimeout(() => ear.s === s && !s.started && earFailed(s, 'no start event'), ear.worked ? START_MS : FIRST_START_MS);
    dbg(`sr#${s.id} start() — ${why}, ${gesture ? 'in a tap' : 'NO gesture'}, continuous ${r.continuous}`);
    try {
      r.start();
    } catch (err) {
      dbg(`sr#${s.id} start() threw ${err.name}: ${err.message}`);
      earFailed(s, err.name);
      return;
    }
    earCue();
  }

  function earBegan(s) {
    if (s.started) return;
    s.started = true;
    clearTimeout(s.wd);
    ear.worked = true;
    ear.fails = 0;
    if (!s.gesture) {
      ear.free.ok++;
      dbg(`sr#${s.id} restart WITHOUT a tap worked (ok ${ear.free.ok} / failed ${ear.free.fail})`);
    }
    if (ear.lastEnd) dbg(`sr#${s.id} up ${Date.now() - ear.lastEnd} ms after the last session ended`);
    // The local engine's mic may be a new stream (back from the background): the meter follows it.
    if (vosk) meterOn();
    earCue();
  }

  function earFailed(s, why) {
    if (ear.s === s) earDrop();
    ear.fails++;
    if (!s.gesture) ear.free.fail++;
    dbg(`sr#${s.id} FAILED (${why}), ${s.gesture ? 'started in a tap' : `no gesture: ok ${ear.free.ok} / failed ${ear.free.fail}`}`);
    if (!ear.on) return;
    if ((why === 'not-allowed' || why === 'service-not-allowed') && !ear.worked) {
      ear.on = false;
      earCue();
      return note('O microfone está bloqueado. Libere o microfone para este site (no iPad: Ajustes › Safari › Microfone, e o Ditado ligado). Os botões funcionam assim mesmo.');
    }
    // Restarts without a tap have worked here before: a hiccup, try again shortly.
    if (!s.gesture && ear.free.ok > 0 && ear.fails < 3) {
      ear.timer = setTimeout(() => earStart('retry'), 300 * ear.fails);
      return;
    }
    earWaitTap(why);
  }

  function earWaitTap(why) {
    ear.tap = true;
    dbg(`waiting for a tap anywhere (${why})`);
    earCue();
  }

  // Interim results grow ("cachorro" -> "cachorro pula" -> final), and on iOS one
  // result can keep growing for the whole session. Per result, count what was
  // already acted on and act only on the new ones: one utterance acts once.
  function earHeard(s, e) {
    s.alive = true;
    ear.deaths = 0;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const alts = Array.from(res, (a) => a.transcript);
      const done = s.fired[i] || 0;
      const hit = alts.map((t) => spot(t, res.isFinal)).find((items) => items.length > done);
      if (hit) s.fired[i] = hit.length;
      heard(alts[0], hit ? hit.slice(done) : []);
    }
  }

  function earEnded(s) {
    ear.s = null;
    ear.lastEnd = Date.now();
    clearTimeout(s.wd);
    earCue();
    const err = s.error;
    const lived = Date.now() - s.at;
    dbg(`sr#${s.id} ended after ${(lived / 1000).toFixed(1)} s${err ? ` (${err})` : ''}`);
    if (!ear.on) return;
    if (err === 'audio-capture') note('Não achei um microfone. Verifique se ele está ligado.');
    if (err === 'network') note('O reconhecimento de fala precisa de internet. Os botões funcionam assim mesmo.');
    if (!s.started) return earFailed(s, err || 'ended before start');
    const died = (err && !['no-speech', 'aborted'].includes(err)) || (!s.alive && lived < 1000);
    ear.deaths = died ? ear.deaths + 1 : 0;
    if (ear.deaths >= 3) return earWaitTap(`${ear.deaths} sessions in a row died at once`);
    earStart(died ? 'session died' : 'session ended');
  }

  // The ear icon grows with the sound the mic hears.
  function meterOn() {
    if (!FLAGS.meter) return;
    document.body.classList.add('metering');
    meter.start(sfx.context(), (v) => ui.ear.style.setProperty('--lvl', v.toFixed(3)), dbg, vosk?.stream);
  }

  document.addEventListener('visibilitychange', () => {
    dbg(`page ${document.hidden ? 'hidden' : 'visible'}`);
    if (document.hidden) earDrop();
    else earStart('back on the page');
  });

  return {
    get supported() {
      return !!SR;
    },
    get engine() {
      return engine;
    },

    // Inside the start tap, after sfx.unlock() made the AudioContext.
    begin() {
      earOn(true); // recognition start() first, still inside this tap...
      meterOn(); // ...then the meter's getUserMedia
      const ctx = sfx.context();
      if (ctx && !ctx.onstatechange) ctx.onstatechange = () => dbg(`audio ctx ${ctx.state}`);
    },

    // Inside any other tap: bring the mic back if it isn't up.
    tapped() {
      if (!ear.on) return;
      sfx.unlock();
      meterOn();
      if (ear.s?.started) return;
      ear.tap = false;
      ear.fails = 0;
      ear.deaths = 0;
      earDrop();
      earStart('tap', true);
    },

    // The ear's part of the ?debug status line.
    status() {
      const s = ear.s;
      const lvl = meter.getLevel();
      return [
        !ear.on ? 'ear off' : s ? `sr#${s.id} ${s.started ? 'up' : 'starting'}` : ear.tap ? 'WAITING FOR TAP' : 'no session',
        ...(vosk ? [`vosk ${vosk.state()}`] : []),
        `no-tap restarts ok ${ear.free.ok}/failed ${ear.free.fail}`,
        `meter ${meter.status()} ${'▁▂▃▄▅▆▇█'[Math.min(7, Math.round(lvl * 7))]} ${lvl.toFixed(2)}`,
      ];
    },

    debugEnv() {
      dbg(`UA ${navigator.userAgent}`);
      dbg(`iOS ${IOS}, standalone ${navigator.standalone ?? 'n/a'}, secure ${window.isSecureContext}, visible ${!document.hidden}`);
      dbg(`SpeechRecognition ${'SpeechRecognition' in window}, webkitSpeechRecognition ${'webkitSpeechRecognition' in window}, getUserMedia ${!!navigator.mediaDevices?.getUserMedia}`);
      dbg(`engine ${engine}${vosk ? `, WebAssembly ${typeof WebAssembly}, Worker ${typeof Worker}, caches ${typeof caches}` : ''}`);
      dbg(`meter ${FLAGS.meter ? 'on' : 'off (url)'}, continuous ${!ANDROID}`);
      navigator.permissions?.query?.({ name: 'microphone' }).then(
        (p) => {
          dbg(`mic permission: ${p.state}`);
          p.onchange = () => dbg(`mic permission → ${p.state}`);
        },
        (err) => dbg(`mic permission: query failed (${err.name}: ${err.message})`),
      );
    },
  };
}
