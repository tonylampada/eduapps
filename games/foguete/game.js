import { COMMANDS, ORDER, spot } from './commands.js';
import { PAD, goal, newRun, obstacle, step, turnGreen } from './trip.js';
import * as sfx from './sfx.js';
import * as meter from './meter.js';
import { dbg, describeResults, initDebug, isIOS, readFlags } from './debug.js';

const $ = (id) => document.getElementById(id);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const IOS = isIOS(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
const ANDROID = /Android/i.test(navigator.userAgent);
const FLAGS = readFlags(location.search);

const START_MS = 3000; // a start() with no `start` event by now failed silently
const FIRST_START_MS = 15000; // the first one may sit behind permission prompts
const SAME_CMD_MS = 700; // the same word again this soon is the recognizer repeating itself
const GREEN_MS = 2000; // the red light turns green this long after "para"
const PARTY_MS = 4200;

// World layout, in units of --u (see style.css). The road is 190 wide.
const WORLD = 190;
const SLOT_X = [64, 118];
const PAD_X = 170;
const DUR = { start: 1100, rev: 900, cough: 900, drive: 1500, arrive: 1500, bump: 950, 'honk-wait': 1100, stop: 900, brake: 800, hop: 1000, jump: 750, honk: 850, flip: 1000, launch: 3800 };
const SOUND = { start: 'ignite', rev: 'vroom', cough: 'cough', drive: 'drive', arrive: 'drive', bump: 'bonk', 'honk-wait': 'honk', stop: 'brake', brake: 'brake', hop: 'boing', jump: 'boing', honk: 'honk', flip: 'whoosh', launch: 'launch' };

const ui = {
  scene: $('scene'), world: $('world'), ride: $('ride'), slots: [$('slot-1'), $('slot-2')], parked: $('parked'), space: $('space'),
  bubble: $('bubble'), ear: $('ear'), mute: $('mute'), cmds: $('cmds'), start: $('start'), tapResume: $('tap-resume'), tapHint: $('tap-hint'),
  note: $('note'), confetti: $('confetti'),
};

let run = newRun();
let runs = 0;
let phase = 'start'; // start | play | party
let busy = false;
let pending = null;
let lastVoice = { cmd: '', at: 0 };
let fired = 0;
let partyTimer = 0;
let greenTimer = 0;
let fxTimers = [];

// ---------- the road on screen ----------

const ROCK = '<svg class="rock" viewBox="0 0 80 46" aria-hidden="true"><path d="M6 44q-6-14 6-26 10-14 28-14 20 0 30 14 12 14 4 26z" fill="#8A8F9C"/><path d="M16 22q8-10 22-12" fill="none" stroke="#B6BBC6" stroke-width="5" stroke-linecap="round"/><path d="M44 30q8 2 14 10M24 34q4 4 2 10" fill="none" stroke="#6E7380" stroke-width="3" stroke-linecap="round"/></svg>';

const LIGHT = `<svg class="light" viewBox="0 0 30 110" aria-hidden="true">
  <rect x="12" y="44" width="6" height="66" rx="2" fill="#5A5F6B"/>
  <rect x="2" y="2" width="26" height="46" rx="7" fill="#2B2F3A"/>
  <circle class="lamp red" cx="15" cy="12" r="5.5"/><circle class="lamp yellow" cx="15" cy="25" r="5.5"/><circle class="lamp green" cx="15" cy="38" r="5.5"/>
</svg><span class="hourglass">⏳</span>`;

function renderRoad() {
  run.order.forEach((ob, i) => {
    const el = ui.slots[i];
    el.className = `slot is-${ob}`;
    el.style.setProperty('--x', SLOT_X[i]);
    el.innerHTML = ob === 'rock' ? ROCK : LIGHT;
  });
  document.getElementById('pad').style.setProperty('--x', PAD_X);
  ui.parked.style.setProperty('--x', PAD_X - 27);
  ui.world.classList.remove('arrived', 'in-space', 'flying', 'on-moon');
  ui.ride.className = 'ride';
  showLight();
  moveRide(0);
}

function lightEl() {
  return ui.slots[run.order.indexOf('light')];
}

function showLight() {
  const el = lightEl();
  el.classList.remove('red', 'waiting', 'green');
  el.classList.add(run.light === 'green' ? 'green' : 'red');
  if (run.light === 'waiting') el.classList.add('waiting');
}

function rideX() {
  if (run.ride === 'rocket') return PAD_X;
  if (run.at === 0) return 16;
  if (run.at === PAD) return PAD_X - 27;
  const x = SLOT_X[run.at - 1];
  return obstacle(run) === 'rock' && run.cleared ? x + 24 : x - 26;
}

function moveRide(ms) {
  const x = rideX();
  ui.ride.style.setProperty('--t', `${ms}ms`);
  ui.ride.style.setProperty('--x', x);
  pan(x, ms);
}

// Narrow screens (iPhone portrait) see part of the road: follow the ride, a bit ahead.
function pan(x, ms) {
  const w = ui.world.offsetWidth;
  const view = ui.scene.clientWidth;
  const u = w / WORLD;
  const off = w <= view ? (view - w) / 2 : Math.min(0, Math.max(view - w, view * 0.4 - x * u));
  ui.world.style.transition = `transform ${ms}ms ease-in-out, opacity .3s`;
  ui.world.style.transform = `translateX(${off}px)`;
}

function restartClass(el, cls) {
  el.classList.remove(cls);
  void el.getBoundingClientRect(); // restart CSS animations
  el.classList.add(cls);
}

function clearFx() {
  for (const c of [...ui.ride.classList]) if (c.startsWith('fx-')) ui.ride.classList.remove(c);
}

function later(ms, f) {
  fxTimers.push(setTimeout(f, ms));
}

// The truck parks by the rocket and the rocket becomes the ride.
function board() {
  ui.world.classList.add('arrived');
  ui.ride.classList.add('is-rocket');
  moveRide(0);
  restartClass(ui.ride, 'poofing');
  sfx.play('poof');
}

// Show one step; returns how long it takes.
function animate(fx) {
  const d = ui.ride;
  clearFx();
  void d.getBoundingClientRect();
  d.classList.add(`fx-${fx}`);
  d.classList.toggle('engine-on', run.engine);
  sfx.play(SOUND[fx]);
  const ms = DUR[fx] || 800;
  if (fx === 'drive' || fx === 'arrive' || fx === 'hop') moveRide(fx === 'hop' ? ms * 0.8 : ms);
  if (fx === 'arrive') later(ms - 50, board);
  if (fx === 'stop' || fx === 'honk-wait') showLight();
  if (fx === 'launch') {
    later(700, () => ui.world.classList.add('in-space', 'flying'));
    later(2200, () => {
      ui.world.classList.remove('flying');
      ui.world.classList.add('on-moon');
    });
    later(3300, () => sfx.play('land'));
  }
  return ms;
}

function setPhase(p) {
  phase = p;
  document.body.dataset.phase = p;
  glow();
}

function glow() {
  const g = phase === 'play' && !busy ? goal(run) : null;
  const b = document.body.dataset;
  b.goal = g || '';
  b.at = run.at;
  b.ride = run.ride;
  b.light = run.light;
  b.runs = runs;
  for (const el of ui.cmds.children) el.classList.toggle('goal', el.dataset.cmd === g);
  // at the launchpad "acelera" is said "decola"
  const a = ui.cmds.querySelector('[data-cmd=acelera]');
  const rocket = run.ride === 'rocket';
  a.querySelector('.ic').textContent = rocket ? '🚀' : COMMANDS.acelera.icon;
  a.querySelector('.w').textContent = rocket ? 'decola' : COMMANDS.acelera.label;
}

// ---------- commands ----------

function fire(cmd, src) {
  if (phase === 'start') return;
  if (src === 'voice') {
    const now = Date.now();
    if (lastVoice.cmd === cmd && now - lastVoice.at < SAME_CMD_MS) return dbg(`skip ${cmd}: said again too soon`);
    lastVoice = { cmd, at: now };
  }
  fired++;
  document.body.dataset.fired = fired;
  dbg(`fire ${cmd} (${src})${busy ? ' — queued' : ''}`);
  const b = ui.cmds.querySelector(`[data-cmd=${cmd}]`);
  if (b) restartClass(b, 'pressed');
  if (busy) {
    pending = cmd; // the latest one wins; a truck can't do five things at once
    return;
  }
  act(cmd);
}

function act(cmd) {
  const res = step(run, cmd);
  const was = run;
  run = res.run;
  busy = true;
  glow();
  dbg(`${cmd} -> ${res.fx} (at ${run.at}, ${run.ride}${run.engine ? ' on' : ' off'}${run.cleared ? '' : `, blocked, light ${run.light}`}, goal ${goal(run) || '-'})`);
  if (res.fx === 'stop') {
    clearTimeout(greenTimer);
    greenTimer = setTimeout(green, GREEN_MS);
  }
  const ms = animate(res.fx);
  setTimeout(() => {
    busy = false;
    clearFx();
    if (run.done && !was.done) return party();
    glow();
    if (pending) {
      const c = pending;
      pending = null;
      act(c);
    }
  }, ms);
}

function green() {
  const next = turnGreen(run);
  if (next === run) return;
  run = next;
  dbg('light turned green');
  showLight();
  sfx.play('ding');
  glow();
}

function party() {
  pending = null;
  setPhase('party');
  ui.ride.classList.remove('engine-on'); // landed: engine off
  ui.ride.classList.add('dance');
  sfx.play('party');
  confetti();
  clearTimeout(partyTimer);
  partyTimer = setTimeout(nextRun, PARTY_MS);
}

function nextRun() {
  runs++;
  run = newRun(run);
  dbg(`run ${runs}: ${run.order.join(' → ')}`);
  ui.world.classList.add('fade');
  setTimeout(() => {
    fxTimers.forEach(clearTimeout);
    fxTimers = [];
    clearTimeout(greenTimer);
    clearFx();
    renderRoad();
    ui.world.classList.remove('fade');
    setPhase('play');
  }, 350);
}

function confetti() {
  const colors = ['#F5B82E', '#EF6F86', '#3E86D6', '#2E9E5B', '#9B6BD6', '#FF8A3D'];
  ui.confetti.innerHTML = Array.from({ length: 70 }, (_, i) => {
    const s = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${Math.random() * 0.8}s;--r:${Math.random() * 720 - 360}deg;--dx:${Math.random() * 30 - 15}vw`;
    return `<i style="${s}"></i>`;
  }).join('');
  setTimeout(() => (ui.confetti.innerHTML = ''), PARTY_MS);
}

// ---------- what was heard ----------

let bubbleTimer = 0;
function showHeard(text, hit) {
  const words = String(text).trim().split(/\s+/);
  if (!words[0]) return;
  ui.bubble.textContent = (words.length > 7 ? '… ' : '') + words.slice(-7).join(' ');
  ui.bubble.classList.add('on');
  if (hit) restartClass(ui.bubble, 'hit');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => ui.bubble.classList.remove('on', 'hit'), 2600);
}

// ---------- ear: always listening ----------
// One recognition
// session kept alive as long as the browser allows; when it ends, restart it
// without a tap; if that fails, the whole screen becomes the tap target.

const ear = { on: false, s: null, n: 0, worked: false, free: { ok: 0, fail: 0 }, tap: false, fails: 0, deaths: 0, timer: 0, lastEnd: 0 };

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
    return showNote('O microfone está bloqueado. Libere o microfone para este site (no iPad: Ajustes › Safari › Microfone, e o Ditado ligado). Os botões funcionam assim mesmo.');
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

// Inside any tap: bring the mic back if it isn't up.
function earTapped() {
  if (!ear.on) return;
  sfx.unlock();
  meterOn();
  if (ear.s?.started) return;
  ear.tap = false;
  ear.fails = 0;
  ear.deaths = 0;
  earDrop();
  earStart('tap', true);
}

// Interim results grow ("caminhão" -> "caminhão acelera" -> final), and on iOS one
// result can keep growing for the whole session. Per result, count the commands
// already acted on and fire only the new ones: one utterance fires once.
function earHeard(s, e) {
  s.alive = true;
  ear.deaths = 0;
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const alts = Array.from(e.results[i], (a) => a.transcript);
    const done = s.fired[i] || 0;
    const hit = alts.map(spot).find((cmds) => cmds.length > done);
    showHeard(alts[0], !!hit);
    if (!hit) continue;
    s.fired[i] = hit.length;
    hit.slice(done).forEach((c) => fire(c, 'voice'));
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
  if (err === 'audio-capture') showNote('Não achei um microfone. Verifique se ele está ligado.');
  if (err === 'network') showNote('O reconhecimento de fala precisa de internet. Os botões funcionam assim mesmo.');
  if (!s.started) return earFailed(s, err || 'ended before start');
  const died = (err && !['no-speech', 'aborted'].includes(err)) || (!s.alive && lived < 1000);
  ear.deaths = died ? ear.deaths + 1 : 0;
  if (ear.deaths >= 3) return earWaitTap(`${ear.deaths} sessions in a row died at once`);
  earStart(died ? 'session died' : 'session ended');
}

function showNote(text) {
  ui.note.textContent = text;
  ui.note.hidden = false;
}

// ---------- meter: the ear grows with the sound the mic hears ----------

function meterOn() {
  if (!FLAGS.meter) return;
  document.body.classList.add('metering');
  meter.start(sfx.context(), (v) => ui.ear.style.setProperty('--lvl', v.toFixed(3)), dbg);
}

// ---------- debug (?debug) ----------

function debugStatus() {
  const s = ear.s;
  const lvl = meter.getLevel();
  return [
    phase,
    `goal ${goal(run) || '-'}`,
    !ear.on ? 'ear off' : s ? `sr#${s.id} ${s.started ? 'up' : 'starting'}` : ear.tap ? 'WAITING FOR TAP' : 'no session',
    `no-tap restarts ok ${ear.free.ok}/failed ${ear.free.fail}`,
    `meter ${meter.status()} ${'▁▂▃▄▅▆▇█'[Math.min(7, Math.round(lvl * 7))]} ${lvl.toFixed(2)}`,
  ].join(' · ');
}

function debugEnv() {
  dbg(`UA ${navigator.userAgent}`);
  dbg(`iOS ${IOS}, standalone ${navigator.standalone ?? 'n/a'}, secure ${window.isSecureContext}, visible ${!document.hidden}`);
  dbg(`SpeechRecognition ${'SpeechRecognition' in window}, webkitSpeechRecognition ${'webkitSpeechRecognition' in window}, getUserMedia ${!!navigator.mediaDevices?.getUserMedia}`);
  dbg(`meter ${FLAGS.meter ? 'on' : 'off (url)'}, continuous ${!ANDROID}`);
  navigator.permissions?.query?.({ name: 'microphone' }).then(
    (p) => {
      dbg(`mic permission: ${p.state}`);
      p.onchange = () => dbg(`mic permission → ${p.state}`);
    },
    (err) => dbg(`mic permission: query failed (${err.name}: ${err.message})`),
  );
}

// ---------- wiring ----------

if (FLAGS.debug) {
  initDebug(debugStatus);
  debugEnv();
}

ui.cmds.innerHTML = ORDER.map((c) => `<button type="button" class="cmd" data-cmd="${c}"><span class="ic" aria-hidden="true">${COMMANDS[c].icon}</span><span class="w">${COMMANDS[c].label}</span></button>`).join('');
ui.cmds.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) fire(b.dataset.cmd, 'tap');
});

ui.start.addEventListener('click', () => {
  sfx.unlock();
  ui.start.hidden = true;
  setPhase('play');
  earOn(true); // recognition start() first, still inside this tap...
  meterOn(); // ...then the meter's getUserMedia
  const ctx = sfx.context();
  if (ctx && !ctx.onstatechange) ctx.onstatechange = () => dbg(`audio ctx ${ctx.state}`);
});

// Any tap (the whole screen when the mic is down) restarts the mic inside the gesture.
document.addEventListener('click', (e) => {
  if (e.target === ui.start || ui.start.contains(e.target)) return;
  earTapped();
});

ui.mute.addEventListener('click', () => {
  const m = ui.mute.getAttribute('aria-pressed') !== 'true';
  sfx.setMuted(m);
  ui.mute.setAttribute('aria-pressed', String(m));
  ui.mute.setAttribute('aria-label', m ? 'Sons desligados' : 'Sons ligados');
});

document.addEventListener('visibilitychange', () => {
  dbg(`page ${document.hidden ? 'hidden' : 'visible'}`);
  if (document.hidden) earDrop();
  else earStart('back on the page');
});

addEventListener('resize', () => pan(rideX(), 0));

if (!SR) showNote('Este navegador não consegue ouvir a fala (use Safari ou Chrome). Os botões funcionam assim mesmo.');
renderRoad();
setPhase('start');
