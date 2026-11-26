import { say } from '../../lib/voice/say.js';
import { COMMANDS, GRAMMAR, ORDER, ARM_MS, createCombiner, flashNear, spot } from './commands.js';
import { FINISH, OB_X, goal, newRace, step } from './track.js';
import { createHiss } from './hiss.js';
import * as sfx from './sfx.js';
import * as meter from '../../lib/voice/meter.js';
import { dbg, initDebug, readFlags } from '../../lib/voice/debug.js';
import { createEar } from '../../lib/voice/ear.js';
import { engineBadge, tapActs } from '../../lib/voice/badge.js';

const $ = (id) => document.getElementById(id);
const FLAGS = readFlags(location.search);

const SAME_CMD_MS = 700; // the same command again this soon is the recognizer repeating itself
const PARTY_MS = 3800;
const WORLD = 380; // track units (style.css --u)

const DUR = { jog: 900, zoom: 1100, bump: 700, hop: 900, superhop: 1300, jump: 700, superjump: 1100, stop: 1100, wave: 600 };
const SOUND = { jog: 'steps', zoom: 'whoosh', bump: 'bump', hop: 'boing', superhop: 'superboing', jump: 'boing', superjump: 'superboing', stop: 'brake', wave: 'wave' };
// share of the action the hero spends moving along the track
const MOVE = { jog: 1, zoom: 0.75, hop: 0.85, superhop: 0.85 };
const SPEED = new Set(['zoom']);

const ui = {
  scene: $('scene'), world: $('world'), hills: $('hills'), hero: $('hero'), car: $('car'), obs: [$('ob-0'), $('ob-1'), $('ob-2')],
  finish: $('finish'), trophy: $('trophy'), bubble: $('bubble'), ear: $('ear'), mute: $('mute'), cmds: $('cmds'), start: $('start'),
  tapResume: $('tap-resume'), tapHint: $('tap-hint'), note: $('note'), confetti: $('confetti'),
};

let race = newRace();
let runs = 0;
let phase = 'start'; // start | play | party
let busy = false;
let pending = null;
let lastVoice = { cmd: '', at: 0 };
let fired = 0;
let hisses = 0;
let noisyUntil = 0; // our own whoosh is a hiss too: the detector sits it out
let partyTimer = 0;
let chargeTimer = 0;
const combine = createCombiner();

// ---------- the track on screen ----------

const OBSTACLE = {
  cone: '<svg viewBox="0 0 40 44" aria-hidden="true"><path d="M20 2 34 38H6z" fill="#FF7A1A"/><path d="M14.5 17h11l2.5 7h-16zM10.6 28h18.8l2.2 6H8.4z" fill="#fff"/><rect x="2" y="37" width="36" height="6" rx="2" fill="#E0600A"/></svg>',
  puddle: '<svg viewBox="0 0 60 20" aria-hidden="true"><ellipse cx="30" cy="11" rx="29" ry="8.5" fill="#5BA8E6"/><ellipse cx="30" cy="9.5" rx="22" ry="5" fill="#8FCBF5"/><ellipse class="ripple" cx="24" cy="9.5" rx="6" ry="1.8" fill="none" stroke="#fff" stroke-width="1.5"/></svg>',
  hurdle: '<svg viewBox="0 0 44 40" aria-hidden="true"><rect x="4" y="8" width="5" height="32" rx="2" fill="#8B5A2B"/><rect x="35" y="8" width="5" height="32" rx="2" fill="#8B5A2B"/><rect x="0" y="8" width="44" height="10" rx="3" fill="#fff" stroke="#C8463C" stroke-width="1.5"/><path d="M6 8h6l-4 10H2zM20 8h6l-4 10h-6zM34 8h6l-4 10h-6z" fill="#C8463C"/></svg>',
};

function renderTrack() {
  race.order.forEach((kind, i) => {
    const el = ui.obs[i];
    el.className = `ob is-${kind}`;
    el.style.setProperty('--x', OB_X[i]);
    el.innerHTML = OBSTACLE[kind];
  });
  ui.finish.style.setProperty('--x', FINISH);
  ui.trophy.style.setProperty('--x', FINISH + 18);
  ui.trophy.classList.remove('won');
  ui.hero.classList.remove('dance');
  place(0);
}

function place(ms, carMs = ms) {
  ui.hero.style.setProperty('--t', `${ms}ms`);
  ui.hero.style.setProperty('--x', race.x);
  ui.car.style.setProperty('--t', `${carMs}ms`);
  ui.car.style.setProperty('--x', race.car);
  race.cleared.forEach((c, i) => ui.obs[i].classList.toggle('cleared', c));
  pan(race.x, ms);
  document.body.dataset.at = Math.round(race.x);
  document.body.dataset.car = Math.round(race.car);
}

// The camera follows the hero, a bit behind the middle so the road ahead shows.
function pan(x, ms) {
  const w = ui.world.offsetWidth;
  const view = ui.scene.clientWidth;
  const u = w / WORLD;
  const off = w <= view ? (view - w) / 2 : Math.min(0, Math.max(view - w, view * 0.3 - x * u));
  for (const [el, k] of [[ui.world, 1], [ui.hills, 0.3]]) {
    el.style.transition = `transform ${ms}ms ease-in-out`;
    el.style.transform = `translateX(${off * k}px)`;
  }
}

function restartClass(el, cls) {
  el.classList.remove(cls);
  void el.getBoundingClientRect(); // restart CSS animations
  el.classList.add(cls);
}

function clearFx() {
  for (const c of [...ui.hero.classList]) if (c.startsWith('fx-')) ui.hero.classList.remove(c);
  document.body.classList.remove('speed');
}

// Show one step; returns how long it takes.
function animate(fx) {
  clearFx();
  void ui.hero.getBoundingClientRect();
  ui.hero.classList.add(`fx-${fx}`);
  document.body.dataset.fx = fx;
  const ms = DUR[fx] || 800;
  sfx.play(SOUND[fx]);
  if (SPEED.has(fx)) {
    document.body.classList.add('speed');
    noisyUntil = performance.now() + ms + 500;
  }
  if (fx === 'stop') setTimeout(() => sfx.play('vroom'), 200);
  place(ms * (MOVE[fx] || 0), fx === 'stop' ? ms * 0.9 : ms * 1.1);
  return ms;
}

function setPhase(p) {
  phase = p;
  document.body.dataset.phase = p;
  glow();
}

function glow() {
  const g = phase === 'play' && !busy ? goal(race) : null;
  document.body.dataset.goal = g || '';
  document.body.dataset.runs = runs;
  document.body.dataset.order = race.order.join(' ');
  for (const b of ui.cmds.children) b.classList.toggle('goal', b.dataset.cmd === g);
}

// ---------- commands ----------

function fire(cmd, src) {
  if (phase === 'start') return dbg(`skip ${cmd} (${src}): not started`);
  if (src === 'voice') {
    const now = Date.now();
    if (lastVoice.cmd === cmd && now - lastVoice.at < SAME_CMD_MS) return dbg(`skip ${cmd}: said again ${now - lastVoice.at} ms after the last one`);
    lastVoice = { cmd, at: now };
  }
  fired++;
  document.body.dataset.fired = fired;
  dbg(`fire ${cmd} (${src})${busy ? ` — queued, he is busy${pending ? ` (replaces queued ${pending})` : ''}` : ''}`);
  const b = ui.cmds.querySelector(`[data-cmd=${cmd}]`);
  if (b) restartClass(b, 'pressed');
  if (busy) {
    pending = cmd; // the latest one wins; "corre ... Flash" turns a queued corre into Flash corre
    return;
  }
  act(cmd);
}

function act(cmd) {
  const was = race;
  const res = step(race, cmd);
  race = res.race;
  busy = true;
  glow();
  dbg(`${cmd} -> ${res.fx} (x ${Math.round(race.x)}, car ${Math.round(race.car)}, goal ${goal(race) || '-'})`);
  const ms = animate(res.fx);
  setTimeout(() => {
    busy = false;
    clearFx();
    if (race.done && !was.done) return party();
    glow();
    if (pending) {
      const c = pending;
      pending = null;
      act(c);
    }
  }, ms);
}

// "Flash" heard on its own: he gets ready (the bolt glows) for the verb.
function charge() {
  ui.hero.classList.add('charged');
  clearTimeout(chargeTimer);
  chargeTimer = setTimeout(() => ui.hero.classList.remove('charged'), ARM_MS);
}

function party() {
  pending = null;
  setPhase('party');
  ui.hero.classList.add('dance');
  ui.hero.classList.remove('charged');
  ui.trophy.classList.add('won');
  sfx.play('party');
  confetti();
  // the car gets there too, after him
  setTimeout(() => {
    race = { ...race, car: FINISH - 14 };
    place(0, 1400);
    sfx.play('vroom');
  }, 900);
  clearTimeout(partyTimer);
  partyTimer = setTimeout(nextRace, PARTY_MS);
}

function nextRace() {
  runs++;
  race = newRace(race);
  dbg(`race ${runs}: ${race.order.join(' → ')}`);
  ui.world.classList.add('fade');
  setTimeout(() => {
    clearFx();
    renderTrack();
    ui.world.classList.remove('fade');
    setPhase('play');
  }, 350);
}

function confetti() {
  const colors = ['#F5B82E', '#EF6F86', '#3E86D6', '#2E9E5B', '#D7262E', '#FF8A3D'];
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

function showNote(text) {
  ui.note.textContent = text;
  ui.note.hidden = false;
}

// ---------- ear: always listening (lib/voice/ear.js) ----------

if (FLAGS.debug) initDebug(debugStatus); // before the ear, so the model load is logged

const ear = createEar({
  sfx,
  spot,
  heard: (text, fresh, items) => {
    showHeard(text, fresh.length > 0);
    if (phase === 'start') return;
    const from = items.length - fresh.length; // fresh is the tail of items
    for (let k = from; k < items.length; k++) {
      const w = items[k];
      const near = w === 'flash' ? {} : flashNear(items, k);
      const a = combine(w, Date.now(), near);
      dbg(`combine ${w}@${k}${near.before ? ' flash-before' : ''}${near.after ? ' flash-after' : ''} -> ${a ? `${a.cmd} (${a.why})` : 'armed, waiting for the verb'}`);
      if (a) fire(a.cmd, 'voice');
      else charge();
      if (near.after) k++; // that "flash" is this verb's: it doesn't arm the next one
    }
  },
  note: showNote,
  grammar: GRAMMAR,
  ui: { ear: ui.ear, tapResume: ui.tapResume, tapHint: ui.tapHint },
});

// The "chhhhh": from the mic's sound, once the meter has the stream.
let hiss = null;
function hissOn() {
  if (hiss || !sfx.context()) return;
  hiss = createHiss({
    ctx: sfx.context(),
    stream: meter.getStream,
    quiet: () => performance.now() < noisyUntil,
    log: dbg,
    onHiss: () => {
      document.body.dataset.hiss = ++hisses;
      showHeard('chhhhh', true);
      fire('super', 'hiss');
    },
  });
}

// ---------- debug (?debug) ----------

function debugStatus() {
  return [phase, `goal ${goal(race) || '-'}`, hiss ? hiss.status() : 'hiss off', ...ear.status()].join(' · ');
}

// ---------- wiring ----------

if (FLAGS.debug) ear.debugEnv();

ui.cmds.innerHTML = ORDER.map((c) => `<button type="button" class="cmd${c.startsWith('super') ? ' flash' : ''}" data-cmd="${c}"><span class="ic" aria-hidden="true">${COMMANDS[c].icon}</span><span class="w">${COMMANDS[c].label}</span></button>`).join('');
// A button says its words out loud; with "Botões fazem a ação" on it also plays them.
ui.cmds.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  say(COMMANDS[b.dataset.cmd].label, sfx.context());
  if (tapActs()) fire(b.dataset.cmd, 'tap');
});

ui.start.addEventListener('click', () => {
  sfx.unlock();
  ui.start.hidden = true;
  badge.remove();
  setPhase('play');
  ear.begin();
  hissOn();
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

addEventListener('resize', () => pan(race.x, 0));

if (!ear.supported) showNote('Este navegador não consegue ouvir a fala (use Safari ou Chrome). O “chhhhh” ainda funciona.');
renderTrack();
setPhase('start');

const badge = engineBadge(ear.engine);
ui.start.after(badge);
