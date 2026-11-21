// Headless run of games/casa/ with a fake speech recognizer: one continuous
// session the test talks into (interim + final results), and that can be made
// to refuse restarts without a tap, like iOS. Not part of the build; eduapps
// has no test deps, so point it at any playwright-core install:
//   PW_FROM=<dir with node_modules/playwright-core> node games/casa/e2e.mjs [<screenshot dir>]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright-core', { paths: [process.env.PW_FROM || process.cwd()] }));

const root = new URL('../../', import.meta.url).pathname; // the repo: the game imports lib/voice/
const shots = process.argv[2];
if (shots) fs.mkdirSync(shots, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  if (!f.startsWith(root) || !fs.existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const URL_ = process.env.E2E_URL || `http://localhost:${server.address().port}/games/casa/`; // E2E_URL: check a published copy

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
  if (rnd !== null) await page.addInitScript((r) => (Math.random = () => r), rnd);
  await page.goto(URL_ + query);
  return page;
}
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
const settled = (p) => p.waitForFunction(() => document.body.dataset.goal || document.body.dataset.phase !== 'play', null, { timeout: 5000 });
const layout = (p) => p.evaluate(() => [0, 1, 2, 3].map((i) => document.getElementById(`slot-${i}`).dataset.spot));
const step = (msg) => console.log(`✓ ${msg}`);
const SPOKEN = { luz: 'acende a luz', gato: 'chama o gato', porta: 'abre a porta', armario: 'abre o armário', cama: 'olha embaixo da cama', cortina: 'olha atrás da cortina' };
const ALL = Object.keys(SPOKEN);

// Every animation frame, once the cat is found, check it can be seen: nothing
// hiding or fading it, and most of it inside the scene. Frames where it isn't
// land in window.__lost. Before it is found it must stay unseen.
function watchCat() {
  window.__lost = [];
  const svg = document.querySelector('#cat .cat-svg');
  const scene = document.getElementById('scene');
  const check = () => {
    if (document.getElementById('world').classList.contains('fade')) return; // the cut between rooms
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
    const found = document.body.dataset.found === 'true' && !document.getElementById('cat').classList.contains('coming');
    // the cat pops in over ~0.5 s after "find": judge it once it has had the time
    if (found && !window.__foundAt) window.__foundAt = performance.now();
    if (!found) window.__foundAt = 0;
    if (found && performance.now() - window.__foundAt > 1200 && (op < 0.5 || !inside)) window.__lost.push(`cat lost (${document.body.dataset.goal}): opacity ${op.toFixed(2)}, x ${Math.round(r.left)}..${Math.round(r.right)}`);
    if (document.body.dataset.found === 'false' && op > 0.05) window.__lost.push(`cat seen before it was found: opacity ${op.toFixed(2)}`);
  };
  (function loop() {
    check();
    requestAnimationFrame(loop);
  })();
}
const lost = (p) => p.evaluate(() => window.__lost.splice(0));

// The spot a command acted on is mostly on screen (the camera follows on phones).
async function inView(p, spotName) {
  return p.evaluate((s) => {
    const el = document.querySelector(`.slot[data-spot=${s}] .furn`).getBoundingClientRect();
    const sc = document.getElementById('scene').getBoundingClientRect();
    return Math.max(0, Math.min(el.right, sc.right) - Math.max(el.left, sc.left)) / el.width;
  }, spotName);
}

// Every command at every stage, wrong ones twice: nothing lost, the goal stays,
// the cat never vanishes once found, and never shows before.
async function everyCommandEverywhere(p, label) {
  await p.evaluate(watchCat);
  let b;
  let stages = 0;
  while ((b = await body(p)).phase === 'play') {
    // the cat's own spot finds it whenever it is said: that is progress, not a wrong command
    const wrong = ALL.filter((c) => c !== b.goal && (c !== b.cat || b.found === 'true'));
    for (const cmd of wrong) {
      for (let i = 0; i < 2; i++) {
        await say(p, SPOKEN[cmd]);
        await settled(p);
        const after = await body(p);
        assert.deepEqual(await lost(p), [], `${label}: after "${cmd}" (goal ${b.goal})`);
        assert.equal(after.goal, b.goal, `${cmd} changed the goal ${b.goal}`);
        assert.equal(after.found, b.found, `${cmd} changed found`);
        if (cmd !== 'luz' && cmd !== 'gato') assert.ok((await inView(p, cmd)) >= 0.6, `${label}: ${cmd} out of view`);
      }
    }
    await say(p, SPOKEN[b.goal]);
    await settled(p);
    assert.deepEqual(await lost(p), [], `${label}: after the goal "${b.goal}"`);
    stages++;
    assert.ok(stages < 6, 'finds the cat');
  }
  assert.equal(b.phase, 'party');
  // luz, (gato,) the spot, gato: a meow in the dark already counts as the call
  assert.ok(stages >= 3 && stages <= 4, `${stages} stages`);
  step(`${label}: every command at every stage (${stages} stages), cat hidden until found, then always in sight`);
}

// ---------- iPad landscape: the whole path ----------
let p = await open({ width: 1180, height: 820 });
await shot(p, 'ipad-1-start');
await p.click('#start');
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
let b = await body(p);
assert.equal(b.phase, 'play');
assert.equal(b.goal, 'luz');
assert.deepEqual(await p.evaluate(() => window.__starts), ['tap']);
step('one tap: mic up, "acende a luz" glows');
await p.waitForFunction(() => document.body.dataset.meow, null, { timeout: 5000 });
assert.equal((await body(p)).meow, 'sample', 'the recorded meow decoded after the tap');
step('meow.mp3 decoded after the start tap');
await shot(p, 'ipad-2-dark');

for (const chat of ['oi tudo bem', 'quero torta', 'olha o pato', 'vou no porto', 'abre', 'olha ali', 'cadê']) await say(p, chat);
b = await body(p);
assert.equal(b.fired, undefined, 'chatter fires nothing');
assert.equal(b.goal, 'luz');
assert.equal(b.lit, 'false');
assert.match(b.bubble, /cadê/);
assert.ok(b.cls.includes('ear-on'), 'still listening');
step('chatter and near-misses: nothing happens, bubble shows what was heard');

// interim results grow; the verb alone already fires, the object adds nothing
for (const t of ['acende', 'acende a', 'acende a luz']) await say(p, t, false);
b = await body(p);
assert.equal(b.fired, '1', 'fired on the interim result');
await say(p, 'acende a luz', true);
await settled(p);
b = await body(p);
assert.equal(b.fired, '1', 'the final result does not fire again');
assert.equal(b.lit, 'true');
assert.equal(b.goal, 'gato');
await shot(p, 'ipad-3-lit');
step('interim "acende a luz" -> light on, once');

await p.evaluate(watchCat);
const room1 = await layout(p);
const cat1 = b.cat;
// "o gato, chama" — object first, verb after
await say(p, 'o gato, chama!');
await p.waitForTimeout(400);
assert.ok(await p.evaluate(() => document.getElementById('hint').classList.contains('on')), 'eyes and tail peek out');
const meowPan = Number((await body(p)).meowPan);
const side = room1.indexOf(cat1) < 2 ? -1 : 1;
assert.equal(Math.sign(meowPan), side, `the meow comes from the ${side < 0 ? 'left' : 'right'} (pan ${meowPan})`);
await shot(p, 'ipad-4-meow');
await settled(p);
b = await body(p);
assert.equal(b.goal, cat1, 'after the meow the hiding spot glows');
step(`"chama o gato": meow from the ${side < 0 ? 'left' : 'right'} (${cat1}), eyes peek, ${cat1} glows`);

// a wrong spot: something funny comes out, nothing lost
const wrong = room1.find((s) => s !== cat1);
await say(p, `abre ${SPOKEN[wrong].split(' ').pop()}`);
await p.waitForTimeout(1000);
assert.equal(await p.evaluate((s) => getComputedStyle(document.querySelector(`.slot[data-spot=${s}] .thing`)).opacity, wrong), '1', 'the item is out');
await shot(p, 'ipad-5-wrong-spot');
await settled(p);
assert.equal((await body(p)).goal, cat1);
step(`"${wrong}": an item pops out, still waiting for ${cat1}`);

await say(p, SPOKEN[cat1]);
await p.waitForTimeout(1200);
await shot(p, 'ipad-6-found');
await settled(p);
b = await body(p);
assert.equal(b.found, 'true');
assert.equal(b.goal, 'gato');
step(`"${SPOKEN[cat1]}": the cat is there, "chama o gato" glows`);

await say(p, 'vem gatinho');
await settled(p);
b = await body(p);
assert.equal(b.phase, 'party');
await p.waitForTimeout(600);
assert.ok(await p.evaluate(() => document.querySelectorAll('#confetti i').length > 0), 'confetti');
await shot(p, 'ipad-7-party');
assert.deepEqual(await lost(p), []);
assert.equal(b.fired, '5', '5 commands');
step('"vem gatinho": the cat comes, celebration after 5 commands');

await p.waitForFunction(() => document.body.dataset.phase === 'play' && document.body.dataset.runs === '1', null, { timeout: 6000 });
b = await body(p);
assert.equal(b.goal, 'luz');
assert.equal(b.lit, 'false');
assert.equal(b.found, 'false');
assert.notEqual(b.cat, cat1, 'the cat hides somewhere else');
await p.waitForFunction(() => getComputedStyle(document.getElementById('beam')).opacity === '1', null, { timeout: 2000 }); // dark again
await shot(p, 'ipad-8-next-room');
step(`next room: dark again, cat moved ${cat1} -> ${b.cat}`);

// buttons fire too
await p.click('[data-cmd=luz]', { force: true }); // the glowing button never stops moving
b = await body(p);
assert.equal(b.fired, '6');
await settled(p);
assert.equal((await body(p)).lit, 'true');
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
await shot(p, 'ipad-9-tap-to-resume');
await p.mouse.click(300, 300); // anywhere: the scene, not a button
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
assert.ok(await p.isHidden('#tap-resume'));
assert.equal((await p.evaluate(() => window.__starts)).at(-1), 'tap');
b = await body(p);
await say(p, 'chama o gato');
assert.equal((await body(p)).fired, String(Number(b.fired) + 1));
step('restarts refused without a tap: whole-screen tap target, one tap brings the mic back');
await p.close();

// ---------- iPhone portrait ----------
p = await open({ width: 390, height: 844 });
await shot(p, 'iphone-1-start');
await p.click('#start');
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
await say(p, 'cadê o bichinho');
await shot(p, 'iphone-2-dark');
await p.evaluate(watchCat);
const rooms = await layout(p);
const far = rooms[0] === (await body(p)).cat ? rooms[3] : rooms[0];
await say(p, SPOKEN[far]);
await p.waitForTimeout(1200);
assert.ok((await inView(p, far)) >= 0.6, 'the camera follows to the far spot');
await shot(p, 'iphone-3-flashlight-spot');
await settled(p);
for (const g of ['luz', 'gato']) {
  assert.equal((await body(p)).goal, g);
  await say(p, SPOKEN[g]);
  if (g === 'gato') {
    await p.waitForTimeout(500);
    assert.ok((await inView(p, (await body(p)).cat)) >= 0.6, 'the meowing spot is in view');
    await shot(p, 'iphone-4-meow');
  }
  await settled(p);
}
await say(p, SPOKEN[(await body(p)).goal]);
await p.waitForTimeout(1200);
await shot(p, 'iphone-5-found');
await settled(p);
await say(p, 'chama o gato');
await settled(p);
await p.waitForTimeout(600);
await shot(p, 'iphone-6-party');
assert.equal((await body(p)).phase, 'party');
assert.deepEqual(await lost(p), []);
const noScroll = await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth);
assert.ok(noScroll, 'no scroll');
step('iPhone portrait: plays to the cat, camera follows, no scroll');
await p.close();

// ---------- every command everywhere, both screens, a few rooms ----------
for (const [vp, rnd, name] of [
  [{ width: 1180, height: 820 }, 0.3, 'iPad'],
  [{ width: 390, height: 844 }, 0.7, 'iPhone'],
  [{ width: 390, height: 844 }, 0.05, 'iPhone'],
  [{ width: 1180, height: 820 }, 0.95, 'iPad'],
]) {
  p = await open(vp, '', rnd);
  await p.click('#start');
  const b0 = await body(p);
  await everyCommandEverywhere(p, `${name}, cat in ${b0.cat}, room ${(await layout(p)).join(' ')}`);
  await p.close();
}

// ?debug overlay
p = await open({ width: 1180, height: 820 }, '?debug');
await p.click('#start');
await say(p, 'acende a luz');
await p.waitForTimeout(300);
assert.match(await p.textContent('.dbg-log'), /fire luz \(voice\)/);
await shot(p, 'ipad-10-debug');
step('?debug log shows recognition and commands');

assert.deepEqual(errors, []);
await browser.close();
server.close();
console.log('e2e ok');
