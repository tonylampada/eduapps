// Spotting the house commands inside whatever the recognizer heard.
// A command is its object ("a porta!", "abre a porta", "a porta, abre"): the
// verb is optional and may come before or after. A few verbs name their object
// on their own ("acende" is the light, "chama" is the cat, "embaixo" is the bed).

export const COMMANDS = {
  luz: { verb: 'acende a', label: 'luz', icon: '💡', forms: ['luz', 'luzes', 'luzinha', 'lampada', 'lampadinha', 'abajur', 'interruptor'], cues: ['acende', 'acender', 'acenda', 'acendo', 'acendeu', 'acendendo', 'ascende', 'apaga', 'apagar', 'apagou'] },
  gato: { verb: 'chama o', label: 'gato', icon: '🐱', forms: ['gato', 'gata', 'gatos', 'gatinho', 'gatinha', 'gatao', 'gatu', 'bichano', 'bichaninho', 'miau', 'miaus', 'mia'], cues: ['chama', 'chamar', 'chamo', 'chame', 'chamou', 'chamando', 'psiu', 'pss'] },
  porta: { verb: 'abre a', label: 'porta', icon: '🚪', forms: ['porta', 'portas', 'portinha', 'portao'], cues: [] },
  armario: { verb: 'abre o', label: 'armário', icon: '🧥', forms: ['armario', 'armarios', 'armarinho', 'guardaroupa', 'roupeiro'], cues: [] },
  cama: { verb: 'olha embaixo da', label: 'cama', icon: '🛏️', forms: ['cama', 'camas', 'caminha', 'colchao', 'beliche'], cues: ['embaixo', 'debaixo', 'baixo'] },
  cortina: { verb: 'olha atrás da', label: 'cortina', icon: '🪟', forms: ['cortina', 'cortinas', 'cortininha', 'janela', 'janelinha', 'persiana'], cues: [] },
};

export const ORDER = ['luz', 'gato', 'porta', 'armario', 'cama', 'cortina'];

// Everyday words one sound away from a long form ("torta" ~ "porta").
const NEAR_MISSES = ['porto', 'torta', 'corta', 'porca', 'morta', 'horta', 'parta', 'portal', 'perto', 'armado', 'cortinha', 'cortei', 'cantina', 'chamada', 'janta'];

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

const fam = (key) => Object.entries(COMMANDS).map(([cmd, c]) => [cmd, new Set(c[key].map(fold))]);
const FORMS = fam('forms');
const CUES = fam('cues');
const NEAR = new Set(NEAR_MISSES.map(fold));

function match(f, table) {
  for (const [cmd, set] of table) if (set.has(f)) return cmd;
  if (f.length < 5 || NEAR.has(f)) return null;
  for (const [cmd, set] of table) for (const g of set) if (g.length >= 5 && levenshtein(f, g) <= 1) return cmd;
  return null;
}

// What one heard word is: { cmd, obj: true } for an object, { cmd, obj: false }
// for a verb that names its object, or null. Short words must sound exactly
// like a form ("pato" is not "gato"); longer ones may be one sound off.
export function wordOf(word) {
  const f = fold(normalize(word).replace(/ /g, ''));
  if (!f) return null;
  const o = match(f, FORMS);
  if (o) return { cmd: o, obj: true };
  const c = match(f, CUES);
  return c ? { cmd: c, obj: false } : null;
}

// Every command in an utterance, in order. A verb and its object next to each
// other are one command, whichever comes first: "acende a luz" -> ['luz'], and
// so is "acende" alone, so a growing interim result never fires twice.
export function spot(text) {
  const words = normalize(text).split(' ').filter(Boolean);
  // "guarda roupa" is one word to us
  for (let i = 0; i < words.length - 1; i++) if (words[i] === 'guarda' && /^roupas?$/.test(words[i + 1])) words.splice(i, 2, 'guardaroupa');
  const hits = words.map(wordOf).filter(Boolean);
  const out = [];
  for (let i = 0; i < hits.length; ) {
    let j = i;
    while (j < hits.length && hits[j].cmd === hits[i].cmd) j++;
    const objs = hits.slice(i, j).filter((h) => h.obj).length;
    for (let k = 0; k < Math.max(1, objs); k++) out.push(hits[i].cmd);
    i = j;
  }
  return out;
}

// Vosk's vocabulary is spelled with accents.
const ACCENTED = ['lâmpada', 'gatão', 'portão', 'armário', 'armários', 'colchão'];

// Every word the spotter knows, for a recognizer that listens only for these
// (Vosk, ?engine=vosk). The near misses are in so they have somewhere to land.
export const GRAMMAR = [...Object.values(COMMANDS).flatMap((c) => [...c.forms, ...c.cues, ...c.verb.split(' ')]), ...NEAR_MISSES, 'guarda', 'roupa', ...ACCENTED];
