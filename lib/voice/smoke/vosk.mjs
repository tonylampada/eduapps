// Smoke test of the local engine (?engine=vosk) on the BUILT site, in headless
// Chromium with a fake mic that plays cachorro-pula.wav (pt-BR TTS, "cachorro,
// pula!", looped). Checks the real model loads, the real recognizer hears the
// command and the dog game fires it; then a cached reload, the fallback to the
// web engine when the model can't load, and the engine choice sticking.
//   npm run build
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs node lib/voice/smoke/vosk.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pickEngine } from '../engine.js';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const step = (msg) => console.log(`✓ ${msg}`);

// ---------- the choice: ?engine= sticks, storage may throw ----------
const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};
const st = mem();
assert.equal(pickEngine('', st), 'web');
assert.equal(pickEngine('?engine=vosk', st), 'vosk');
assert.equal(pickEngine('?debug', st), 'vosk', 'kept');
assert.equal(pickEngine('?engine=web', st), 'web');
assert.equal(pickEngine('', st), 'web', 'switched back');
assert.equal(pickEngine('?engine=nope', st), 'web');
const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
assert.equal(pickEngine('?engine=vosk', broken), 'vosk');
assert.equal(pickEngine('', broken), 'web');
assert.equal(pickEngine('', null), 'web');
step('engine choice: ?engine=vosk sticks, ?engine=web switches back, storage errors ignored');

// ---------- the built site ----------
const dist = path.resolve(new URL('../../../dist/', import.meta.url).pathname) + '/';
assert.ok(fs.existsSync(path.join(dist, 'models/vosk-model-small-pt-0.3.tar.gz')), 'npm run build first (dist/models/ missing)');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.gz': 'application/gzip' };
const server = http.createServer((req, res) => {
  const f = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  if (!f.startsWith(dist) || !fs.existsSync(f)) return res.writeHead(404).end();
  const data = fs.readFileSync(f);
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'content-length': data.length }).end(data);
});
await new Promise((r) => server.listen(0, r));
const GAME = `http://localhost:${server.address().port}/games/cachorro/`;

const wav = new URL('./cachorro-pula.wav', import.meta.url).pathname;
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.stack || e}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
};
const body = (p) => p.evaluate(() => ({ ...document.body.dataset, cls: document.body.className }));
const log = (p) => p.evaluate(() => document.querySelector('.dbg-log')?.textContent || '');

// ---------- first visit: download, unpack, hear "pula" ----------
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, permissions: ['microphone'] });
let p = await ctx.newPage();
watch(p);
let t0 = Date.now();
await p.goto(`${GAME}?engine=vosk&debug`);
// the start screen shows the download
await p.waitForFunction(() => /baixando a voz… \d+%/.test(document.querySelector('.voice-model')?.textContent || ''), null, { timeout: 20000 });
const pct = await p.textContent('.voice-model');
await p.waitForFunction(() => document.body.dataset.voiceModel === 'ready', null, { timeout: 180000 });
const firstLoad = Date.now() - t0;
assert.ok(await p.isHidden('.voice-model'), 'progress pill gone once ready');
step(`first load: progress on the start screen ("${pct}"), model ready in ${(firstLoad / 1000).toFixed(1)} s`);

// the on-screen log shows the last 30 lines, redrawn every 50 ms: wait for each line
const seen = (re) => p.waitForFunction((src) => new RegExp(src).test(document.querySelector('.dbg-log').textContent), re.source, { timeout: 10000 });
await seen(/engine vosk/);
await seen(/vosk: model ready in \d+ ms/);
await p.click('#start');
await p.waitForFunction(() => Number(document.body.dataset.fired) >= 1, null, { timeout: 30000 });
await seen(/vosk: mic up, \d+ Hz/);
await seen(/result \[\d+\] "[^"]*pula/); // partial
await seen(/fire pula \(voice\)/);
await seen(/result \[\d+ final\] "[^"]*pula/);
assert.match(await p.textContent('#bubble'), /pula/);
assert.match(await p.textContent('.dbg-status'), /vosk ready/);
assert.ok((await body(p)).cls.includes('ear-on'));
step('fake mic "cachorro, pula!" -> Vosk partial + final -> the dog game fires pula');
for (const line of (await log(p)).split('\n').filter((x) => /vosk:|engine|result/.test(x)).slice(0, 12)) console.log(`    ${line}`);

// ---------- reload: no download (IndexedDB + Cache API) ----------
t0 = Date.now();
let downloads = 0;
p.on('request', (r) => r.url().endsWith('.tar.gz') && downloads++);
await p.reload();
await p.waitForFunction(() => document.body.dataset.voiceModel === 'ready', null, { timeout: 60000 });
const secondLoad = Date.now() - t0;
assert.equal(downloads, 0, 'the model is not downloaded again');
await seen(/engine vosk/); // the choice stuck without ?engine
step(`second load (no ?engine, cached): model ready in ${(secondLoad / 1000).toFixed(1)} s, 0 downloads`);
await p.close();

// ---------- ?engine=web switches back ----------
p = await ctx.newPage();
watch(p);
await p.goto(`${GAME}?engine=web&debug`);
await p.goto(`${GAME}?debug`);
await p.waitForFunction(() => /engine web/.test(document.querySelector('.dbg-log').textContent));
assert.ok(await p.isHidden('.voice-model'), 'no model pill on the web engine');
step('?engine=web switches back and sticks');
await p.close();
await ctx.close();

// ---------- the model can't load: the web engine takes over ----------
const ctx2 = await browser.newContext({ viewport: { width: 1180, height: 820 } });
await ctx2.route('**/*.tar.gz', (r) => r.fulfill({ status: 404, body: 'nope' }));
await ctx2.addInitScript(() => {
  window.__starts = [];
  class FakeSR {
    start() {
      window.__starts.push('web');
      setTimeout(() => (this.onstart?.(), this.onaudiostart?.()), 30);
    }
    stop() {}
    abort() {}
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
});
p = await ctx2.newPage();
p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.stack || e}`));
await p.goto(`${GAME}?engine=vosk&debug`);
await p.waitForFunction(() => document.body.dataset.voiceModel === 'failed', null, { timeout: 30000 });
assert.match(await p.textContent('#note'), /Usando o do navegador/);
await p.click('#start');
await p.waitForFunction(() => document.body.classList.contains('ear-on'));
assert.deepEqual(await p.evaluate(() => window.__starts), ['web']);
await p.waitForFunction(() => /falling back to web/.test(document.querySelector('.dbg-log').textContent));
step('model 404: clear note, the start tap runs the web engine');
await ctx2.close();

// a 404 is reported by vosk-browser's worker as a console error: expected there only
assert.deepEqual(errors, []);
await browser.close();
server.close();
const kb = (f) => Math.round(fs.statSync(f).size / 1024);
const assets = fs.readdirSync(path.join(dist, 'assets'));
const voskJs = assets.find((f) => /^vosk-.*\.js$/.test(f));
const earJs = assets.find((f) => /^ear-.*\.js$/.test(f));
console.log(`sizes: vosk-browser chunk ${kb(path.join(dist, 'assets', voskJs))} KB (lazy, ?engine=vosk only), lib/voice chunk ${kb(path.join(dist, 'assets', earJs))} KB, model ${kb(path.join(dist, 'models/vosk-model-small-pt-0.3.tar.gz'))} KB`);
console.log(`first load ${(firstLoad / 1000).toFixed(1)} s (localhost), cached ${(secondLoad / 1000).toFixed(1)} s`);
console.log('vosk smoke ok');
