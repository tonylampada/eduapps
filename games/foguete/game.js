import { COMMANDS, GRAMMAR, ORDER, spot } from './commands.js';
import { PAD, goal, newRun, obstacle, step, turnGreen } from './trip.js';
import * as sfx from './sfx.js';
import { dbg, initDebug, readFlags } from '../../lib/voice/debug.js';
import { createEar } from '../../lib/voice/ear.js';

const $ = (id) => document.getElementById(id);
const FLAGS = readFlags(location.search);

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

// ---------- ear: always listening (lib/voice/ear.js) ----------

function showNote(text) {
  ui.note.textContent = text;
  ui.note.hidden = false;
}

if (FLAGS.debug) initDebug(debugStatus); // before the ear, so the model load is logged

const ear = createEar({
  sfx,
  spot: spot,
  heard: (text, fresh) => {
    showHeard(text, fresh.length > 0);
    fresh.forEach((c) => fire(c, 'voice'));
  },
  note: showNote,
  grammar: GRAMMAR,
  ui: { ear: ui.ear, tapResume: ui.tapResume, tapHint: ui.tapHint },
});

// ---------- debug (?debug) ----------

function debugStatus() {
  return [
    phase,
    `goal ${goal(run) || '-'}`,
    ...ear.status(),
  ].join(' · ');
}

// ---------- wiring ----------

if (FLAGS.debug) ear.debugEnv();

ui.cmds.innerHTML = ORDER.map((c) => `<button type="button" class="cmd" data-cmd="${c}"><span class="ic" aria-hidden="true">${COMMANDS[c].icon}</span><span class="w">${COMMANDS[c].label}</span></button>`).join('');
ui.cmds.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) fire(b.dataset.cmd, 'tap');
});

ui.start.addEventListener('click', () => {
  sfx.unlock();
  ui.start.hidden = true;
  setPhase('play');
  ear.begin();
});

// Any tap (the whole screen when the mic is down) restarts the mic inside the gesture.
document.addEventListener('click', (e) => {
  if (e.target === ui.start || ui.start.contains(e.target)) return;
  ear.tapped();
});

ui.mute.addEventListener('click', () => {
  const m = ui.mute.getAttribute('aria-pressed') !== 'true';
  sfx.setMuted(m);
  ui.mute.setAttribute('aria-pressed', String(m));
  ui.mute.setAttribute('aria-label', m ? 'Sons desligados' : 'Sons ligados');
});

addEventListener('resize', () => pan(rideX(), 0));

if (!ear.supported) showNote('Este navegador não consegue ouvir a fala (use Safari ou Chrome). Os botões funcionam assim mesmo.');
renderRoad();
setPhase('start');
