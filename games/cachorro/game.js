import { COMMANDS, GRAMMAR, ORDER, spot } from './commands.js';
import { atBone, goal, newRun, obstacle, step } from './yard.js';
import * as sfx from './sfx.js';
import { dbg, initDebug, readFlags } from '../../lib/voice/debug.js';
import { createEar } from '../../lib/voice/ear.js';

const $ = (id) => document.getElementById(id);
const FLAGS = readFlags(location.search);

const SAME_CMD_MS = 700; // the same word again this soon is the recognizer repeating itself
const PARTY_MS = 3800;

// World layout, in units of --u (see style.css). The yard is 190 wide.
const WORLD = 190;
const SLOT_X = [50, 115];
const BONE_X = 172;
const DUR = { run: 1100, hop: 950, splash: 1600, bonk: 950, 'open-bark': 1600, 'open-key': 1500, bone: 1000, zoom: 1100, jump: 750, bark: 900, spin: 900, sit: 1400, lie: 1600 };
const SOUND = { run: 'steps', hop: 'boing', splash: 'splash', bonk: 'bonk', 'open-bark': 'woof', 'open-key': 'jingle', bone: 'chomp', zoom: 'zoom', jump: 'boing', bark: 'woof', spin: 'spin', sit: 'sit', lie: 'lie' };

const ui = {
  scene: $('scene'), world: $('world'), dog: $('dog'), bone: $('bone'), slots: [$('slot-1'), $('slot-2')], bubble: $('bubble'),
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

// ---------- the yard on screen ----------

const PUDDLE = '<svg class="puddle" viewBox="0 0 120 30" aria-hidden="true"><ellipse cx="60" cy="16" rx="58" ry="13" fill="#5BA8E6"/><ellipse cx="60" cy="14" rx="46" ry="8" fill="#8FCBF5"/><ellipse class="ripple" cx="48" cy="14" rx="12" ry="3" fill="none" stroke="#fff" stroke-width="2"/></svg>';

const GATE = (key) => `
  <div class="helper" aria-hidden="true"><svg viewBox="0 0 60 70"><circle cx="30" cy="30" r="22" fill="#F1C7A0"/><path d="M8 26q4-22 22-22t22 22q-8-12-22-12T8 26z" fill="#4A3426"/><circle cx="22" cy="30" r="3" fill="#2B2B2B"/><circle cx="38" cy="30" r="3" fill="#2B2B2B"/><path d="M21 40q9 8 18 0" fill="none" stroke="#2B2B2B" stroke-width="2.5" stroke-linecap="round"/><rect x="10" y="50" width="40" height="20" rx="8" fill="#3E86D6"/></svg><span class="wave">👋</span></div>
  <svg class="gate" viewBox="0 0 70 110" aria-hidden="true">
    <rect x="0" y="6" width="10" height="104" rx="3" fill="#8B5A2B"/>
    <rect x="60" y="6" width="10" height="104" rx="3" fill="#8B5A2B"/>
    <g class="door">${[14, 26, 38, 50].map((x) => `<rect x="${x}" y="22" width="9" height="84" rx="4" fill="#E9D3A6" stroke="#B9935C" stroke-width="1.5"/>`).join('')}<rect x="12" y="40" width="48" height="7" fill="#C9A66B"/><rect x="12" y="80" width="48" height="7" fill="#C9A66B"/></g>
  </svg>
  ${key ? '<svg class="key" viewBox="0 0 40 20" aria-hidden="true"><circle cx="8" cy="10" r="6" fill="none" stroke="#E8B10E" stroke-width="4"/><path d="M14 10h22m-6 0v7m6-7v6" fill="none" stroke="#E8B10E" stroke-width="4" stroke-linecap="round"/></svg>' : ''}`;

function renderYard() {
  run.order.forEach((ob, i) => {
    const el = ui.slots[i];
    el.className = `slot is-${ob}`;
    el.style.setProperty('--x', SLOT_X[i]);
    el.innerHTML = ob === 'puddle' ? PUDDLE : GATE(run.gate === 'key');
  });
  ui.bone.style.setProperty('--x', BONE_X);
  ui.bone.classList.remove('taken');
  ui.dog.classList.remove('has-bone', 'has-key', 'muddy', 'dance');
  moveDog(0);
}

function dogX() {
  if (run.at === 0) return 14;
  if (atBone(run)) return BONE_X - 24;
  const x = SLOT_X[run.at - 1];
  return obstacle(run) === 'puddle' && run.cleared ? x + 22 : x - 24;
}

function moveDog(ms) {
  const x = dogX();
  ui.dog.style.setProperty('--t', `${ms}ms`);
  ui.dog.style.setProperty('--x', x);
  pan(x, ms);
}

// Narrow screens (iPhone portrait) see part of the yard: follow the dog, a bit ahead.
function pan(x, ms) {
  const w = ui.world.offsetWidth;
  const view = ui.scene.clientWidth;
  const u = w / WORLD;
  const off = w <= view ? (view - w) / 2 : Math.min(0, Math.max(view - w, view * 0.4 - x * u));
  ui.world.style.transition = `transform ${ms}ms ease-in-out`;
  ui.world.style.transform = `translateX(${off}px)`;
}

function slotEl() {
  return ui.slots[run.at - 1];
}

function restartClass(el, cls) {
  el.classList.remove(cls);
  void el.getBoundingClientRect(); // restart CSS animations
  el.classList.add(cls);
}

// Show one step; returns how long it takes.
function clearFx() {
  for (const c of [...ui.dog.classList]) if (c.startsWith('fx-')) ui.dog.classList.remove(c);
}

function animate(fx) {
  const d = ui.dog;
  clearFx();
  void d.getBoundingClientRect();
  d.classList.add(`fx-${fx}`);
  d.classList.toggle('muddy', run.mud); // not 'mud': that's the spots inside the SVG, hidden by default
  sfx.play(SOUND[fx]);
  const ms = DUR[fx] || 800;
  if (fx === 'run' || fx === 'hop') moveDog(fx === 'hop' ? ms * 0.8 : ms);
  if (fx === 'open-bark') {
    const s = slotEl();
    setTimeout(() => s.classList.add('helping'), 450);
    setTimeout(() => {
      s.classList.add('open');
      sfx.play('creak');
    }, 900);
  }
  if (fx === 'open-key') {
    const s = slotEl();
    setTimeout(() => {
      s.classList.add('key-taken');
      d.classList.add('has-key');
    }, 350);
    setTimeout(() => {
      s.classList.add('open');
      d.classList.remove('has-key');
      sfx.play('creak');
    }, 900);
  }
  if (fx === 'bone') {
    setTimeout(() => {
      ui.bone.classList.add('taken');
      d.classList.add('has-bone');
    }, 380);
  }
  if (fx === 'splash') restartClass(slotEl(), 'splashing');
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
  document.body.dataset.at = run.at;
  document.body.dataset.runs = runs;
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
    pending = cmd; // the latest one wins; the dog can't do five things at once
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
  dbg(`${cmd} -> ${res.fx} (at ${run.at}${run.cleared ? '' : ', blocked'}, goal ${goal(run) || '-'})`);
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

function party() {
  pending = null;
  setPhase('party');
  ui.dog.classList.add('dance');
  sfx.play('party');
  confetti();
  clearTimeout(partyTimer);
  partyTimer = setTimeout(nextRun, PARTY_MS);
}

function nextRun() {
  runs++;
  run = newRun(run);
  dbg(`run ${runs}: ${run.order.join(' → ')}, gate ${run.gate}`);
  ui.world.classList.add('fade');
  setTimeout(() => {
    clearFx();
    renderYard();
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

addEventListener('resize', () => pan(dogX(), 0));

if (!ear.supported) showNote('Este navegador não consegue ouvir a fala (use Safari ou Chrome). Os botões funcionam assim mesmo.');
renderYard();
setPhase('start');
