// The yard as pure state: where the dog is, what stands between him and the
// bone, and what each command does. No failure state: a command that doesn't
// advance still does its funny thing.

export const GOAL_FX = new Set(['run', 'hop', 'open-bark', 'open-key', 'bone']);

// order: the two obstacles in path order; gate: 'bark' (someone hears him and
// opens) or 'key' (a key hangs on the post; barking still works).
export function newRun(prev = null, rnd = Math.random) {
  let order = rnd() < 0.5 ? ['puddle', 'gate'] : ['gate', 'puddle'];
  if (prev && order[0] === prev.order[0]) order = order.slice().reverse();
  return { order, gate: rnd() < 0.5 ? 'bark' : 'key', at: 0, cleared: true, open: false, done: false, mud: false, n: 0 };
}

// at: 0 start, 1..order.length in front of that obstacle, order.length + 1 at the bone.
export const atBone = (run) => run.at === run.order.length + 1;
export const obstacle = (run) => (run.at >= 1 && run.at <= run.order.length ? run.order[run.at - 1] : null);

// The command that moves the run on, or null once the bone is his.
export function goal(run) {
  if (run.done) return null;
  if (atBone(run)) return 'pega';
  if (!run.cleared) return obstacle(run) === 'puddle' ? 'pula' : run.gate === 'key' ? 'pega' : 'late';
  return 'corre';
}

const FUN = { corre: 'zoom', pula: 'jump', late: 'bark', pega: 'spin', senta: 'sit', deita: 'lie' };

// -> { run, fx }: the next state and the animation that shows it.
export function step(run, cmd) {
  const r = { ...run, n: run.n + 1 };
  const fun = { run: r, fx: FUN[cmd] };
  if (run.done || !FUN[cmd]) return fun;
  const ob = obstacle(run);
  if (atBone(run)) return cmd === 'pega' ? { run: { ...r, done: true }, fx: 'bone' } : fun;
  if (!run.cleared && ob === 'puddle') {
    if (cmd === 'pula') return { run: { ...r, cleared: true }, fx: 'hop' };
    if (cmd === 'corre') return { run: { ...r, mud: true }, fx: 'splash' };
    return fun;
  }
  if (!run.cleared && ob === 'gate') {
    if (cmd === 'late') return { run: { ...r, cleared: true, open: true }, fx: 'open-bark' };
    if (cmd === 'pega' && run.gate === 'key') return { run: { ...r, cleared: true, open: true }, fx: 'open-key' };
    if (cmd === 'corre') return { run: r, fx: 'bonk' };
    return fun;
  }
  if (cmd === 'corre') return { run: { ...r, at: run.at + 1, cleared: run.at + 1 > run.order.length }, fx: 'run' };
  return fun;
}
