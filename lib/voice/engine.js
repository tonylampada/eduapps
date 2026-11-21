// Which recognizer the voice games use: the browser's ('web', the default) or
// Vosk running on the device ('vosk'). ?engine=vosk|web picks one and sticks.

const KEY = 'eduapps.voice.engine';
const ENGINES = ['web', 'vosk'];

// storage: localStorage or a look-alike; any of it may throw (Safari, blocked storage).
export function pickEngine(search, storage) {
  const q = new URLSearchParams(search).get('engine');
  if (ENGINES.includes(q)) {
    try {
      storage?.setItem(KEY, q);
    } catch {
      // the URL still decides this visit
    }
    return q;
  }
  try {
    const kept = storage?.getItem(KEY);
    if (ENGINES.includes(kept)) return kept;
  } catch {
    // nothing kept
  }
  return 'web';
}

export function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
