// Spotting the dog's commands inside whatever the recognizer heard.

export const COMMANDS = {
  corre: { label: 'corre', icon: '🏃', forms: ['corre', 'correr', 'corra', 'corri', 'correu', 'correndo', 'corrida', 'corridinha', 'corrinho'] },
  pula: { label: 'pula', icon: '🦘', forms: ['pula', 'pular', 'pulo', 'pule', 'pulou', 'pulando', 'pulinho', 'pulinha', 'pulam'] },
  late: { label: 'late', icon: '🐶', forms: ['late', 'latir', 'lati', 'latiu', 'latindo', 'latido', 'auau'] },
  pega: { label: 'pega', icon: '✋', forms: ['pega', 'pegar', 'pego', 'pegue', 'pegou', 'pegando', 'peguei', 'pegadinha'] },
  senta: { label: 'senta', icon: '🪑', forms: ['senta', 'sentar', 'sento', 'sente', 'sentou', 'sentado', 'sentada', 'sentando', 'sentadinho'] },
  deita: { label: 'deita', icon: '😴', forms: ['deita', 'deitar', 'deito', 'deite', 'deitou', 'deitado', 'deitada', 'deitando', 'deitadinho'] },
};

export const ORDER = ['corre', 'pula', 'late', 'pega', 'senta', 'deita'];

// Everyday words one letter away from a command form ("deixar" ~ "deitar").
const NEAR_MISSES = ['deixar', 'deixa', 'deixou', 'deixe', 'santa', 'santo', 'sentir', 'pagar', 'pagou', 'pegada', 'centro', 'leite', 'lado'];

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

const FOLDED = Object.entries(COMMANDS).map(([cmd, c]) => [cmd, new Set(c.forms.map(fold))]);
const NEAR = new Set(NEAR_MISSES.map(fold));

// The command one heard word is, or null. Short words must sound exactly like a
// form ("leite" is not "late"); longer ones may be one sound off ("pulá", "sentá").
export function commandOf(word) {
  const f = fold(normalize(word).replace(/ /g, ''));
  if (!f) return null;
  for (const [cmd, forms] of FOLDED) if (forms.has(f)) return cmd;
  if (f.length < 5 || NEAR.has(f)) return null;
  for (const [cmd, forms] of FOLDED) for (const g of forms) if (g.length >= 5 && levenshtein(f, g) <= 1) return cmd;
  return null;
}

// Every command in an utterance, in order: "cachorro, pula!" -> ['pula'].
// "au au" is a bark.
export function spot(text) {
  const words = normalize(text).split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    if (/^a[uo]$/.test(words[i]) && /^a[uo]$/.test(words[i + 1] || '')) {
      out.push('late');
      while (/^a[uo]$/.test(words[i + 1] || '')) i++;
      continue;
    }
    const c = commandOf(words[i]);
    if (c) out.push(c);
  }
  return out;
}
