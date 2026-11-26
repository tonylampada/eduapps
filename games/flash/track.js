// The race as pure state: where the hero and the car are, which obstacles are
// still standing, and what each command does. No failure state: the hero
// always wins, a command that doesn't advance still does its funny thing.
// Positions are in track units (style.css --u).

export const START = 20;
export const OB_X = [100, 180, 260];
export const FINISH = 340;
export const FRONT = 18; // stops this far before an obstacle
export const LAND = 20; // lands this far after it
export const LAND_FAR = 34; // ...or this far, with a Flash jump
export const JOG = 28;
const CAR_GAP = 12; // the car never gets closer than this behind him

export const KINDS = ['cone', 'puddle', 'hurdle'];

function shuffle(list, rnd) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A new race; the obstacles come in a different order than last time.
export function newRace(prev = null, rnd = Math.random) {
  let order;
  do order = shuffle(KINDS, rnd);
  while (prev && order.join() === prev.order.join());
  return { order, cleared: [false, false, false], x: START, car: START - 4, done: false, n: 0 };
}

// The obstacle in front of him (index), or -1 when the way is clear to the finish.
export function nextOb(race) {
  return OB_X.findIndex((x, i) => !race.cleared[i] && x > race.x);
}
const stopAt = (race, i) => (i < 0 ? FINISH : OB_X[i] - FRONT);
export const atOb = (race) => {
  const i = nextOb(race);
  return i >= 0 && race.x >= OB_X[i] - FRONT ? i : -1;
};

// The command that moves the race on best, or null once he has won.
export function goal(race) {
  if (race.done) return null;
  return atOb(race) >= 0 ? 'superpula' : 'super';
}

function moved(race, x, carShare, extra = {}) {
  const d = x - race.x;
  const car = Math.max(race.car, Math.min(race.car + d * carShare + 4, x - CAR_GAP));
  return { ...race, ...extra, x, car, done: x >= FINISH, n: race.n + 1 };
}

function clear(race, i) {
  const cleared = race.cleared.slice();
  cleared[i] = true;
  return cleared;
}

// -> { race, fx }: the next state and the animation that shows it.
export function step(race, cmd) {
  if (race.done) return { race, fx: 'wave' };
  const ob = atOb(race);
  const next = nextOb(race);
  switch (cmd) {
    case 'corre':
      if (ob >= 0) return { race: { ...race, n: race.n + 1 }, fx: 'bump' };
      return { race: moved(race, Math.min(race.x + JOG, stopAt(race, next)), 0.7), fx: 'jog' };
    case 'super': {
      // Flash speed: all the way to the next obstacle (or the finish), straight
      // through the one in front of him if there is one. A run, never a jump:
      // jumping is what "pula" does.
      if (ob >= 0) {
        const cleared = clear(race, ob);
        return { race: moved(race, stopAt({ ...race, cleared }, nextOb({ ...race, cleared })), 0.25, { cleared }), fx: 'zoom' };
      }
      return { race: moved(race, stopAt(race, next), 0.25), fx: 'zoom' };
    }
    case 'pula':
      if (ob >= 0) return { race: moved(race, OB_X[ob] + LAND, 0.4, { cleared: clear(race, ob) }), fx: 'hop' };
      return { race: { ...race, n: race.n + 1 }, fx: 'jump' };
    case 'superpula':
      // obstacles are 80 apart: a far landing is still well before the next one
      if (ob >= 0) return { race: moved(race, OB_X[ob] + LAND_FAR, 0.3, { cleared: clear(race, ob) }), fx: 'superhop' };
      return { race: { ...race, n: race.n + 1 }, fx: 'superjump' };
    case 'para':
      // he stops to wait; the car catches up (but never passes him)
      return { race: { ...race, car: Math.max(race.car, race.x - CAR_GAP), n: race.n + 1 }, fx: 'stop' };
    default:
      return { race, fx: null };
  }
}
