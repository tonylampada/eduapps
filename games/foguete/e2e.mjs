// Headless run of the rocket game with a fake speech recognizer: one continuous
// session the test talks into (interim + final results), and that can be made
// to refuse restarts without a tap, like iOS. Not part of the site build;
// eduapps has no test deps, so point it at any playwright-core:
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs node games/foguete/e2e.mjs [<screenshot dir>]
//   E2E_URL=https://…/games/foguete/ checks a published copy instead of this folder.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');

// ---------- the matcher: commands in everyday pt-BR, chatter ignored ----------
const { spot } = await import('./commands.js');
const HEARD = {
  'liga o caminhão': ['liga'], 'caminhão, acelera!': ['acelera'], 'acelerá': ['acelera'], 'decola foguete': ['acelera'], 'decolar': ['acelera'],
  para: ['para'], pare: ['para'], 'caminhão para': ['para'], 'ei para': ['para'], parou: ['para'], 'para para': ['para', 'para'],
  buzina: ['buzina'], 'bi bi': ['buzina'], 'fom fom fom': ['buzina'], buzininha: ['buzina'], 'pula a pedra': ['pula'], pulou: ['pula'], vira: ['vira'], virando: ['vira'],
  'liga e acelera': ['liga', 'acelera'], aceleradinho: ['acelera'],
  // "para" the preposition, and words a letter away from a command
  'vamos para a lua': [], 'olha para lá': [], 'é para mim': [], 'oi tudo bem': [], 'eu vou pra escola': [], 'a pulga': [], 'quero pagar': [],
  'vamos no parque': [], 'olha a lua': [], 'a vida é bela': [], desliga: [], ligeiro: [],
};
for (const [heard, want] of Object.entries(HEARD)) assert.deepEqual(spot(heard), want, `"${heard}"`);
console.log(`✓ matcher: ${Object.keys(HEARD).length} phrases`);

const root = new URL('./', import.meta.url).pathname;
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
async function open(viewport, query = '', rnd = null) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(fakeSR);
  // a fixed Math.random pins the road: 0.3 -> light, rock; 0.7 -> rock, light
  if (rnd !== null) await page.addInitScript((r) => (Math.random = () => r), rnd);
  await page.goto(URL_ + query);
  return page;
}
// headless Chrome sometimes refuses the first capture of a fresh page
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
const body = (p) => p.evaluate(() => ({ ...document.body.dataset, bubble: document.getElementById('bubble').textContent, cls: document.body.className }));
const say = (p, text, final = true) => p.evaluate(([t, f]) => window.__sr.say(t, f), [text, final]);
const settled = (p) => p.waitForFunction(() => document.body.dataset.goal || document.body.dataset.phase !== 'play', null, { timeout: 6000 });
const slots = (p) => p.evaluate(() => [1, 2].map((i) => document.getElementById(`slot-${i}`).className.match(/is-(\w+)/)[1]));
const step = (msg) => console.log(`✓ ${msg}`);
// what to say for a goal: at the launchpad the rocket "decola"
const words = (b) => (b.goal === 'acelera' && b.ride === 'rocket' ? 'foguete decola' : `caminhão ${b.goal}`);

// Every animation frame, check the ride (truck or rocket) can be seen: not
// hidden or faded, and most of its picture inside the scene. Frames where it
// isn't land in window.__lost.
function watchRide() {
  window.__lost = [];
  const scene = document.getElementById('scene');
  const check = () => {
    if (document.getElementById('world').classList.contains('fade')) return; // the cut between runs
    const svg = [...document.querySelectorAll('#ride .vehicle')].find((e) => getComputedStyle(e).display !== 'none');
    if (!svg) return window.__lost.push('no vehicle shown');
    let op = 1;
    for (let e = svg; e && e !== scene; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility !== 'visible') op = 0;
      op *= Number(cs.opacity);
    }
    const r = svg.getBoundingClientRect();
    const s = scene.getBoundingClientRect();
    const seen = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / (a1 - a0);
    const inside = r.width > 0 && seen(r.left, r.right, s.left, s.right) >= 0.6 && seen(r.top, r.bottom, s.top, s.bottom) >= 0.6;
    if (op < 0.5 || !inside) window.__lost.push(`${document.body.dataset.at}/${[...document.getElementById('ride').classList].join('.')}: opacity ${op.toFixed(2)}, ${Math.round(r.left)},${Math.round(r.top)}..${Math.round(r.right)},${Math.round(r.bottom)} of ${Math.round(s.left)},${Math.round(s.top)}..${Math.round(s.right)},${Math.round(s.bottom)}`);
  };
  (function loop() {
    check();
    requestAnimationFrame(loop);
  })();
}
const lost = (p) => p.evaluate(() => window.__lost.splice(0));

// Every command at every stop, wrong ones repeated: the ride must stay in sight
// throughout, and a wrong command loses nothing.
async function everyCommandEverywhere(p, label) {
  await p.evaluate(watchRide);
  const ALL = ['liga', 'acelera', 'para', 'buzina', 'pula', 'vira'];
  let b;
  let stops = 0;
  while ((b = await body(p)).phase === 'play') {
    for (const cmd of ALL.filter((c) => c !== b.goal)) {
      for (let i = 0; i < 2; i++) {
        await say(p, `caminhão ${cmd}`);
        await settled(p);
        const after = await body(p);
        assert.deepEqual(await lost(p), [], `${label}: ride out of sight after "${cmd}" at stop ${b.at} (goal ${b.goal})`);
        for (const k of ['at', 'goal', 'ride', 'light']) assert.equal(after[k], b[k], `${cmd} at stop ${b.at} (goal ${b.goal}) changed ${k}`);
      }
    }
    await say(p, words(b));
    await settled(p);
    assert.deepEqual(await lost(p), [], `${label}: ride out of sight after the goal "${b.goal}" at stop ${b.at}`);
    stops++;
    assert.ok(stops < 12, 'reaches the moon');
  }
  assert.equal(b.phase, 'party');
  step(`${label}: every command at every stop (${stops} stops), ride always in sight`);
}

// ---------- iPad landscape: the whole trip ----------
let p = await open({ width: 1180, height: 820 }, '', 0.3);
await shot(p, 'ipad-1-start');
await p.click('#start');
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
let b = await body(p);
assert.equal(b.phase, 'play');
assert.equal(b.goal, 'liga');
assert.deepEqual(await p.evaluate(() => window.__starts), ['tap']);
step('one tap: mic up, liga glows');
await p.waitForFunction(() => document.body.dataset.horn, null, { timeout: 5000 });
assert.equal((await body(p)).horn, 'sample', 'the recorded horn decoded after the tap');
step('horn.mp3 decoded after the start tap');

for (const chat of ['oi tudo bem', 'vamos para a lua', 'olha o foguete', 'eu vou pra escola']) await say(p, chat);
b = await body(p);
assert.equal(b.fired, undefined, 'chatter fires nothing');
assert.equal(b.at, '0');
assert.equal(b.goal, 'liga');
assert.match(b.bubble, /escola/);
assert.ok(b.cls.includes('ear-on'), 'still listening');
await shot(p, 'ipad-2-chatter');
step('chatter ("vamos para a lua" too): nothing happens, bubble shows what was heard');

// interim results grow; the command fires once, on the first interim that has it
for (const t of ['caminhão', 'caminhão li', 'caminhão liga']) await say(p, t, false);
assert.equal((await body(p)).fired, '1', 'fired on the interim result');
await say(p, 'caminhão liga', true);
await settled(p);
b = await body(p);
assert.equal(b.fired, '1', 'the final result does not fire again');
assert.equal(b.goal, 'acelera');
step('interim "caminhão liga" -> engine on, once');

const first = await slots(p);
assert.deepEqual(first, ['light', 'rock']);
let n = 1;
let redDone = false;
let rockDone = false;
while ((b = await body(p)).phase === 'play') {
  if (!redDone && b.goal === 'para') {
    // acelera on red: honk and wait, never run the light
    await say(p, 'acelera');
    await p.waitForTimeout(300);
    await shot(p, 'ipad-3-red-light-honk');
    await settled(p);
    let after = await body(p);
    assert.equal(after.at, b.at, 'acelera on red does not move');
    assert.equal(after.goal, 'para');
    await say(p, 'para caminhão');
    n++;
    await p.waitForFunction(() => document.body.dataset.light === 'waiting');
    // said too soon: still red, honk and wait
    await p.waitForFunction(() => !/fx-/.test(document.getElementById('ride').className));
    assert.equal((await body(p)).goal, '', 'nothing to do but wait');
    await shot(p, 'ipad-4-waiting-for-green');
    await say(p, 'acelera');
    await p.waitForTimeout(100);
    after = await body(p);
    assert.equal(after.at, b.at, 'acelera while waiting does not move');
    const t0 = Date.now();
    await p.waitForFunction(() => document.body.dataset.goal === 'acelera', null, { timeout: 4000 });
    assert.equal((await body(p)).light, 'green');
    redDone = true;
    step(`red light: acelera honks and waits, para, light green by itself (${Date.now() - t0} ms after the early acelera)`);
    continue;
  }
  if (!rockDone && b.goal === 'pula') {
    await say(p, 'vira caminhão');
    await p.waitForTimeout(300);
    await shot(p, 'ipad-5-vira-at-rock');
    await settled(p);
    await say(p, 'acelera');
    await settled(p);
    const after = await body(p);
    assert.equal(after.goal, 'pula');
    assert.equal(after.at, b.at);
    rockDone = true;
    step('rock: vira turns around, acelera bumps, still waiting for pula');
  }
  await say(p, words(b));
  n++;
  if (b.goal === 'acelera' && b.ride === 'rocket') {
    await p.waitForTimeout(1600);
    await shot(p, 'ipad-7-flying');
  }
  await settled(p);
  if ((await body(p)).ride === 'rocket' && b.ride === 'truck') await shot(p, 'ipad-6-at-the-pad');
  step(`${words(b)}`);
  assert.ok(n < 12, 'reaches the moon');
}
assert.equal(b.phase, 'party');
assert.ok(n >= 6 && n <= 8, `${n} commands`);
await p.waitForTimeout(600);
assert.ok(await p.evaluate(() => document.querySelectorAll('#confetti i').length > 0), 'confetti');
await shot(p, 'ipad-8-moon-party');
step(`moon after ${n} commands: celebration`);

await p.waitForFunction(() => document.body.dataset.phase === 'play' && document.body.dataset.runs === '1', null, { timeout: 7000 });
b = await body(p);
assert.equal(b.at, '0');
assert.equal(b.goal, 'liga');
assert.equal(b.ride, 'truck');
const second = await slots(p);
assert.notDeepEqual(second, first, 'obstacles swapped');
await shot(p, 'ipad-9-next-run');
step(`reset with the other order: ${first} -> ${second}`);

// buttons fire too
b = await body(p);
await p.click('[data-cmd=buzina]');
assert.equal((await body(p)).fired, String(Number(b.fired) + 1));
await settled(p);
step('tapping a button fires its command');

// session ends; a restart without a tap works
await p.evaluate(() => window.__sr.end());
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
assert.equal((await p.evaluate(() => window.__starts)).at(-1), 'no-tap');
step('session ended: restarted without a tap');

// session ends and restarts now need a tap: retries, then the whole screen is the tap target
await p.evaluate(() => ((window.__srNeedsTap = true), window.__sr.end()));
await p.waitForSelector('#tap-resume:not([hidden])', { timeout: 5000 });
assert.ok((await body(p)).cls.includes('ear-tap'));
await shot(p, 'ipad-10-tap-to-resume');
await p.mouse.click(300, 300); // anywhere: the scene, not a button
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
assert.ok(await p.isHidden('#tap-resume'));
assert.equal((await p.evaluate(() => window.__starts)).at(-1), 'tap');
b = await body(p);
await say(p, 'liga');
assert.equal((await body(p)).fired, String(Number(b.fired) + 1));
step('restarts refused without a tap: whole-screen tap target, one tap brings the mic back');
await p.close();

// ---------- iPhone portrait ----------
p = await open({ width: 390, height: 844 }, '', 0.7);
await shot(p, 'iphone-1-start');
await p.click('#start');
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
await say(p, 'olha o caminhão');
await shot(p, 'iphone-2-play');
for (let i = 0; i < 3; i++) {
  await say(p, words(await body(p)));
  await settled(p);
}
await shot(p, 'iphone-3-middle');
while ((b = await body(p)).phase === 'play') {
  await say(p, words(b));
  if (b.ride === 'rocket' && b.goal === 'acelera') {
    await p.waitForTimeout(1600);
    await shot(p, 'iphone-4-flying');
  }
  await settled(p);
}
await p.waitForTimeout(600);
await shot(p, 'iphone-5-moon-party');
const noScroll = await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth);
assert.ok(noScroll, 'no scroll');
step('iPhone portrait: plays to the moon, no scroll');
await p.close();

// ---------- the ride never disappears ----------
p = await open({ width: 1180, height: 820 }, '', 0.3);
await p.click('#start');
await everyCommandEverywhere(p, 'iPad, light then rock');
await p.close();
p = await open({ width: 390, height: 844 }, '', 0.7);
await p.click('#start');
assert.deepEqual(await slots(p), ['rock', 'light']);
await everyCommandEverywhere(p, 'iPhone, rock then light');
await p.close();
p = await open({ width: 844, height: 390 }, '', 0.3);
await p.click('#start');
await everyCommandEverywhere(p, 'iPhone landscape, light then rock');
await p.close();

// ?debug overlay
p = await open({ width: 1180, height: 820 }, '?debug');
await p.click('#start');
await say(p, 'liga');
await p.waitForTimeout(300);
assert.match(await p.textContent('.dbg-log'), /fire liga \(voice\)/);
await shot(p, 'ipad-11-debug');
step('?debug log shows recognition and commands');

assert.deepEqual(errors, []);
await browser.close();
server.close();
console.log('e2e ok');
