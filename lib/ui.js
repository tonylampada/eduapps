export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

export function confettiBurst() {
  const emojis = ['🎉', '⭐', '✨', '🎊', '💫'];
  for (let i = 0; i < 14; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.textContent = pick(emojis);
    c.style.left = Math.random() * 100 + 'vw';
    c.style.top = '-30px';
    c.style.animationDelay = Math.random() * 0.3 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1600);
  }
}
