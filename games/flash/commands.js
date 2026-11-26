// Spotting the hero's words inside whatever the recognizer heard, and putting
// "Flash" together with the verb said next to it.

export const COMMANDS = {
  corre: { label: 'corre', icon: '🏃' },
  super: { label: 'Flash corre', icon: '⚡🏃' },
  pula: { label: 'pula', icon: '🦘' },
  superpula: { label: 'Flash pula', icon: '⚡🦘' },
  para: { label: 'para', icon: '✋' },
};
export const ORDER = ['corre', 'super', 'pula', 'superpula', 'para'];

// Words as the recognizer may write them. "Flash" is English: the browser's
// recognizer writes it as heard, and a child may say "fléchi".
const FORMS = {
  corre: ['corre', 'correr', 'corra', 'corri', 'correu', 'correndo', 'corrida', 'corridinha', 'corrinho'],
  pula: ['pula', 'pular', 'pulo', 'pule', 'pulou', 'pulando', 'pulinho', 'pulinha', 'pulam'],
  para: ['para', 'parar', 'paro', 'pare', 'parou', 'parando', 'parado', 'paradinho', 'paradinha'],
  flash: ['flash', 'flashe', 'flashes', 'flesh', 'flex', 'flexi', 'flechi', 'flecha', 'fleche', 'fresh', 'frash', 'flach'],
};

// Everyday words one letter away from a form.
const NEAR_MISSES = ['pagar', 'pagou', 'parque', 'parte', 'pulga', 'flauta', 'fresco', 'fresca', 'flor', 'corrente'];

// "para" is also the everyday "for/to" ("vou para casa"). Said as a command it
// opens the utterance or follows a call ("Flash, para!", "ei para"), never a verb.
const CALLS = new Set(['ei', 'oi', 'agora', 'entao', 'ja', 'pode', 'por', 'favor', 'opa', 'ai', 'aqui', 'heroi', 'carro', 'menino']);

export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ç/g, 's')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function undiminish(w) {
  if (w.length < 6) return w;
  return w.replace(/zinh([oa])s?$/, '').replace(/inh([oa])s?$/, '$1');
}

// Rough "how it sounds" key for one normalized word.
export function fold(word) {
  return undiminish(word)
    .replace(/^h/, '')
    .replace(/ch|sh/g, 'x')
    .replace(/lh/g, 'li')
    .replace(/nh/g, 'ni')
    .replace(/gu(?=[ei])/g, 'G')
    .replace(/g(?=[ei])/g, 'j')
    .replace(/G/g, 'g')
    .replace(/qu(?=[ei])/g, 'k')
    .replace(/c(?=[ei])/g, 's')
    .replace(/[cq]/g, 'k')
    .replace(/z/g, 's')
    .replace(/w/g, 'u')
    .replace(/y/g, 'i')
    .replace(/ei/g, 'e')
    .replace(/ou/g, 'o')
    .replace(/l(?=[^aeiou]|$)/g, 'u')
    .replace(/m(?=[^aeiou]|$)/g, 'n')
    .replace(/(.)\1+/g, '$1')
    .replace(/o(s?)$/, 'u$1')
    .replace(/e(s?)$/, 'i$1');
}

export function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const FOLDED = Object.entries(FORMS).map(([w, forms]) => [w, new Set(forms.map(fold))]);
const NEAR = new Set(NEAR_MISSES.map(fold));

// The word one heard word is (corre | pula | para | flash), or null. Short words
// must sound exactly like a form; longer ones may be one sound off ("pulá").
export function wordOf(word) {
  const f = fold(normalize(word).replace(/ /g, ''));
  if (!f) return null;
  for (const [w, forms] of FOLDED) if (forms.has(f)) return w;
  if (f.length < 5 || NEAR.has(f)) return null;
  for (const [w, forms] of FOLDED) for (const g of forms) if (g.length >= 5 && levenshtein(f, g) <= 1) return w;
  return null;
}

// "flashcorre": the recognizer sometimes writes the two words as one.
function glued(word) {
  if (word.length < 8) return null;
  for (let i = 4; i <= word.length - 4; i++) {
    const a = wordOf(word.slice(0, i));
    const b = a === 'flash' && wordOf(word.slice(i));
    if (b && b !== 'flash') return [a, b];
  }
  return null;
}

// Every known word in an utterance, in order: "Flash, corre!" -> ['flash', 'corre'].
// Kept as single words so a growing interim result ("corre" -> "corre Flash")
// still brings the late "flash" as something new.
export function spot(text) {
  const words = normalize(text).split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = wordOf(words[i]);
    if (!w) {
      const two = glued(words[i]);
      if (two) out.push(...two);
      continue;
    }
    if (w === 'para' && words[i] === 'para' && i > 0 && !CALLS.has(words[i - 1]) && !wordOf(words[i - 1])) continue;
    out.push(w);
  }
  return out;
}

export const ARM_MS = 2500; // "Flash ..." then the verb, still the same breath
export const LATE_MS = 1200; // "corre ... Flash": the verb already went, Flash upgrades it

const VERB = new Set(['corre', 'pula']);

// Around the verb at items[k], in the same text: "Flash, corre!" (a "flash"
// right before it) or "corre, Flash!" (right after it, and no verb after that
// "flash" to claim it: "corre, Flash corre" is a corre then a Flash corre).
export function flashNear(items, k) {
  return { before: items[k - 1] === 'flash', after: items[k + 1] === 'flash' && !VERB.has(items[k + 2]) };
}

// Words in, commands out. Stateful (when the last "flash" and the last plain
// verb were heard), so one per game. The text decides first (near, from
// flashNear): the recognizer may hand over the verb in a later result than its
// "flash", or rewrite that "flash" away, and the clock alone then misses it.
// -> { cmd, why, upgrade } (upgrade: a "flash" came after its verb), or null.
export function createCombiner() {
  let armedAt = -1e9;
  let plain = null; // { cmd, at } the last corre/pula that went out without Flash
  return (word, now, near = {}) => {
    if (word === 'flash') {
      if (plain && now - plain.at < LATE_MS) {
        const up = { cmd: plain.cmd === 'corre' ? 'super' : 'superpula', upgrade: true, why: `flash ${now - plain.at} ms after a plain ${plain.cmd}` };
        plain = null;
        return up;
      }
      armedAt = now;
      return null;
    }
    if (word === 'para') {
      armedAt = -1e9;
      plain = null;
      return { cmd: 'para', why: 'para' };
    }
    const armed = now - armedAt < ARM_MS;
    if (near.before || near.after || armed) {
      const why = near.before ? 'flash before it' : near.after ? 'flash after it' : `flash heard ${now - armedAt} ms ago`;
      armedAt = -1e9;
      plain = null;
      return { cmd: word === 'corre' ? 'super' : 'superpula', why };
    }
    plain = { cmd: word, at: now };
    return { cmd: word, why: 'no flash near it' };
  };
}

// Vosk's vocabulary (vosk-model-small-pt-0.3) has "flash", "flex", "flecha" and
// "fresh"; the other spellings above are only for the browser's recognizer.
const VOSK_FLASH = ['flash', 'flashes', 'flex', 'flecha', 'fresh'];

// Every word the spotter knows, for a recognizer that listens only for these
// (Vosk, ?engine=vosk). The near misses are in so they have somewhere to land.
export const GRAMMAR = [...FORMS.corre, ...FORMS.pula, ...FORMS.para, ...VOSK_FLASH, ...NEAR_MISSES, ...CALLS, 'já', 'aí', 'então', 'herói'];
