// Corner of the start screen: the speech engine in use with a link to switch, and
// whether a tap on a command button also plays it (easy mode) or only says the word.
const TAP_KEY = 'eduapps.voice.tapActs';

export function tapActs() {
  try { return localStorage.getItem(TAP_KEY) !== '0'; } catch { return true; }
}

export function engineBadge(engine) {
  const to = engine === 'vosk' ? 'web' : 'vosk';
  const el = document.createElement('p');
  el.style.cssText = 'position:fixed;z-index:22;right:10px;bottom:8px;margin:0;font:12px system-ui;color:#555;text-align:right';
  el.innerHTML = `<label style="font-size:16px"><input type="checkbox" ${tapActs() ? 'checked' : ''}> Botões fazem a ação</label><br>Voz: ${engine} · <a href="?engine=${to}">trocar para ${to}</a>`;
  el.querySelector('input').addEventListener('change', (e) => {
    try { localStorage.setItem(TAP_KEY, e.target.checked ? '1' : '0'); } catch {}
  });
  el.addEventListener('click', (e) => e.stopPropagation());
  return el;
}
