// Headless run of games/monstro with a fake speech recognizer: one continuous
// session the test talks into (interim + final results), and that can be made
// to refuse restarts without a tap, like iOS. Adapted from fala-comigo's
// e2e/cachorro.mjs. eduapps has no test deps, so bring playwright-core:
//   PLAYWRIGHT=/path/to/node_modules/playwright-core node games/monstro/e2e/monstro.mjs [<screenshot dir>]
//   E2E_URL=https://…/games/monstro/ checks a published copy.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright-core');

const root = new URL('../', import.meta.url).pathname;
const shots = process.argv[2];
if (shots) fs.mkdirSync(shots, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  if (!f.startsWith(root) || !fs.existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const URL_ = process.env.E2E_URL || `http://localhost:${server.address().port}/`;

function fakeSR() {
  window.__srNeedsTap = false;
  window.__starts = [];
  // iOS: start() works without asking only inside the tap's own handler.
  let inTap = false;
  addEventListener('click', () => ((inTap = true), setTimeout(() => (inTap = false))), true);
  class FakeSR {
    start() {
      const gesture = inTap;
      window.__starts.push(gesture ? 'tap' : 'no-tap');
      window.__sr = this;
      this.list = [];
      if (window.__srNeedsTap && !gesture) {
        setTimeout(() => (this.onerror?.({ error: 'not-allowed' }), this.onend?.()), 30);
        return;
      }
      setTimeout(() => (this.onstart?.(), this.onaudiostart?.()), 30);
    }
    say(text, final) {
      const last = this.list[this.list.length - 1];
      const r = Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal: final });
      if (last && !last.isFinal) this.list[this.list.length - 1] = r;
      else this.list.push(r);
      this.onresult?.({ results: this.list, resultIndex: this.list.length - 1 });
    }
    end() {
      this.onend?.();
    }
    stop() {}
    abort() {}
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  window.speechSynthesis.speak = () => {
    throw new Error('the game must never speak');
  };
}

const browser = await chromium.launch();
const errors = [];
async function open(viewport, { query = '', init = null, ctx = null } = {}) {
  ctx ||= await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(fakeSR);
  if (init) await page.addInitScript(init);
  await page.goto(URL_ + query);
  return page;
}
// headless Chrome here sometimes refuses the first capture of a fresh page
async function shot(p, name) {
  if (!shots) return;
  for (let i = 0; ; i++) {
    try {
      return await p.screenshot({ path: path.join(shots, `${name}.png`) });
    } catch (e) {
      if (i === 3) throw e;
      await p.waitForTimeout(250);
    }
  }
}
const body = (p) => p.evaluate(() => ({ ...document.body.dataset, bubble: document.getElementById('bubble').textContent, cls: document.body.className, mon: document.getElementById('monster').className }));
const say = (p, text, final = true) => p.evaluate(([t, f]) => window.__sr.say(t, f), [text, final]);
const settled = (p) => p.waitForFunction(() => document.body.dataset.goal || document.body.dataset.phase !== 'play', null, { timeout: 8000 });
const step = (msg) => console.log(`✓ ${msg}`);
const VERBS = ['dá a', 'come a', 'quero a', 'monstro, dá a', 'me dá a'];
const article = (wish) => (/^(pão|bolo)/.test(wish) ? 'o' : 'a');
const ask = (wish, i = 0) => `${VERBS[i % VERBS.length].replace(/ a$/, ` ${article(wish)}`)} ${wish}`;
// table entry "maca:vermelho" -> what a child would say for it
const ITEM = { banana: 'banana', maca: 'maçã', uva: 'uva', pao: 'pão', bolo: 'bolo', cenoura: 'cenoura' };
const COLOR = { vermelho: ['vermelho', 'vermelha'], verde: ['verde', 'verde'], amarelo: ['amarelo', 'amarela'], roxo: ['roxo', 'roxa'], laranja: ['laranja', 'laranja'], rosa: ['rosa', 'rosa'], marrom: ['marrom', 'marrom'] };
const words = (k, level) => {
  const [item, color] = k.split(':');
  const fem = !['pao', 'bolo'].includes(item);
  return level >= 3 ? `${ITEM[item]} ${COLOR[color][fem ? 1 : 0]}` : ITEM[item];
};

// Every animation frame, check the monster can be seen: not hidden or faded,
// most of its picture inside the scene. Frames where it isn't land in window.__lost.
function watchMonster() {
  window.__lost = [];
  const svg = document.querySelector('#monster .mon-svg');
  const scene = document.getElementById('scene');
  const check = () => {
    let op = 1;
    for (let e = svg; e && e !== scene; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility !== 'visible') op = 0;
      op *= Number(cs.opacity);
    }
    const r = svg.getBoundingClientRect();
    const s = scene.getBoundingClientRect();
    const seen = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / (a1 - a0);
    const inside = r.width > 0 && seen(r.left, r.right, s.left, s.right) >= 0.8 && seen(r.top, r.bottom, s.top, s.bottom) >= 0.8;
    if (op < 0.5 || !inside) window.__lost.push(`${document.getElementById('monster').className}: opacity ${op.toFixed(2)}, ${Math.round(r.left)},${Math.round(r.top)}..${Math.round(r.right)},${Math.round(r.bottom)} of ${Math.round(s.right)}x${Math.round(s.bottom)}`);
  };
  (function loop() {
    check();
    requestAnimationFrame(loop);
  })();
}
const lost = (p) => p.evaluate(() => window.__lost.splice(0));

// Every wrong plate at every feed (spat out, nothing lost), at level 3 also a
// colorless request (which one?), then the right one; the monster always in sight.
async function everyPlateEveryFeed(p, label) {
  await p.evaluate(watchMonster);
  const level = Number((await body(p)).level);
  let b;
  let feeds = 0;
  while ((b = await body(p)).phase === 'play') {
    const table = b.table.split(',');
    for (const k of table.filter((t) => t !== b.goal)) {
      await say(p, `dá a ${words(k, level)}`);
      await settled(p);
      const after = await body(p);
      assert.deepEqual(await lost(p), [], `${label}: monster out of sight after "${k}" (wish ${b.wish})`);
      assert.equal(after.fed, b.fed, `${k} fed the monster`);
      assert.equal(after.goal, b.goal, `${k} changed the wish`);
      assert.ok(await p.isVisible(`.cmd[data-key="${k}"] .food`), `${k} back on its plate`);
    }
    if (level >= 3) {
      await say(p, `dá a ${ITEM[b.goal.split(':')[0]]}`);
      await p.waitForTimeout(100);
      assert.match((await body(p)).mon, /fx-which/, 'which one?');
      await settled(p);
      assert.equal((await body(p)).fed, b.fed);
    }
    await say(p, ask(b.wish, feeds));
    await settled(p);
    assert.deepEqual(await lost(p), [], `${label}: monster out of sight after the wish "${b.wish}"`);
    feeds++;
    assert.ok(feeds <= 5, 'grows after 5 feeds');
  }
  assert.equal(b.phase, 'party');
  await p.waitForTimeout(1500);
  assert.deepEqual(await lost(p), [], `${label}: monster out of sight while growing`);
  await p.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 6000 });
  assert.deepEqual(await lost(p), [], `${label}: monster out of sight after growing`);
  step(`${label}: every wrong plate at every feed (${feeds} feeds), monster always in sight`);
}

// ---------- iPad landscape: level 2 to level 3 ----------
let p = await open({ width: 1180, height: 820 });
await shot(p, 'ipad-1-start');
assert.ok(await p.isVisible('.level[data-level="2"].saved'), 'no saved level: level 2 preselected');
await p.click('.level[data-level="2"]', { force: true }); // it glows (scale animation): never "stable"
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
let b = await body(p);
assert.equal(b.phase, 'play');
assert.equal(b.level, '2');
assert.ok(b.goal, 'a wish glows');
assert.equal(await p.locator('.cmd.goal').count(), 1);
assert.deepEqual(await p.evaluate(() => window.__starts), ['tap']);
step(`one tap on "Comidas": mic up, level 2, wish ${b.wish}`);
await p.waitForFunction(() => document.body.dataset.bite, null, { timeout: 5000 });
assert.equal((await body(p)).bite, 'sample', 'bite.mp3 decoded after the tap');
step('bite.mp3 decoded after the start tap');

for (const chat of ['oi tudo bem', 'olha a casca da banana', 'que bacana', 'banana', 'quero leite', 'a cor da maçã é vermelha']) await say(p, chat);
b = await body(p);
assert.equal(b.fired, undefined, 'chatter fires nothing');
assert.equal(b.fed, '0');
assert.match(b.bubble, /a cor da maçã é vermelha/);
assert.ok(b.cls.includes('ear-on'), 'still listening');
await shot(p, 'ipad-2-chatter');
step('chatter (incl. "casca da banana", "bacana", "banana" alone): nothing happens, bubble shows it');

const wish1 = b.wish;
for (const t of ['monstro', 'monstro dá', `monstro dá ${article(wish1)} ${wish1}`]) await say(p, t, false);
b = await body(p);
assert.equal(b.fired, '1', 'fired on the interim result');
await p.waitForTimeout(250);
await shot(p, 'ipad-3-flying');
await say(p, `monstro dá ${article(wish1)} ${wish1}`, true);
await settled(p);
b = await body(p);
assert.equal(b.fired, '1', 'the final result does not fire again');
assert.equal(b.fed, '1');
step(`interim "monstro dá ${article(wish1)} ${wish1}" -> fed once`);

// the wrong food: a funny face, spat back onto its plate, same wish
const wrong = b.table.split(',').find((k) => k !== b.goal);
await say(p, `dá a ${words(wrong, 2)}`);
await p.waitForTimeout(800);
assert.match((await body(p)).mon, /fx-yuck/);
await shot(p, 'ipad-4-yuck');
await settled(p);
let after = await body(p);
assert.equal(after.fed, '1');
assert.equal(after.goal, b.goal);
assert.ok(await p.isVisible(`.cmd[data-key="${wrong}"] .food`));
step(`wrong food (${wrong}): yuck face, spat back onto its plate, still wants ${b.wish}`);

let n = 1;
while ((b = await body(p)).phase === 'play') {
  await say(p, ask(b.wish, n));
  if (n === 3) {
    await p.waitForTimeout(1300);
    await shot(p, 'ipad-5-happy');
  }
  await settled(p);
  n++;
  assert.ok(n <= 5, 'grows after 5 feeds');
}
assert.equal(b.phase, 'party');
await p.waitForTimeout(800);
assert.ok(await p.evaluate(() => document.querySelectorAll('#confetti i').length > 0), 'confetti');
await shot(p, 'ipad-6-grow');
step(`5 feeds (verbs: ${VERBS.join(' / ')}): grows`);

await p.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 6000 });
b = await body(p);
assert.equal(b.level, '3');
assert.equal(b.fed, '0');
assert.equal(b.grown, '1');
assert.equal(await p.evaluate(() => localStorage.getItem('eduapps.monstro.level')), '3');
const table3 = b.table.split(',');
assert.equal(table3.length, 6);
assert.ok(table3.includes(b.goal));
assert.equal(table3.filter((k) => k.startsWith(`${b.goal.split(':')[0]}:`)).length, 2, 'the wished food in two colors');
await p.waitForTimeout(800);
await shot(p, 'ipad-7-level3');
step(`reset at level 3 (saved): wish ${b.wish}, table ${b.table}`);

// level 3: no color -> which one?; the other color -> spat out; "pão" isn't on the table
const [item, color] = b.goal.split(':');
const other = table3.find((k) => k.startsWith(`${item}:`) && k !== b.goal);
await say(p, `dá a ${ITEM[item]}`);
await p.waitForTimeout(150);
assert.match((await body(p)).mon, /fx-which/);
await shot(p, 'ipad-8-which');
await settled(p);
assert.equal((await body(p)).fed, '0');
step(`"dá a ${ITEM[item]}" without a color: which one? nothing eaten`);
await say(p, `dá a ${words(other, 3)}`);
await p.waitForTimeout(800);
assert.match((await body(p)).mon, /fx-yuck/);
await settled(p);
assert.equal((await body(p)).fed, '0');
step(`"dá a ${words(other, 3)}" (other color): spat out`);
const firedBefore = (await body(p)).fired;
await say(p, 'dá o pão');
assert.equal((await body(p)).fired, firedBefore, 'not on the table: nothing');
// "dá a maçã" growing into "dá a maçã vermelha": no which-one in between
for (const t of [`dá a ${ITEM[item]}`, `dá a ${words(b.goal, 3)}`]) await say(p, t, false);
await p.waitForTimeout(100);
assert.doesNotMatch((await body(p)).mon, /fx-which/);
await say(p, `dá a ${words(b.goal, 3)}`, true);
await settled(p);
assert.equal((await body(p)).fed, '1');
assert.equal((await body(p)).fired, String(Number(firedBefore) + 1));
step(`interim "dá a ${ITEM[item]}" waits for its color: "${words(b.goal, 3)}" eaten once`);

// tapping a plate gives it
await p.click('.cmd.goal', { force: true });
await settled(p);
assert.equal((await body(p)).fed, '2');
step('tapping the glowing plate feeds it');

// session ends; a restart without a tap works
await p.evaluate(() => window.__sr.end());
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
assert.equal((await p.evaluate(() => window.__starts)).at(-1), 'no-tap');
step('session ended: restarted without a tap');

// session ends and restarts now need a tap: retries, then the whole screen is the tap target
await p.evaluate(() => ((window.__srNeedsTap = true), window.__sr.end()));
await p.waitForSelector('#tap-resume:not([hidden])', { timeout: 5000 });
assert.ok((await body(p)).cls.includes('ear-tap'));
await shot(p, 'ipad-9-tap-to-resume');
await p.mouse.click(300, 300);
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
assert.ok(await p.isHidden('#tap-resume'));
assert.equal((await p.evaluate(() => window.__starts)).at(-1), 'tap');
b = await body(p);
await say(p, ask(b.wish));
assert.equal((await body(p)).fired, String(Number(b.fired) + 1));
await settled(p);
step('restarts refused without a tap: whole-screen tap target, one tap brings the mic back');

// the saved level comes back on the start screen
const ctx = p.context();
await p.close();
p = await open(null, { ctx });
assert.ok(await p.isVisible('.level[data-level="3"].saved'), 'level 3 remembered');
step('reload: level 3 preselected (localStorage)');
await p.close();

// storage that throws must not break anything
p = await open({ width: 1180, height: 820 }, {
  init: () => Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }),
});
await p.click('.level[data-level="3"]', { force: true }); // it glows (scale animation): never "stable"
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
assert.equal((await body(p)).level, '3');
step('localStorage throwing: still starts');
await p.close();

// ---------- iPhone portrait ----------
p = await open({ width: 390, height: 844 });
await shot(p, 'iphone-1-start');
await p.click('.level[data-level="2"]', { force: true }); // it glows (scale animation): never "stable"
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
await say(p, 'olha o monstro');
await shot(p, 'iphone-2-play');
for (let i = 0; i < 2; i++) {
  await say(p, ask((await body(p)).wish, i));
  await settled(p);
}
b = await body(p);
await say(p, `dá a ${words(b.table.split(',').find((k) => k !== b.goal), 2)}`);
await p.waitForTimeout(800);
await shot(p, 'iphone-3-yuck');
await settled(p);
while ((b = await body(p)).phase === 'play') {
  await say(p, ask(b.wish));
  await settled(p);
}
await p.waitForTimeout(800);
await shot(p, 'iphone-4-grow');
await p.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 6000 });
await p.waitForTimeout(800); // the new table pops in
await shot(p, 'iphone-5-level3');
const noScroll = await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth);
assert.ok(noScroll, 'no scroll');
step('iPhone portrait: level 2 to level 3, no scroll');
await p.close();

// ---------- the monster never disappears ----------
p = await open({ width: 1180, height: 820 });
await p.click('.level[data-level="2"]', { force: true }); // it glows (scale animation): never "stable"
await everyPlateEveryFeed(p, 'iPad, level 2');
await everyPlateEveryFeed(p, 'iPad, level 3');
await everyPlateEveryFeed(p, 'iPad, level 3 again (biggest)');
await p.close();
p = await open({ width: 390, height: 844 });
await p.click('.level[data-level="3"]', { force: true }); // it glows (scale animation): never "stable"
await everyPlateEveryFeed(p, 'iPhone, level 3');
await everyPlateEveryFeed(p, 'iPhone, level 3 again (bigger)');
await p.waitForTimeout(800);
await shot(p, 'iphone-6-bigger');
await p.close();

// ?debug overlay
p = await open({ width: 1180, height: 820 }, { query: '?debug' });
await p.click('.level[data-level="2"]', { force: true }); // it glows (scale animation): never "stable"
b = await body(p);
await say(p, ask(b.wish));
await p.waitForTimeout(300);
assert.match(await p.textContent('.dbg-log'), /fire \S+ \(voice\)/);
await shot(p, 'ipad-10-debug');
step('?debug log shows recognition and requests');

assert.deepEqual(errors, []);
await browser.close();
server.close();
console.log('e2e ok');
