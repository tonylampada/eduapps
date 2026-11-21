// Spotting "dá a maçã vermelha" inside whatever the recognizer heard.
// normalize/fold/levenshtein come from games/cachorro/commands.js.

export const VERBS = ['da', 'dar', 'de', 'dou', 'deu', 'dei', 'dando', 'come', 'comer', 'coma', 'comi', 'comeu', 'comendo', 'comes', 'quero', 'quer', 'queres', 'queria', 'querer', 'toma', 'tomar', 'tome'];

export const ITEMS = {
  banana: ['banana', 'bananas', 'bananinha'],
  maca: ['maçã', 'maçãs', 'maçãzinha', 'maca'],
  uva: ['uva', 'uvas', 'uvinha', 'uvinhas'],
  pao: ['pão', 'pães', 'pãozinho'],
  bolo: ['bolo', 'bolos', 'bolinho'],
  cenoura: ['cenoura', 'cenouras', 'cenourinha'],
};

export const COLORS = {
  vermelho: ['vermelho', 'vermelha', 'vermelhos', 'vermelhas', 'vermelhinho', 'vermelhinha'],
  verde: ['verde', 'verdes', 'verdinho', 'verdinha'],
  amarelo: ['amarelo', 'amarela', 'amarelos', 'amarelas', 'amarelinho', 'amarelinha'],
  roxo: ['roxo', 'roxa', 'roxos', 'roxas', 'roxinho', 'roxinha', 'lilás'],
  laranja: ['laranja', 'laranjas', 'laranjinha'],
  rosa: ['rosa', 'rosas', 'rosinha', 'rosado', 'rosada', 'morango'],
  marrom: ['marrom', 'marrons', 'chocolate'],
  branco: ['branco', 'branca', 'brancos', 'brancas'],
};

// Everyday words one sound away from a word above ("bacana" ~ "banana").
const NEAR_MISSES = ['bacana', 'senhora', 'perde', 'perdi', 'como', 'comida', 'cara', 'casa', 'mas', 'mais', 'bola', 'bolinha', 'uma', 'vou', 'ver', 'dado', 'dele', 'dela', 'quem'];

// Unaccented "da"/"de" is mostly "of the" ("a cor da maçã"): a verb only where
// "dá"/"dê" would stand, at the start or after one of these.
const BEFORE_BARE_DA = new Set(['monstro', 'monstrinho', 'ei', 'e', 'agora', 'entao', 'me', 'tambem', 'oi', 'por', 'favor']);

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

const NEAR = new Set(NEAR_MISSES.map((w) => fold(normalize(w))));
const table = (dict) => Object.entries(dict).map(([k, forms]) => [k, new Set(forms.map((f) => fold(normalize(f))))]);
const ITEM_F = table(ITEMS);
const COLOR_F = table(COLORS);
const VERB_F = new Set(VERBS.map(fold));

// Short words must sound exactly like a form ("bola" is not "bolo"); longer
// ones may be one sound off ("banan", "vermelia").
function lookup(f, forms) {
  if (!f) return null;
  for (const [k, set] of forms) if (set.has(f)) return k;
  if (f.length < 5 || NEAR.has(f)) return null;
  for (const [k, set] of forms) for (const g of set) if (g.length >= 5 && levenshtein(f, g) <= 1) return k;
  return null;
}

// Words with their accents kept: "dá" vs "da" matters.
function words(text) {
  return String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((raw) => ({ raw, n: normalize(raw) }));
}

function isVerb(ws, i) {
  const { raw, n } = ws[i];
  if (n === 'da' || n === 'de') return raw !== n || i === 0 || BEFORE_BARE_DA.has(ws[i - 1].n);
  return VERB_F.has(fold(n)) && !NEAR.has(fold(n));
}

const WINDOW = 5; // words after the verb where the food (and its color) may be

// Every request in an utterance, in order:
//   "monstro, dá a maçã vermelha" -> [{ item: 'maca', color: 'vermelho', open: false }]
// open: the request runs to the end of the text, so a growing interim result
// may still add its color.
export function spot(text) {
  const ws = words(text);
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    if (!isVerb(ws, i)) continue;
    let item = null;
    let color = null;
    let j = i + 1;
    for (; j < ws.length && j <= i + WINDOW && !isVerb(ws, j); j++) {
      const f = fold(ws[j].n);
      if (!item && (item = lookup(f, ITEM_F))) continue;
      if (!color) color = lookup(f, COLOR_F);
    }
    if (item) out.push({ item, color, open: j >= ws.length });
    i = j - 1;
  }
  return out;
}

export const key = (r) => (r.color ? `${r.item}:${r.color}` : r.item);
