let voices = [];
function loadVoices() { voices = speechSynthesis.getVoices(); }
loadVoices();
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = loadVoices;
}

/**
 * Fala texto com voz preferida (default: Fernanda Enhanced pt-BR).
 * Fallback: qualquer voz do idioma pedido → qualquer voz pt.
 */
export function speak(text, opts = {}) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = opts.lang || 'pt-BR';
    const preferred = opts.preferredVoice || 'fernanda';
    const re = new RegExp(preferred, 'i');
    const v =
      voices.find(v => re.test(v.name) && /enhanced|premium/i.test(v.name)) ||
      voices.find(v => re.test(v.name)) ||
      voices.find(v => v.lang.startsWith(u.lang)) ||
      voices.find(v => v.lang.startsWith('pt'));
    if (v) u.voice = v;
    u.rate = opts.rate ?? 0.9;
    u.pitch = opts.pitch ?? 1.1;
    speechSynthesis.speak(u);
  } catch (e) {}
}

// iOS exige gesture do usuário pra destravar TTS. Chamar isso no primeiro click.
export function warmup() {
  try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch (e) {}
}
