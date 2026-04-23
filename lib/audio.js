// Áudio sintetizado via Web Audio — sem assets externos.

let audioCtx = null;
let musicTimer = null;
let masterMusicGain = null;
let musicOn = true;

export function ensureCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Loop pentatônico calmo de fundo.
export function startMusic() {
  ensureCtx();
  stopMusic();
  masterMusicGain = audioCtx.createGain();
  masterMusicGain.gain.value = 0.035;
  masterMusicGain.connect(audioCtx.destination);

  const notes = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25]; // C pentatonic

  function playNote() {
    if (!musicOn || !masterMusicGain) return;
    const freq = notes[Math.floor(Math.random() * notes.length)];
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = audioCtx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.6);
    g.gain.linearRampToValueAtTime(0, t + 2.8);
    osc.connect(g).connect(masterMusicGain);
    osc.start(t);
    osc.stop(t + 3);
    musicTimer = setTimeout(playNote, 1400 + Math.random() * 800);
  }
  playNote();
}

export function stopMusic() {
  if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; }
  if (masterMusicGain) { try { masterMusicGain.disconnect(); } catch(e){} masterMusicGain = null; }
}

export function toggleMusic() {
  musicOn = !musicOn;
  if (musicOn) startMusic(); else stopMusic();
  return musicOn;
}

export function isMusicOn() { return musicOn; }

export function playSuccess() {
  ensureCtx();
  [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const t = audioCtx.currentTime + i * 0.08;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.04);
    g.gain.linearRampToValueAtTime(0, t + 0.35);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.35);
  });
}

export function playWrong() {
  ensureCtx();
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(300, audioCtx.currentTime);
  osc.frequency.linearRampToValueAtTime(200, audioCtx.currentTime + 0.25);
  g.gain.setValueAtTime(0.15, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);
  osc.connect(g).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.3);
}
