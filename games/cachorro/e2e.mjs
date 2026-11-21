// Headless run of the dog game with a fake speech recognizer: one continuous
// session the test talks into (interim + final results), and that can be made
// to refuse restarts without a tap, like iOS. Not part of the site build;
// eduapps has no test deps, so point it at any playwright-core:
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs node games/cachorro/e2e.mjs [<screenshot dir>]
//   E2E_URL=https://…/games/cachorro/ checks a published copy instead of this folder.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');

// ---------- the matcher: commands in everyday pt-BR, chatter ignored ----------
const { spot } = await import('./commands.js');
const HEARD = {
  'cachorro, pula!': ['pula'], 'corre corre': ['corre', 'corre'], 'au au': ['late'], 'au au au': ['late'], latiu: ['late'], 'pega o osso': ['pega'],
  senta: ['senta'], sentadinho: ['senta'], 'deita aí': ['deita'], 'pulá': ['pula'], 'corre e pula': ['corre', 'pula'],
  'oi tudo bem': [], 'me deixa': [], 'quero leite': [], 'ao lado': [], 'vou pagar': [], 'a santa': [],
};
for (const [heard, want] of Object.entries(HEARD)) assert.deepEqual(spot(heard), want, `"${heard}"`);
console.log(`✓ matcher: ${Object.keys(HEARD).length} phrases`);

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
const URL_ = process.env.E2E_URL || `http://localhost:${server.address().port}/games/cachorro/`;

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
async function open(viewport, query = '') {
  const ctx = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(fakeSR);
  await page.goto(URL_ + query);
  return page;
}
const shot = (p, name) => shots && p.screenshot({ path: path.join(shots, `${name}.png`) });
const body = (p) => p.evaluate(() => ({ ...document.body.dataset, bubble: document.getElementById('bubble').textContent, cls: document.body.className }));
const say = (p, text, final = true) => p.evaluate(([t, f]) => window.__sr.say(t, f), [text, final]);
const settled = (p) => p.waitForFunction(() => document.body.dataset.goal || document.body.dataset.phase !== 'play', null, { timeout: 5000 });
const step = (msg) => console.log(`✓ ${msg}`);

// Say whatever glows until the bone is his.
async function playToBone(p) {
  let b;
  let n = 0;
  while ((b = await body(p)).phase === 'play') {
    await say(p, `cachorro, ${b.goal}!`);
    await settled(p);
    assert.ok(++n < 10, 'reaches the bone');
  }
  assert.equal(b.phase, 'party');
  return n;
}

// ---------- iPad landscape ----------
let p = await open({ width: 1180, height: 820 });
await shot(p, 'ipad-1-start');
await p.click('#start');
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
let b = await body(p);
assert.equal(b.phase, 'play');
assert.equal(b.goal, 'corre');
assert.deepEqual(await p.evaluate(() => window.__starts), ['tap']);
step('one tap: mic up, "corre" glows');

for (const chat of ['oi tudo bem', 'quero leite', 'me deixa', 'olha o cachorro']) await say(p, chat);
b = await body(p);
assert.equal(b.fired, undefined, 'chatter fires nothing');
assert.match(b.bubble, /cachorro/);
step('chatter: nothing happens, bubble shows what was heard');

for (const t of ['cachorro', 'cachorro corre']) await say(p, t, false);
assert.equal((await body(p)).fired, '1', 'fired on the interim result');
await say(p, 'cachorro corre', true);
await settled(p);
b = await body(p);
assert.equal(b.fired, '1', 'the final result does not fire again');
assert.equal(b.at, '1');
step('interim "cachorro corre" -> runs, once');

const n = await playToBone(p);
await p.waitForTimeout(600);
assert.ok(await p.evaluate(() => document.querySelectorAll('#confetti i').length > 0), 'confetti');
await shot(p, 'ipad-2-party');
step(`plays to the bone in ${n + 1} commands, party`);

await p.waitForFunction(() => document.body.dataset.phase === 'play' && document.body.dataset.runs === '1', null, { timeout: 6000 });
b = await body(p);
await p.click('[data-cmd=senta]', { force: true });
assert.equal((await body(p)).fired, String(Number(b.fired) + 1));
await settled(p);
step('tapping a button fires its command');

await p.evaluate(() => window.__sr.end());
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
assert.equal((await p.evaluate(() => window.__starts)).at(-1), 'no-tap');
step('session ended: restarted without a tap');

await p.evaluate(() => ((window.__srNeedsTap = true), window.__sr.end()));
await p.waitForSelector('#tap-resume:not([hidden])', { timeout: 5000 });
assert.ok((await body(p)).cls.includes('ear-tap'));
await shot(p, 'ipad-3-tap-to-resume');
await p.mouse.click(300, 300);
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
assert.ok(await p.isHidden('#tap-resume'));
assert.equal((await p.evaluate(() => window.__starts)).at(-1), 'tap');
b = await body(p);
await say(p, 'late');
assert.equal((await body(p)).fired, String(Number(b.fired) + 1));
step('restarts refused without a tap: whole-screen tap target, one tap brings the mic back');
await p.close();

// ---------- iPhone portrait ----------
p = await open({ width: 390, height: 844 });
await p.click('#start');
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
await playToBone(p);
const noScroll = await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth);
assert.ok(noScroll, 'no scroll');
await shot(p, 'iphone-1-party');
step('iPhone portrait: plays to the bone, no scroll');
await p.close();

// ---------- ?debug overlay ----------
p = await open({ width: 1180, height: 820 }, '?debug');
await p.click('#start');
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
await say(p, 'corre');
await p.waitForTimeout(300);
const log = await p.textContent('.dbg-log');
assert.match(log, /fire corre \(voice\)/);
assert.match(log, /result \[0 final\] "corre"/);
assert.match(await p.textContent('.dbg-status'), /sr#1 up/);
step('?debug log shows recognition and commands');
await p.close();

assert.deepEqual(errors, []);
await browser.close();
server.close();
console.log('e2e ok');
