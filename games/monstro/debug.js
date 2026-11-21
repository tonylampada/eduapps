// On-screen log behind ?debug, for a device with no dev tools (the iPad).
// The pure helpers are exported for tests; no DOM is touched until initDebug().

const KEEP = 400; // lines kept for "copiar"
const SHOW = 30; // lines on screen
const lines = [];
let on = false;
let pre = null;
let dirty = false;

// ?debug  ?meter=0|1   (a bare key means on)
export function readFlags(search) {
  const p = new URLSearchParams(search);
  const flag = (k) => (p.has(k) ? !/^(0|false|off|no)$/i.test(p.get(k)) : null);
  return { debug: flag('debug') === true, meter: flag('meter') ?? true };
}

// iPadOS Safari reports a Mac; a Mac with a touch screen is an iPad.
export function isIOS(ua, platform, touchPoints) {
  return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
}

// SpeechRecognitionResultList (or look-alike) -> one line: index, final, every alternative.
export function describeResults(results, from = 0) {
  const out = [];
  for (let i = from; i < results.length; i++) {
    const r = results[i];
    const alts = Array.from(r, (a) => `"${String(a.transcript).trim()}"${a.confidence ? ` ${a.confidence.toFixed(2)}` : ''}`);
    out.push(`[${i}${r.isFinal ? ' final' : ''}] ${alts.join(' | ')}`);
  }
  return out.join(' ; ');
}

export function dbg(msg) {
  if (!on) return;
  const t = (performance.now() / 1000).toFixed(2).padStart(7);
  const last = lines[lines.length - 1];
  if (last && last.msg === msg) {
    last.n++;
    last.t = t;
  } else {
    lines.push({ t, msg, n: 1 });
    if (lines.length > KEEP) lines.shift();
  }
  if (!dirty) {
    dirty = true;
    setTimeout(render, 50);
  }
}

const fmt = (l) => `${l.t} ${l.msg}${l.n > 1 ? ` ×${l.n}` : ''}`;

function render() {
  dirty = false;
  if (!pre) return;
  pre.textContent = lines.slice(-SHOW).map(fmt).join('\n');
}

// status(): one live line (state, mic, meter level) refreshed 4×/s above the log.
export function initDebug(status) {
  on = true;
  const box = document.createElement('div');
  box.className = 'dbg';
  box.innerHTML = '<div class="dbg-bar"><span class="dbg-status"></span><button type="button" data-a="copy">copiar</button><button type="button" data-a="fold">–</button></div><pre class="dbg-log"></pre>';
  document.body.append(box);
  pre = box.querySelector('.dbg-log');
  const st = box.querySelector('.dbg-status');
  const copy = box.querySelector('[data-a=copy]');
  const fold = box.querySelector('[data-a=fold]');
  // The buttons must not reach the game's own tap handlers.
  box.addEventListener('click', (e) => e.stopPropagation());
  fold.onclick = () => {
    box.classList.toggle('folded');
    fold.textContent = box.classList.contains('folded') ? '+' : '–';
  };
  copy.onclick = () => {
    const text = `${status()}\n${lines.map(fmt).join('\n')}`;
    const done = (ok) => {
      copy.textContent = ok ? 'copiado ✓' : 'falhou';
      setTimeout(() => (copy.textContent = 'copiar'), 1500);
    };
    const old = () => {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        // nothing else to try
      }
      ta.remove();
      done(ok);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), old);
    else old();
  };
  setInterval(() => (st.textContent = status()), 250);
  render();
}
