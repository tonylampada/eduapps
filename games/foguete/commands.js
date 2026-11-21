// Spotting the ride's commands inside whatever the recognizer heard.

export const COMMANDS = {
  liga: { label: 'liga', icon: '🔑', forms: ['liga', 'ligar', 'ligo', 'ligue', 'ligou', 'ligando', 'ligado', 'ligada', 'liguei', 'liguinha'] },
  acelera: {
    label: 'acelera',
    icon: '💨',
    forms: ['acelera', 'acelerar', 'acelero', 'acelere', 'acelerou', 'acelerando', 'acelerado', 'aceleradinho', 'aceleradinha'],
  },
  para: { label: 'para', icon: '✋', forms: ['para', 'parar', 'paro', 'pare', 'parou', 'parando', 'parado', 'paradinho', 'paradinha'] },
  buzina: { label: 'buzina', icon: '📯', forms: ['buzina', 'buzinar', 'buzine', 'buzinou', 'buzinando', 'buzinada', 'buzininha', 'bibi', 'fonfon'] },
  pula: { label: 'pula', icon: '🦘', forms: ['pula', 'pular', 'pulo', 'pule', 'pulou', 'pulando', 'pulinho', 'pulinha', 'pulam'] },
  vira: { label: 'vira', icon: '🔄', forms: ['vira', 'virar', 'viro', 'vire', 'virou', 'virando', 'virada', 'viradinha', 'gira', 'girar', 'girou'] },
};

// "decola" is "acelera" said to a rocket: same command, its own word.
const DECOLA = ['decola', 'decolar', 'decole', 'decolou', 'decolando', 'decolagem'];

export const ORDER = ['liga', 'acelera', 'para', 'buzina', 'pula', 'vira'];

// Everyday words one letter away from a command form.
const NEAR_MISSES = ['pagar', 'pagou', 'parque', 'parte', 'pareia', 'escola', 'virgem', 'viram', 'pulga', 'bolinho', 'girafa', 'ligeiro'];

// "para" is also the everyday "for/to" ("vamos para a lua"). Said as a command it
// opens the utterance or follows a call ("caminhão, para!", "ei para"), never a verb.
const CALLS = new Set(['caminhao', 'caminhaozinho', 'foguete', 'carro', 'carrinho', 'ei', 'oi', 'agora', 'entao', 'ja', 'pode', 'por', 'favor', 'opa', 'ai', 'aqui', 'sinal', 'semaforo', 'farol', 'vermelho', 'vermelha']);

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

const FOLDED = [...Object.entries(COMMANDS).map(([cmd, c]) => [cmd, new Set(c.forms.map(fold))]), ['acelera', new Set(DECOLA.map(fold))]];
const NEAR = new Set(NEAR_MISSES.map(fold));

// The command one heard word is, or null. Short words must sound exactly like a
// form ("pala" is not "para"); longer ones may be one sound off ("acelerá").
export function commandOf(word) {
  const f = fold(normalize(word).replace(/ /g, ''));
  if (!f) return null;
  for (const [cmd, forms] of FOLDED) if (forms.has(f)) return cmd;
  if (f.length < 5 || NEAR.has(f)) return null;
  for (const [cmd, forms] of FOLDED) for (const g of forms) if (g.length >= 5 && levenshtein(f, g) <= 1) return cmd;
  return null;
}

// Every command in an utterance, in order: "caminhão, acelera!" -> ['acelera'].
// "bi bi" / "fom fom" is a honk.
export function spot(text) {
  const words = normalize(text).split(' ').filter(Boolean);
  const out = [];
  const honk = (w) => /^(b+i+|f+o+[mn]+)$/.test(w || '');
  for (let i = 0; i < words.length; i++) {
    if (honk(words[i]) && honk(words[i + 1])) {
      out.push('buzina');
      while (honk(words[i + 1])) i++;
      continue;
    }
    const c = commandOf(words[i]);
    if (!c) continue;
    if (words[i] === 'para' && i > 0 && !CALLS.has(words[i - 1]) && !commandOf(words[i - 1])) continue;
    out.push(c);
  }
  return out;
}
