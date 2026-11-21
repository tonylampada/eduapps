import { GRAMMAR, key, spot } from './words.js';
import { FEEDS, goalPlate, give, label, newGame, next, plateKey, resolve } from './kitchen.js';
import { MONSTER, foodSVG } from './art.js';
import * as sfx from './sfx.js';
import { dbg, initDebug, readFlags } from '../../lib/voice/debug.js';
import { createEar } from '../../lib/voice/ear.js';

const $ = (id) => document.getElementById(id);
const FLAGS = readFlags(location.search);

const SAME_CMD_MS = 700; // the same request again this soon is the recognizer repeating itself
const PARTY_MS = 3800;
const FLY_MS = 520;
const LEVEL_KEY = 'eduapps.monstro.level';

const ui = {
  scene: $('scene'), monster: $('monster'), wish: $('wish'), dots: $('dots'), bubble: $('bubble'),
  ear: $('ear'), mute: $('mute'), cmds: $('cmds'), start: $('start'), tapResume: $('tap-resume'), tapHint: $('tap-hint'),
  note: $('note'), confetti: $('confetti'),
};

let state = newGame(loadLevel());
let phase = 'start'; // start | play | party
let busy = false;
let pending = null;
let lastVoice = { key: '', at: 0 };
let fired = 0;

// ---------- level, kept between visits ----------

function loadLevel() {
  try {
    return localStorage.getItem(LEVEL_KEY) === '3' ? 3 : 2;
  } catch {
    return 2; // private mode / storage blocked
  }
}

function saveLevel(level) {
  try {
    localStorage.setItem(LEVEL_KEY, String(level));
  } catch {
    // not saved: the start screen just won't remember
  }
}

// ---------- the kitchen on screen ----------

function renderTable(pop = false) {
  ui.cmds.dataset.level = state.level;
  ui.cmds.innerHTML = state.table
    .map((f, i) => `<button type="button" class="cmd${pop ? ' pop' : ''}" data-i="${i}" data-key="${plateKey(f)}"><span class="plate">${foodSVG(f.item, f.color)}</span><span class="w">${label(f, state.level)}</span></button>`)
    .join('');
}

function renderWish() {
  ui.wish.querySelector('.wish-food').innerHTML = foodSVG(state.want.item, state.want.color);
  restartClass(ui.wish, 'new');
}

function renderDots() {
  ui.dots.innerHTML = Array.from({ length: FEEDS }, (_, i) => `<i class="${i < state.fed ? 'full' : ''}">★</i>`).join('');
}

function renderSize() {
  ui.monster.style.setProperty('--g', Math.min(1.24, 1 + 0.08 * state.grown).toFixed(2));
}

function renderAll(pop) {
  renderTable(pop);
  renderWish();
  renderDots();
  renderSize();
  glow();
}

function restartClass(el, cls) {
  el.classList.remove(cls);
  void el.getBoundingClientRect(); // restart CSS animations
  el.classList.add(cls);
}

function setFx(fx) {
  for (const c of [...ui.monster.classList]) if (c.startsWith('fx-')) ui.monster.classList.remove(c);
  if (fx) {
    void ui.monster.getBoundingClientRect();
    ui.monster.classList.add(`fx-${fx}`);
  }
}

function setPhase(p) {
  phase = p;
  document.body.dataset.phase = p;
  glow();
}

function glow() {
  const g = phase === 'play' && !busy ? goalPlate(state) : -1;
  const b = document.body.dataset;
  b.goal = g >= 0 ? plateKey(state.want) : '';
  b.wish = label(state.want, state.level);
  b.level = state.level;
  b.fed = state.fed;
  b.grown = state.grown;
  b.table = state.table.map(plateKey).join(',');
  [...ui.cmds.children].forEach((el, i) => el.classList.toggle('goal', i === g));
}

// ---------- food flying between a plate and the mouth ----------

function center(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

// from plate i to the mouth (back: from the mouth to plate i), in an arc.
function fly(i, back) {
  const plate = ui.cmds.children[i];
  const food = state.table[i];
  if (!plate || !food) return;
  const p = center(plate.querySelector('.food'));
  const m = center(ui.monster.querySelector('.mouth-target'));
  const el = document.createElement('div');
  el.className = 'flying';
  el.innerHTML = foodSVG(food.item, food.color);
  Object.assign(el.style, { left: `${p.x - p.w / 2}px`, top: `${p.y - p.h / 2}px`, width: `${p.w}px`, height: `${p.h}px` });
  document.body.append(el);
  const dx = m.x - p.x;
  const dy = m.y - p.y;
  const at = (t, s, r) => ({ transform: `translate(${dx * t}px, ${dy * t - Math.sin(Math.PI * t) * 120}px) scale(${s}) rotate(${r}deg)` });
  const frames = [at(0, 1, 0), at(0.5, 0.9, 200), at(1, 0.45, 360)];
  const anim = el.animate(back ? frames.reverse() : frames, { duration: FLY_MS, easing: back ? 'ease-out' : 'ease-in', fill: 'forwards' });
  anim.onfinish = () => el.remove();
  setTimeout(() => el.remove(), FLY_MS + 100); // in case animations never finish (hidden tab)
}

// ---------- requests ----------

// req: { item, color } spoken, or a plate tapped.
function fire(req, src) {
  if (phase !== 'play') return false;
  const k = key(req);
  const r = resolve(state, req);
  if (r === null) {
    dbg(`${k}: not on the table`);
    return false;
  }
  if (src === 'voice') {
    const now = Date.now();
    if (lastVoice.key === k && now - lastVoice.at < SAME_CMD_MS) return dbg(`skip ${k}: said again too soon`), false;
    lastVoice = { key: k, at: now };
  }
  fired++;
  document.body.dataset.fired = fired;
  dbg(`fire ${k} (${src})${busy ? ' — queued' : ''}`);
  if (r !== 'which') restartClass(ui.cmds.children[r], 'pressed');
  if (busy) {
    pending = req; // the latest one wins: one mouthful at a time
    return true;
  }
  act(req);
  return true;
}

// Run a little timeline of [ms, fn]; then free the monster.
function timeline(steps, total, then) {
  busy = true;
  glow();
  steps.forEach(([t, f]) => setTimeout(f, t));
  setTimeout(() => {
    busy = false;
    setFx(null);
    then?.();
    if (phase !== 'play') return;
    glow();
    if (pending) {
      const p = pending;
      pending = null;
      if (resolve(state, p) !== null) act(p);
    }
  }, total);
}

function act(req) {
  const r = resolve(state, req);
  if (r === null) return;
  if (r === 'which') {
    dbg(`which ${req.item}? (no color)`);
    const plates = [...ui.cmds.children].filter((_, i) => state.table[i].item === req.item);
    plates.forEach((el) => restartClass(el, 'wiggle'));
    sfx.play('hmm');
    setFx('which');
    return timeline([], 1100, () => plates.forEach((el) => el.classList.remove('wiggle')));
  }
  const res = give(state, r);
  const was = state;
  state = res.state;
  dbg(`${plateKey(was.table[r])} -> ${res.fx} (fed ${state.fed}/${FEEDS}, level ${state.level})`);
  const plate = ui.cmds.children[r];
  plate.classList.add('away');
  setFx('open');
  sfx.play('whoosh');
  fly(r, false);
  if (res.fx === 'spit') {
    return timeline(
      [
        [FLY_MS, () => (setFx('yuck'), sfx.play('yuck'))],
        [1050, () => (sfx.play('ptui'), fly(r, true))],
        [1050 + FLY_MS, () => (plate.classList.remove('away'), restartClass(plate, 'landed'), sfx.play('boing'))],
      ],
      1900,
    );
  }
  timeline(
    [
      [FLY_MS, () => (setFx('chew'), sfx.play('chomp'))],
      [FLY_MS + 350, () => sfx.play('munch')],
      [1150, () => (setFx('happy'), sfx.play('yum'), renderDots())],
    ],
    2100,
    () => (res.fx === 'grow' ? party() : nextWish()),
  );
}

function nextWish() {
  const before = state.table.map(plateKey).join();
  state = next(state);
  const changed = state.table.map(plateKey).join() !== before;
  if (changed) renderTable(true);
  else for (const el of ui.cmds.querySelectorAll('.away')) el.classList.remove('away'), restartClass(el, 'pop'), sfx.play('pop');
  renderWish();
  dbg(`wish: ${label(state.want, state.level)}`);
}

function party() {
  pending = null;
  setPhase('party');
  state = next(state); // the next level: bigger monster, new table
  saveLevel(state.level);
  renderSize();
  setFx('grow');
  sfx.play('grow');
  confetti();
  dbg(`grew (${state.grown}); level ${state.level}`);
  setTimeout(() => {
    setFx(null);
    renderAll(true);
    setPhase('play');
  }, PARTY_MS);
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

// At level 3 "dá a maçã" may still grow into "dá a maçã verde": until the
// result is final, hold back a colorless request that runs to the end of it.
function requests(text, final) {
  const reqs = spot(text);
  const last = reqs[reqs.length - 1];
  if (!final && state.level >= 3 && last && last.open && !last.color) reqs.pop();
  return reqs;
}

// ---------- ear: always listening (lib/voice/ear.js) ----------

function showNote(text) {
  ui.note.textContent = text;
  ui.note.hidden = false;
}

if (FLAGS.debug) initDebug(debugStatus); // before the ear, so the model load is logged

const ear = createEar({
  sfx,
  spot: requests,
  heard: (text, fresh) => {
    const acted = fresh.map((r) => fire(r, 'voice'));
    showHeard(text, acted.some(Boolean));
  },
  note: showNote,
  grammar: GRAMMAR,
  ui: { ear: ui.ear, tapResume: ui.tapResume, tapHint: ui.tapHint },
});

// ---------- debug (?debug) ----------

function debugStatus() {
  return [
    phase,
    `level ${state.level}, fed ${state.fed}/${FEEDS}, wish ${label(state.want, state.level)}`,
    ...ear.status(),
  ].join(' · ');
}

// ---------- wiring ----------

if (FLAGS.debug) ear.debugEnv();

ui.monster.querySelector('.mon-move').innerHTML = MONSTER;
ui.start.querySelector('.start-mon').innerHTML = MONSTER;
ui.start.querySelector('[data-food=banana]').innerHTML = foodSVG('banana', 'amarelo');
ui.start.querySelector('[data-food=maca]').innerHTML = foodSVG('maca', 'vermelho');
ui.start.querySelector(`[data-level="${state.level}"]`).classList.add('saved');

ui.cmds.addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (b) fire(state.table[Number(b.dataset.i)], 'tap');
});

ui.start.addEventListener('click', (e) => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  sfx.unlock();
  ear.begin();
  state = newGame(Number(b.dataset.level));
  saveLevel(state.level);
  dbg(`level ${state.level}; wish: ${label(state.want, state.level)}`);
  ui.start.hidden = true;
  renderAll(false);
  setPhase('play');
});

// Any tap (the whole screen when the mic is down) restarts the mic inside the gesture.
document.addEventListener('click', (e) => {
  if (ui.start.contains(e.target)) return;
  ear.tapped();
});

ui.mute.addEventListener('click', () => {
  const m = ui.mute.getAttribute('aria-pressed') !== 'true';
  sfx.setMuted(m);
  ui.mute.setAttribute('aria-pressed', String(m));
  ui.mute.setAttribute('aria-label', m ? 'Sons desligados' : 'Sons ligados');
});

if (!ear.supported) showNote('Este navegador não consegue ouvir a fala (use Safari ou Chrome). Os pratos funcionam assim mesmo.');
renderAll(false);
setPhase('start');
