// The kitchen as pure state: what the monster wants, what is on the table,
// and what giving it a plate does. No failure state: the wrong food is spat
// back onto its plate and the monster keeps waiting for the same thing.

export const FEEDS = 5; // per level: then he grows
export const MAX_LEVEL = 3;

// fem: for the color word's ending ("maçã vermelha", "bolo vermelho").
// base: the color at level 2. pair: the two colors on the table at level 3.
export const FOODS = {
  banana: { label: 'banana', fem: true, base: 'amarelo', pair: ['amarelo', 'verde'] },
  maca: { label: 'maçã', fem: true, base: 'vermelho', pair: ['vermelho', 'verde'] },
  uva: { label: 'uva', fem: true, base: 'roxo', pair: ['roxo', 'verde'] },
  pao: { label: 'pão', fem: false, base: 'pao', pair: null },
  bolo: { label: 'bolo', fem: false, base: 'rosa', pair: ['rosa', 'marrom'] },
  cenoura: { label: 'cenoura', fem: true, base: 'laranja', pair: ['laranja', 'roxo'] },
};
export const FOOD_ORDER = ['banana', 'maca', 'uva', 'pao', 'bolo', 'cenoura'];

const COLOR_WORD = {
  vermelho: ['vermelho', 'vermelha'],
  verde: ['verde', 'verde'],
  amarelo: ['amarelo', 'amarela'],
  roxo: ['roxo', 'roxa'],
  laranja: ['laranja', 'laranja'],
  rosa: ['rosa', 'rosa'],
  marrom: ['marrom', 'marrom'],
};

// "maçã vermelha" at level 3, "maçã" at level 2.
export function label(food, level) {
  const f = FOODS[food.item];
  return level >= 3 && COLOR_WORD[food.color] ? `${f.label} ${COLOR_WORD[food.color][f.fem ? 1 : 0]}` : f.label;
}

export const plateKey = (food) => `${food.item}:${food.color}`;

function shuffle(a, rnd) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const same = (a, b) => !!a && !!b && a.item === b.item && a.color === b.color;

// A new wish (never the last one again). Level 2: all six foods, always in
// the same places. Level 3: the wished food in both colors plus two other
// foods in both colors, each pair side by side.
function wish(level, prev, rnd) {
  if (level < 3) {
    const table = FOOD_ORDER.map((item) => ({ item, color: FOODS[item].base }));
    const pool = table.filter((f) => !same(f, prev));
    return { table, want: pool[Math.floor(rnd() * pool.length)] };
  }
  const paired = FOOD_ORDER.filter((k) => FOODS[k].pair);
  const options = paired.flatMap((item) => FOODS[item].pair.map((color) => ({ item, color }))).filter((f) => !same(f, prev));
  const want = options[Math.floor(rnd() * options.length)];
  const others = shuffle(paired.filter((k) => k !== want.item), rnd).slice(0, 2);
  const foods = shuffle([want.item, ...others], rnd);
  const table = foods.flatMap((item) => shuffle(FOODS[item].pair, rnd).map((color) => ({ item, color })));
  return { table, want };
}

export function newGame(level = 2, rnd = Math.random) {
  const lv = Math.min(MAX_LEVEL, Math.max(2, level));
  return { level: lv, fed: 0, grown: 0, n: 0, done: false, ...wish(lv, null, rnd) };
}

// The next wish after a chomp; after a level's last chomp, the next level (or
// the same top level again) with a bigger monster.
export function next(state, rnd = Math.random) {
  if (state.done) {
    const level = Math.min(MAX_LEVEL, state.level + 1);
    return { ...state, level, fed: 0, grown: state.grown + 1, done: false, ...wish(level, state.want, rnd) };
  }
  return { ...state, ...wish(state.level, state.want, rnd) };
}

// What a spoken request means on this table:
//   a plate index, 'which' (that food is here but which one?), or null (not on the table).
export function resolve(state, req) {
  const idx = state.table.findIndex((f) => f.item === req.item && (state.level < 3 || f.color === req.color));
  if (idx >= 0) return idx;
  return state.table.some((f) => f.item === req.item) ? 'which' : null;
}

// The plate that answers the wish.
export const goalPlate = (state) => (state.done ? -1 : state.table.findIndex((f) => same(f, state.want)));

// Give the monster plate i -> { state, fx }: 'chomp', 'grow' (the level's last
// chomp) or 'spit'.
export function give(state, i) {
  const food = state.table[i];
  const s = { ...state, n: state.n + 1 };
  if (state.done || !food) return { state: s, fx: null };
  if (!same(food, state.want)) return { state: s, fx: 'spit' };
  const fed = state.fed + 1;
  return fed >= FEEDS ? { state: { ...s, fed, done: true }, fx: 'grow' } : { state: { ...s, fed }, fx: 'chomp' };
}
