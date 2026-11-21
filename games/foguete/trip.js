// The trip as pure state: the truck drives across town to the rocket, the rocket
// flies to the moon. No failure state: a command that doesn't move the trip on
// still does its funny thing, and nothing ever crashes.

// order: the two obstacles on the road, in path order. at: 0 start, 1..2 in
// front of (or, cleared, just past) that obstacle, 3 at the launchpad.
// light: 'red' until "para", then 'waiting' until it turns green by itself.
export function newRun(prev = null, rnd = Math.random) {
  let order = rnd() < 0.5 ? ['light', 'rock'] : ['rock', 'light'];
  if (prev && order[0] === prev.order[0]) order = order.slice().reverse();
  return { order, at: 0, ride: 'truck', engine: false, cleared: true, light: 'red', done: false, n: 0 };
}

export const PAD = 3;
export const atPad = (run) => run.at === PAD;
export const obstacle = (run) => (run.at >= 1 && run.at < PAD ? run.order[run.at - 1] : null);

// The command that moves the trip on, or null: the moon is reached, or the
// light is about to turn green and there is nothing to do but wait.
export function goal(run) {
  if (run.done) return null;
  if (!run.engine) return 'liga';
  if (!run.cleared) {
    if (obstacle(run) === 'rock') return 'pula';
    return run.light === 'red' ? 'para' : null;
  }
  return 'acelera';
}

const FUN = { liga: 'rev', acelera: 'cough', para: 'brake', buzina: 'honk', pula: 'jump', vira: 'flip' };

// -> { run, fx }: the next state and the animation that shows it.
export function step(run, cmd) {
  const r = { ...run, n: run.n + 1 };
  const fun = { run: r, fx: FUN[cmd] };
  if (run.done || !FUN[cmd]) return fun;
  const ob = run.cleared ? null : obstacle(run);
  if (cmd === 'liga') return run.engine ? fun : { run: { ...r, engine: true }, fx: 'start' };
  if (cmd === 'pula' && ob === 'rock') return { run: { ...r, cleared: true }, fx: 'hop' };
  if (cmd === 'para' && ob === 'light' && run.light === 'red') return { run: { ...r, light: 'waiting' }, fx: 'stop' };
  if (cmd !== 'acelera' || !run.engine) return fun;
  // acelera, engine running
  if (ob === 'rock') return { run: r, fx: 'bump' };
  if (ob === 'light') return { run: r, fx: 'honk-wait' }; // red: honk and wait, never run it
  if (atPad(run)) return { run: { ...r, done: true }, fx: 'launch' };
  const at = run.at + 1;
  // reaching the pad: the truck parks, and the next ride is the rocket, engine off
  if (at === PAD) return { run: { ...r, at, ride: 'rocket', engine: false, cleared: true }, fx: 'arrive' };
  return { run: { ...r, at, cleared: false }, fx: 'drive' };
}

// The light turns green on its own a moment after the truck stopped for it.
export function turnGreen(run) {
  if (obstacle(run) !== 'light' || run.light !== 'waiting') return run;
  return { ...run, light: 'green', cleared: true };
}
