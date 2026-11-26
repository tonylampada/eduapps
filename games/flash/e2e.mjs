// Headless run of the race with a fake speech recognizer (one continuous
// session the test talks into, interim + final results), and a fake mic that
// plays a generated hiss or a recorded phrase, for the "chhhhh" detector. Not
// part of the site build; eduapps has no test deps, so point it at any playwright-core:
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs node games/flash/e2e.mjs [<screenshot dir>]
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const step = (msg) => console.log(`✓ ${msg}`);

// ---------- the words, and Flash put together with its verb ----------
const { spot, createCombiner, flashNear } = await import('./commands.js');
const HEARD = {
  'Flash corre': ['flash', 'corre'], 'corre Flash': ['corre', 'flash'], 'fléchi, pula!': ['flash', 'pula'], 'flex corre': ['flash', 'corre'],
  'Flash Core': ['flash', 'corre'], 'Fresh corre': ['flash', 'corre'], Flashcorre: ['flash', 'corre'], 'flashpula!': ['flash', 'pula'],
  corre: ['corre'], 'pulá': ['pula'], 'Flash, para!': ['flash', 'para'], para: ['para'],
  'oi tudo bem': [], 'vou para casa': [], 'que flor bonita': [], 'quero uma pulga': [], 'olha o carro': [],
};
for (const [heard, want] of Object.entries(HEARD)) assert.deepEqual(spot(heard), want, `"${heard}"`);
const c = createCombiner();
const said = [['flash', 0], ['corre', 400], ['corre', 5000], ['flash', 5500], ['pula', 9000], ['flash', 20000], ['pula', 30000], ['flash', 40000], ['para', 40500], ['corre', 41000]];
assert.deepEqual(said.map(([w, t]) => c(w, t)?.cmd ?? null), [null, 'super', 'corre', 'super', 'pula', null, 'pula', null, 'para', 'corre']);
// the text decides when the clock can't: "flash" rewritten away from its fresh items, or said long ago
const c2 = createCombiner();
assert.equal(c2('corre', 0, flashNear(['flash', 'corre'], 1)).cmd, 'super', 'flash before it in the text');
assert.equal(c2('corre', 9000, flashNear(['corre', 'flash'], 0)).cmd, 'super', 'flash after it in the text');
assert.equal(c2('corre', 20000, flashNear(['corre', 'flash', 'corre'], 0)).cmd, 'corre', 'that flash is the next verb\'s');
assert.equal(c2('corre', 30000, flashNear(['flash', 'corre', 'corre'], 2)).cmd, 'corre', 'a corre after a Flash corre is plain');
step(`matcher: ${Object.keys(HEARD).length} phrases; "Flash" before or right after the verb makes it super`);

const { newRace, step: move, goal, START } = await import('./track.js');
let r = newRace(null, () => 0.3);
for (let i = 0; i < 5; i++) assert.notEqual(newRace(r).order.join(), r.order.join(), 'a new race changes the order');
const jog = move(r, 'corre');
const zoom = move(r, 'super');
assert.equal(jog.fx, 'jog');
assert.equal(zoom.fx, 'zoom');
assert.ok(zoom.race.x > jog.race.x, 'Flash corre goes further');
const through = move(zoom.race, 'super');
assert.equal(through.fx, 'zoom', 'at an obstacle Flash corre runs, it does not jump');
assert.ok(through.race.cleared[0] && through.race.x > zoom.race.x + 60, 'straight through to the next one');
assert.equal(move(zoom.race, 'pula').fx, 'hop');
step('track: "corre" jogs, "Flash corre" zooms further (through obstacles too), new race new order');

// ---------- the page ----------
const root = new URL('../../', import.meta.url).pathname; // the repo: the game imports lib/voice/
const shots = process.argv[2];
if (shots) fs.mkdirSync(shots, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html');
  if (p.startsWith('/voice/')) p = `/public${p}`; // Vite serves public/ at the root
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
});
await new Promise((ok) => server.listen(0, ok));
const URL_ = process.env.E2E_URL || `http://localhost:${server.address().port}/games/flash/`;

function fakeSR() {
  class FakeSR {
    start() {
      window.__sr = this;
      this.list = [];
      setTimeout(() => (this.onstart?.(), this.onaudiostart?.()), 30);
    }
    say(text, final) {
      const last = this.list[this.list.length - 1];
      const r = Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal: final });
      if (last && !last.isFinal) this.list[this.list.length - 1] = r;
      else this.list.push(r);
      this.onresult?.({ results: this.list, resultIndex: this.list.length - 1 });
    }
    // iOS: the session's text as it stands now, rewritten from the start; one
    // result, or re-segmented into several.
    set(texts, final) {
      this.list = texts.map((t, i) => Object.assign([{ transcript: t, confidence: 0.9 }], { isFinal: final || i < texts.length - 1 }));
      this.onresult?.({ results: this.list, resultIndex: 0 });
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

const errors = [];
async function open(browser, viewport, query = '') {
  const ctx = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  await page.addInitScript(fakeSR);
  await page.addInitScript(() => localStorage.setItem('eduapps.voice.tapActs', '0')); // voice-only mode: the asserts expect taps to only speak
  await page.goto(URL_ + query);
  return page;
}
const shot = (p, name) => shots && p.screenshot({ path: path.join(shots, `${name}.png`) });
const body = (p) => p.evaluate(() => ({ ...document.body.dataset, bubble: document.getElementById('bubble').textContent }));
const say = (p, text, final = true) => p.evaluate(([t, f]) => window.__sr.say(t, f), [text, final]);
const settled = (p) => p.waitForFunction(() => document.body.dataset.goal || document.body.dataset.phase !== 'play', null, { timeout: 5000 });
const PHRASE = { super: 'Flash corre', superpula: 'Flash pula' };

// Say whatever glows until he wins.
async function playToFinish(p, mid) {
  let b;
  let n = 0;
  while ((b = await body(p)).phase === 'play') {
    await say(p, `${PHRASE[b.goal]}!`);
    if (n === 1 && mid) await p.waitForTimeout(400).then(mid);
    await settled(p);
    assert.ok(++n < 12, 'reaches the finish');
  }
  assert.equal(b.phase, 'party');
  return n;
}

let browser = await chromium.launch();

// ---------- iPad landscape ----------
let p = await open(browser, { width: 1180, height: 820 });
await shot(p, 'ipad-1-start');
await p.click('#start');
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
let b = await body(p);
assert.equal(b.phase, 'play');
assert.equal(b.goal, 'super');
assert.ok(await p.isVisible('[data-cmd=super].goal'), '"Flash corre" glows');
step('one tap: mic up, "Flash corre" glows');

for (const chat of ['oi tudo bem', 'vou para casa', 'olha o carro']) await say(p, chat);
b = await body(p);
assert.equal(b.fired, undefined, 'chatter fires nothing');
assert.match(b.bubble, /carro/);
step('chatter: nothing happens, bubble shows what was heard');

await say(p, 'corre');
await settled(p);
b = await body(p);
assert.equal(b.fx, 'jog');
const jogged = b.at - START;
await p.waitForTimeout(1300); // past the "corre ... Flash" window
await say(p, 'Flash', false);
await p.waitForSelector('#hero.charged');
await say(p, 'Flash corre', false);
await say(p, 'Flash corre', true);
await settled(p);
const b2 = await body(p);
assert.equal(b2.fx, 'zoom');
assert.equal(b2.fired, '2', 'interim + final fire once');
assert.ok(b2.at - b.at > jogged, `Flash corre (${b2.at - b.at}) goes further than corre (${jogged})`);
step(`"corre" jogs ${jogged}, "Flash corre" zooms ${b2.at - b.at}`);

// at the first obstacle: "pula" plain, then "para" lets the car catch up
await say(p, 'para');
await settled(p);
b = await body(p);
assert.equal(b.fx, 'stop');
assert.ok(b.at - b.car <= 12, 'the car caught up');
await p.waitForTimeout(800);
await say(p, 'pula');
await settled(p);
assert.equal((await body(p)).fx, 'hop');
step('"para": he waits and the car catches up; "pula" hops the obstacle');

// "corre Flash": the late Flash upgrades the corre
b = await body(p);
await say(p, 'corre', false);
await say(p, 'corre Flash', false);
await say(p, 'corre Flash', true);
await p.waitForFunction(() => document.body.dataset.fx === 'zoom', null, { timeout: 4000 });
await settled(p);
step('"corre Flash": the late Flash makes it super');

const reqs = [];
p.on('request', (q) => reqs.push(q.url()));
b = await body(p);
await p.click('[data-cmd=superpula]', { force: true });
await p.waitForTimeout(300);
assert.equal((await body(p)).fired, b.fired, 'a button does not play');
assert.ok(reqs.some((u) => u.endsWith('/voice/flash-pula.mp3')), 'it says "Flash pula"');
step('a button speaks its words, does not act');

const order = (await body(p)).order;
const n = await playToFinish(p);
await p.waitForTimeout(700);
assert.ok(await p.evaluate(() => document.querySelectorAll('#confetti i').length > 0), 'confetti');
assert.ok(await p.isVisible('#trophy.won'), 'trophy');
await shot(p, 'ipad-3-trophy');
step(`plays to the finish in ${n} more commands: trophy, confetti`);

await p.waitForFunction(() => document.body.dataset.phase === 'play' && document.body.dataset.runs === '1', null, { timeout: 6000 });
b = await body(p);
assert.notEqual(b.order, order, 'new race, new obstacle order');
assert.equal(b.at, String(START));
await playToFinish(p, () => shot(p, 'ipad-2-flash-corre'));
step(`new race (${order} → ${b.order}), won again`);
await p.close();

// ---------- iPhone portrait ----------
p = await open(browser, { width: 390, height: 844 });
await shot(p, 'iphone-1-start');
await p.click('#start');
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
await playToFinish(p, () => shot(p, 'iphone-2-flash-corre'));
await p.waitForTimeout(700);
const noScroll = await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth);
assert.ok(noScroll, 'no scroll');
await shot(p, 'iphone-3-trophy');
step('iPhone portrait: plays to the finish, no scroll');
await p.close();

// ---------- ?debug overlay ----------
p = await open(browser, { width: 1180, height: 820 }, '?debug');
await p.click('#start');
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
await say(p, 'Flash corre');
await p.waitForTimeout(300);
const log = await p.textContent('.dbg-log');
assert.match(log, /fire super \(voice\)/);
assert.match(log, /result \[0 final\] "Flash corre"/);
step('?debug log shows recognition and commands');
await p.close();

// ---------- iOS: one result that keeps growing AND gets rewritten ----------
// [the session's text now, what that adds]. Every "Flash corre" said fires one
// super; none fires as a plain corre or a jump.
p = await open(browser, { width: 1180, height: 820 }, '?debug');
await p.click('#start');
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
const IOS = [
  [['Flash'], null],
  [['Flash corre'], 'super'],
  [['Flash corre flash'], null],
  [['Flash corre, Flash corre'], 'super'], // punctuation rewritten in, the verb appended
  [['Flash corre'], null], // the repeat merged away: shorter
  [['Flash corre flash'], null],
  [['Flash corre flash corre'], 'super'], // the count is back where it was: still new
  [['Flash corre corre flash corre'], 'super'], // a "flash" dropped in the middle, one appended
  'party',
  [['Flash corre flash', 'corre Flash corre'], 'super'], // re-segmented into two results
  [['Flash corre flash', 'corre Flash corre'], null, true], // final, same words
  [['Flash corre flash', 'corre Flash corre', 'Flashcorre'], 'super'], // written as one word
  [['Flash corre flash', 'corre Flash corre', 'Flashcorre corre'], 'corre'], // a plain corre is plain
];
let supers = 0;
for (const ev of IOS) {
  if (ev === 'party') {
    await p.waitForFunction(() => document.body.dataset.phase === 'play' && document.body.dataset.runs === '1', null, { timeout: 8000 });
    continue;
  }
  const [texts, want, final] = ev;
  const before = await body(p);
  await p.evaluate(([t, f]) => window.__sr.set(t, f), [texts, !!final]);
  await p.waitForTimeout(150);
  const b3 = await body(p);
  const label = `"${texts.join(' | ')}"`;
  if (!want) {
    assert.equal(b3.fired, before.fired, `${label}: nothing new`);
    continue;
  }
  assert.equal(Number(b3.fired), Number(before.fired || 0) + 1, `${label}: fires once`);
  assert.ok(want === 'super' ? b3.fx === 'zoom' : ['jog', 'bump'].includes(b3.fx), `${label}: ${want}, got ${b3.fx}`);
  if (want === 'super') supers++;
  await p.waitForFunction(() => !document.body.classList.contains('speed') && (document.body.dataset.goal || document.body.dataset.phase !== 'play'), null, { timeout: 5000 });
  await p.waitForTimeout(150);
}
const iosLog = await p.evaluate(() => document.querySelector('.dbg-log').textContent);
assert.match(iosLog, /combine corre@\d+ flash-before -> super \(flash before it\)/);
assert.match(iosLog, /rewritten shorter|nothing past/);
step(`iOS-style rewritten transcript: ${supers} "Flash corre" -> ${supers} supers, the plain corre jogs; every decision in ?debug`);
await p.close();
await browser.close();

// ---------- the "chhhhh": a fake mic ----------
// 48 kHz 16-bit mono WAV: silence, then white noise high-passed twice (energy
// above ~3 kHz, like "chhh") for `hiss` seconds, then silence. The fake mic loops it.
function wav(file, hiss) {
  const rate = 48000;
  const len = Math.round(rate * (2 + hiss));
  const pcm = Buffer.alloc(len * 2);
  let x1 = 0;
  let x2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const x = Math.random() * 2 - 1;
    const y = t > 1 && t < 1 + hiss ? (x - 2 * x1 + x2) * 0.12 : 0;
    x2 = x1;
    x1 = x;
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(y * 32767))), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
  return file;
}

async function withMic(file, query = '') {
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}`, '--autoplay-policy=no-user-gesture-required'] });
  p = await open(browser, { width: 1180, height: 820 }, query);
  await p.click('#start');
  await p.waitForFunction(() => document.body.classList.contains('metering') && document.body.classList.contains('ear-on'));
  return p;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flash-e2e-'));
p = await withMic(wav(path.join(tmp, 'hiss.wav'), 1.2), '?debug');
await p.waitForFunction(() => document.body.dataset.hiss === '1', null, { timeout: 8000 });
await settled(p);
b = await body(p);
assert.equal(b.fx, 'zoom', 'a hiss is a Flash corre');
assert.match(await p.textContent('.dbg-log'), /hiss: DETECTED/);
step('fake mic "chhhh" 1.2 s: detected once, he zooms; logged under ?debug');
await browser.close();

p = await withMic(wav(path.join(tmp, 'short.wav'), 0.2), '?debug');
await p.waitForTimeout(6000);
assert.match(await p.textContent('.dbg-log'), /hiss: listening/, 'the detector heard the fake mic');
assert.equal((await body(p)).hiss, undefined, 'a 0.2 s "ch" is not a hiss');
await browser.close();

p = await withMic(path.join(root, 'lib/voice/smoke/cachorro-pula.wav'), '?debug');
await p.waitForTimeout(6000);
assert.match(await p.textContent('.dbg-log'), /hiss: listening/, 'the detector heard the fake mic');
assert.equal((await body(p)).hiss, undefined, 'speech is not a hiss');
step('fake mic: a 0.2 s "ch" and the spoken phrase "cachorro, pula!" are not hisses');
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });

assert.deepEqual(errors, []);
server.close();
console.log('e2e ok');
