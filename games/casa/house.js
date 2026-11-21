// The dark room as pure state: where the cat hides, what the other spots hold,
// and what each command does. No failure state: a command that doesn't advance
// still shows something funny, and nothing ever closes again.

export const SPOTS = ['porta', 'armario', 'cama', 'cortina'];
export const ITEMS = ['meia', 'rato', 'urso', 'bola', 'pato', 'balao', 'tenis', 'banana'];
export const ROOMS = 4; // wall colours, cycled

const pick = (list, rnd) => list[Math.floor(rnd() * list.length)];

function shuffle(list, rnd) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// layout: the four spots left to right; cat: where it hides (never the same
// spot twice in a row); items: what the other three spots hold.
export function newRun(prev = null, rnd = Math.random) {
  const layout = shuffle(SPOTS, rnd);
  const cat = pick(SPOTS.filter((s) => s !== prev?.cat), rnd);
  const things = shuffle(ITEMS, rnd);
  const items = {};
  SPOTS.filter((s) => s !== cat).forEach((s, i) => (items[s] = things[i]));
  return { layout, cat, items, room: prev ? (prev.room + 1) % ROOMS : 0, lit: false, called: false, found: false, done: false, open: {}, n: 0 };
}

// The command that moves the run on: light, call (the meow says where), look
// there, call again and the cat comes. Null once the cat is out.
export function goal(run) {
  if (run.done) return null;
  if (!run.lit) return 'luz';
  if (!run.found) return run.called ? run.cat : 'gato';
  return 'gato';
}

// -> { run, fx, at }: the next state, the animation that shows it, and the
// spot it happens at (or null for the whole room).
export function step(run, cmd) {
  const r = { ...run, open: { ...run.open }, n: run.n + 1 };
  if (run.done) return { run: r, fx: 'none', at: null };
  if (cmd === 'luz') {
    if (run.lit) return { run: r, fx: 'flicker', at: null };
    return { run: { ...r, lit: true }, fx: 'light', at: null };
  }
  if (cmd === 'gato') {
    if (run.found) return { run: { ...r, done: true }, fx: 'come', at: run.cat };
    return { run: { ...r, called: true }, fx: 'meow', at: run.cat };
  }
  if (!SPOTS.includes(cmd)) return { run: r, fx: 'none', at: null };
  if (cmd === run.cat) {
    if (run.found) return { run: r, fx: 'purr', at: cmd };
    r.open[cmd] = true;
    return { run: { ...r, found: true }, fx: 'find', at: cmd };
  }
  if (run.open[cmd]) return { run: r, fx: 'poke', at: cmd };
  r.open[cmd] = true;
  return { run: r, fx: 'reveal', at: cmd };
}
