import { COMMANDS, ORDER, spot } from './commands.js';
import { goal, newRun, step } from './house.js';
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
const PARTY_MS = 3800;

// Room layout, in units of --u (see style.css). The room is 160 wide; the
// four hiding spots stand on the floor, which is 16 high.
const WORLD = 160;
const SLOT_X = [22, 61, 100, 139];
const FLOOR = 16;
const MID = 80;
const BEAM_Y = FLOOR + 24;
const DUR = { light: 1300, flicker: 1300, meow: 1500, find: 1500, reveal: 1300, poke: 1000, purr: 1200, come: 1700, none: 300 };
const SPOT_SOUND = { porta: 'creak', armario: 'creak', cama: 'slide', cortina: 'swish' };
const ITEM = {
  meia: { icon: '🧦', sound: 'pop' },
  rato: { icon: '🐭', sound: 'squeak' },
  urso: { icon: '🧸', sound: 'pop' },
  bola: { icon: '⚽', sound: 'boing' },
  pato: { icon: '🦆', sound: 'quack' },
  balao: { icon: '🎈', sound: 'pop' },
  tenis: { icon: '👟', sound: 'boing' },
  banana: { icon: '🍌', sound: 'pop' },
};

const ui = {
  scene: $('scene'), world: $('world'), cat: $('cat'), beam: $('beam'), hint: $('hint'), lamp: $('lamp'),
  slots: [0, 1, 2, 3].map((i) => $(`slot-${i}`)), bubble: $('bubble'),
  ear: $('ear'), mute: $('mute'), cmds: $('cmds'), start: $('start'), tapResume: $('tap-resume'), tapHint: $('tap-hint'),
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
let focusX = MID;

// ---------- the room on screen ----------

// Each hiding spot is drawn in a 34 x 62 box, one SVG unit per room unit.
const FURNITURE = {
  porta: `
    <rect x="3" y="3" width="28" height="59" rx="1.5" fill="#6B4226"/>
    <rect x="5" y="5" width="24" height="57" fill="#1E1510"/>
    <g class="pane"><rect x="5" y="5" width="24" height="57" fill="#B0703F"/><rect x="8" y="9" width="18" height="20" rx="1.5" fill="none" stroke="#8E5530" stroke-width="1.2"/><rect x="8" y="33" width="18" height="24" rx="1.5" fill="none" stroke="#8E5530" stroke-width="1.2"/><circle cx="25" cy="35" r="1.7" fill="#E8B10E"/></g>`,
  armario: `
    <rect x="1" y="8" width="32" height="54" rx="2" fill="#7A4E2D"/>
    <rect x="0" y="5" width="34" height="5" rx="1.5" fill="#5E3B21"/>
    <rect x="3" y="11" width="28" height="49" fill="#2A1C12"/>
    <rect x="3" y="14" width="28" height="1" fill="#5E3B21"/>
    <path d="M9 15v3m-4 0h8l-2 10H7zM22 15v3m-4 0h8l-1 12h-6z" fill="#6FA8DC" stroke="#4F86C6" stroke-width=".5"/>
    <g class="leaf l"><rect x="3" y="11" width="14" height="49" fill="#A86B3C" stroke="#7A4E2D" stroke-width=".8"/><rect x="5.5" y="15" width="9" height="41" rx="1" fill="none" stroke="#8E5530" stroke-width=".8"/><circle cx="15" cy="36" r="1.2" fill="#E8B10E"/></g>
    <g class="leaf r"><rect x="17" y="11" width="14" height="49" fill="#A86B3C" stroke="#7A4E2D" stroke-width=".8"/><rect x="19.5" y="15" width="9" height="41" rx="1" fill="none" stroke="#8E5530" stroke-width=".8"/><circle cx="19" cy="36" r="1.2" fill="#E8B10E"/></g>`,
  cama: `
    <rect x="1" y="34" width="4.5" height="28" rx="1.5" fill="#8E5530"/>
    <rect x="28.5" y="42" width="4.5" height="20" rx="1.5" fill="#8E5530"/>
    <rect x="5" y="53" width="24" height="9" fill="#1E1510"/>
    <rect x="3" y="49" width="28" height="5" rx="1" fill="#A86B3C"/>
    <rect x="4" y="44" width="26" height="6" rx="2" fill="#FFFFFF"/>
    <g class="blanket"><path d="M11 43h19v9c-6 2-13 2-19 0z" fill="#4F86C6"/><path d="M14 46h3m4 0h3m-8 3h3m4 0h3" stroke="#BFD9F5" stroke-width="1.2" stroke-linecap="round"/></g>
    <rect x="5.5" y="40.5" width="7.5" height="4.5" rx="2.2" fill="#F4F4F4" stroke="#D9D9D9" stroke-width=".6"/>`,
  cortina: `
    <rect x="5" y="9" width="24" height="31" rx="1" fill="#F2E6CF"/>
    <rect x="7" y="11" width="20" height="27" fill="#1D2B55"/>
    <circle cx="21" cy="17" r="3.2" fill="#FFF3B0"/><circle cx="22.4" cy="16" r="2.8" fill="#1D2B55"/>
    <circle cx="11" cy="15" r=".6" fill="#fff"/><circle cx="14" cy="24" r=".5" fill="#fff"/><circle cx="24" cy="30" r=".6" fill="#fff"/>
    <rect x="17" y="11" width="1" height="27" fill="#F2E6CF"/><rect x="7" y="24" width="20" height="1" fill="#F2E6CF"/>
    <rect x="4" y="38.5" width="26" height="2" fill="#E4D3B0"/>
    <rect x="1" y="5.5" width="32" height="1.8" rx=".9" fill="#6B4226"/>
    <g class="half l"><path d="M2 7h15.5v55H2z" fill="#C8463C"/><path d="M6 8v54M10 8v54M14 8v54" stroke="#A63A31" stroke-width="1"/></g>
    <g class="half r"><path d="M16.5 7H32v55H16.5z" fill="#C8463C"/><path d="M20 8v54M24 8v54M28 8v54" stroke="#A63A31" stroke-width="1"/></g>`,
};

const spotX = (s) => SLOT_X[run.layout.indexOf(s)];
const slotOf = (s) => ui.slots[run.layout.indexOf(s)];
// where the cat (or its eyes) sits in a spot: out in front of the bed, inside the rest
const catY = (s) => (s === 'cama' ? FLOOR - 7 : FLOOR + 2);

function renderRoom() {
  ui.scene.dataset.room = run.room;
  run.layout.forEach((s, i) => {
    const el = ui.slots[i];
    el.className = `slot is-${s}`;
    el.dataset.spot = s;
    el.style.setProperty('--x', SLOT_X[i]);
    const item = run.items[s];
    el.innerHTML = `<svg class="furn" viewBox="0 0 34 62" aria-hidden="true">${FURNITURE[s]}</svg>${item ? `<div class="thing thing-${item}" aria-hidden="true">${ITEM[item].icon}</div>` : ''}`;
  });
  ui.cat.className = 'cat';
  moveCat(spotX(run.cat), catY(run.cat), 0);
  ui.hint.style.setProperty('--x', spotX(run.cat));
  ui.hint.style.setProperty('--y', catY(run.cat));
  ui.hint.classList.remove('on');
  ui.scene.classList.remove('lit');
  focus(MID, 0);
}

// Point the flashlight at x, and on narrow screens move the room so x is in view.
function focus(x, ms = 600, beam = true) {
  focusX = x;
  if (beam) {
    ui.beam.style.setProperty('--bx', x);
    ui.beam.style.setProperty('--by', x === MID ? BEAM_Y : x === spotX('cama') ? FLOOR + 12 : BEAM_Y);
  }
  pan(x, ms);
}

// Narrow screens (iPhone portrait) see part of the room: keep x in the middle.
function pan(x, ms) {
  const w = ui.world.offsetWidth;
  const view = ui.scene.clientWidth;
  const u = w / WORLD;
  const off = w <= view ? (view - w) / 2 : Math.min(0, Math.max(view - w, view / 2 - x * u));
  ui.world.style.transition = `transform ${ms}ms ease-in-out`;
  ui.world.style.transform = `translateX(${off}px)`;
}

// Left speaker for the left of the room, right for the right.
const panOf = (x) => (x - MID) / (WORLD / 2);

function restartClass(el, cls) {
  el.classList.remove(cls);
  void el.getBoundingClientRect(); // restart CSS animations
  el.classList.add(cls);
}

function clearFx() {
  for (const c of [...ui.scene.classList]) if (c.startsWith('fx-')) ui.scene.classList.remove(c);
  ui.hint.classList.remove('on');
  ui.slots.forEach((s) => s.classList.remove('wiggle', 'poke'));
}

let trotTimer = 0;
function moveCat(x, y, ms) {
  clearTimeout(trotTimer);
  ui.cat.classList.toggle('trotting', ms > 0);
  if (ms > 0) trotTimer = setTimeout(() => ui.cat.classList.remove('trotting'), ms);
  ui.cat.style.setProperty('--t', `${ms}ms`);
  ui.cat.style.setProperty('--x', x);
  ui.cat.style.setProperty('--y', y);
}

// Show one step; returns how long it takes.
function animate(fx, at) {
  clearFx();
  void ui.scene.getBoundingClientRect();
  ui.scene.classList.add(`fx-${fx}`);
  const ms = DUR[fx] || 800;
  const el = at && slotOf(at);
  const p = at ? panOf(spotX(at)) : 0;
  if (fx === 'light') {
    sfx.play('light');
    ui.scene.classList.add('lit');
  }
  if (fx === 'flicker') sfx.play('flicker');
  if (fx === 'meow') {
    // the hint: the meow from the cat's side, the spot wiggles, eyes (and a tail) peek out
    sfx.play('meow', p);
    document.body.dataset.meowPan = p.toFixed(2);
    focus(spotX(at), 600, false);
    el.classList.add('wiggle');
    ui.hint.classList.add('on');
  }
  // Once found, the cat tags along to whatever is looked at, so the camera
  // (which follows the action on phones) never leaves it behind.
  if (run.found && (fx === 'reveal' || fx === 'poke' || fx === 'purr')) {
    const x = spotX(at);
    moveCat(at === run.cat ? x : x + (x > MID ? -13 : 13), at === run.cat ? catY(at) : 3, 600);
  }
  if (fx === 'reveal' || fx === 'find') {
    focus(spotX(at));
    sfx.play(SPOT_SOUND[at], p);
    el.classList.add('open');
  }
  if (fx === 'reveal') setTimeout(() => sfx.play(ITEM[run.items[at]].sound, p), 550);
  if (fx === 'poke') {
    focus(spotX(at));
    el.classList.add('poke');
    sfx.play(ITEM[run.items[at]].sound, p);
  }
  if (fx === 'find') {
    setTimeout(() => {
      ui.cat.classList.add('found');
      sfx.play('meow', p);
    }, 450);
  }
  if (fx === 'purr') {
    focus(spotX(at));
    restartClass(ui.cat, 'purring');
    sfx.play('purr', p);
  }
  if (fx === 'come') {
    focus(MID);
    sfx.play('steps');
    ui.cat.classList.add('coming');
    moveCat(MID, 3, ms - 300);
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
  document.body.dataset.goal = g || '';
  document.body.dataset.runs = runs;
  document.body.dataset.cat = run.cat;
  document.body.dataset.found = run.found;
  document.body.dataset.lit = run.lit;
  for (const b of ui.cmds.children) b.classList.toggle('goal', b.dataset.cmd === g);
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
    pending = cmd; // the latest one wins
    return;
  }
  act(cmd);
}

function act(cmd) {
  if (phase !== 'play') return;
  const res = step(run, cmd);
  const was = run;
  run = res.run;
  busy = true;
  glow();
  dbg(`${cmd} -> ${res.fx}${res.at ? ` at ${res.at}` : ''} (goal ${goal(run) || '-'})`);
  const ms = animate(res.fx, res.at);
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

function party() {
  pending = null;
  setPhase('party');
  ui.cat.classList.add('dance');
  sfx.play('party');
  setTimeout(() => sfx.play('meow'), 500);
  confetti();
  clearTimeout(partyTimer);
  partyTimer = setTimeout(nextRun, PARTY_MS);
}

function nextRun() {
  runs++;
  run = newRun(run);
  dbg(`room ${runs}: ${run.layout.join(' ')}, cat in ${run.cat}`);
  ui.world.classList.add('fade');
  setTimeout(() => {
    clearFx();
    renderRoom();
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

// Interim results grow ("acende" -> "acende a luz" -> final), and on iOS one
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

ui.cmds.innerHTML = ORDER.map((c) => `<button type="button" class="cmd" data-cmd="${c}"><span class="ic" aria-hidden="true">${COMMANDS[c].icon}</span><span class="t"><span class="v">${COMMANDS[c].verb}</span> <span class="w">${COMMANDS[c].label}</span></span></button>`).join('');
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

addEventListener('resize', () => pan(focusX, 0));

if (!SR) showNote('Este navegador não consegue ouvir a fala (use Safari ou Chrome). Os botões funcionam assim mesmo.');
renderRoom();
setPhase('start');
