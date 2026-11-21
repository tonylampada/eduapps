// The drawings: every food in every color it comes in, and the monster.

export const HEX = {
  vermelho: ['#E5383B', '#A4161A'],
  verde: ['#8CCB4B', '#4E8A22'],
  amarelo: ['#F9D648', '#C79A12'],
  roxo: ['#8E4FC2', '#5B2A86'],
  laranja: ['#F58A2A', '#B9560D'],
  rosa: ['#F79AC0', '#D2588B'],
  marrom: ['#7A4A2A', '#4A2A14'],
  pao: ['#E3A65E', '#A86A2B'],
};

const LEAF = '#3E9B3A';

const DRAW = {
  maca: ([c, d]) => `
    <path d="M32 19c-6-6-23-4-23 14 0 14 10 26 23 26s23-12 23-26c0-18-17-20-23-14z" fill="${c}" stroke="${d}" stroke-width="2"/>
    <ellipse cx="21" cy="30" rx="4" ry="7" fill="#fff" opacity=".35" transform="rotate(20 21 30)"/>
    <path d="M32 19c0-6 2-10 5-13" fill="none" stroke="#6B4423" stroke-width="3" stroke-linecap="round"/>
    <path d="M36 12c6-6 13-4 15-2-4 5-10 6-15 2z" fill="${LEAF}"/>`,
  banana: ([c, d]) => `
    <path d="M9 18c4 24 26 36 46 25 3-2 2-6-1-5-17 6-33-6-38-22-1-3-7-3-7 2z" fill="${c}" stroke="${d}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M16 20c5 13 16 21 30 21" fill="none" stroke="${d}" stroke-width="1.5" opacity=".5"/>
    <path d="M9 18l-1-6 5 1z" fill="#5A3A1E"/>`,
  uva: ([c, d]) => `
    <path d="M32 14c0-4 1-7 3-9" fill="none" stroke="#6B4423" stroke-width="3" stroke-linecap="round"/>
    <path d="M34 11c6-4 12-2 14 0-4 4-9 5-14 0z" fill="${LEAF}"/>
    ${[[22, 20], [32, 19], [42, 20], [17, 30], [27, 30], [37, 30], [47, 30], [22, 40], [32, 40], [42, 40], [27, 50], [37, 50], [32, 59]]
      .map(([x, y]) => `<circle cx="${x}" cy="${y - 2}" r="6.4" fill="${c}" stroke="${d}" stroke-width="1.6"/><circle cx="${x - 2}" cy="${y - 4}" r="1.6" fill="#fff" opacity=".5"/>`)
      .join('')}`,
  pao: ([c, d]) => `
    <path d="M6 42c0-15 11-24 26-24s26 9 26 24v6c0 3-2 5-5 5H11c-3 0-5-2-5-5z" fill="${c}" stroke="${d}" stroke-width="2"/>
    <path d="M18 26l-4 8M30 23l-3 9M42 25l-3 9M52 31l-3 7" stroke="${d}" stroke-width="3" stroke-linecap="round" opacity=".7"/>
    <path d="M8 46h48" stroke="${d}" stroke-width="1.5" opacity=".4"/>`,
  bolo: ([c, d], color) => {
    const sponge = color === 'marrom' ? '#9B6340' : '#FBE0B0';
    return `
    <rect x="9" y="30" width="46" height="24" rx="4" fill="${sponge}" stroke="#C49A62" stroke-width="2"/>
    <rect x="9" y="40" width="46" height="4" fill="${c}" opacity=".8"/>
    <path d="M7 31c0-8 7-13 25-13s25 5 25 13c0 4-3 4-4 7-2 4-6 4-7 0-1-3-4-3-5 0-2 5-7 5-8 0s-5-3-6 0c-2 4-7 4-8-1-1-3-4-3-5 0-2 3-7 2-7-6z" fill="${c}" stroke="${d}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="32" cy="13" r="6" fill="#D7263D"/><path d="M32 8c1-3 3-5 6-6" fill="none" stroke="#3E7B27" stroke-width="2" stroke-linecap="round"/>`;
  },
  cenoura: ([c, d]) => `
    <path d="M28 8c-2 6 0 10 3 12M36 7c1 6-1 10-4 13M44 12c-4 4-8 7-11 8" fill="none" stroke="${LEAF}" stroke-width="4" stroke-linecap="round"/>
    <path d="M20 22c6-5 18-5 24 0 3 3 2 8 0 12L35 56c-1 4-5 4-6 0L20 34c-2-4-3-9 0-12z" fill="${c}" stroke="${d}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M24 30h6M27 39h6M30 47h4" stroke="${d}" stroke-width="2" stroke-linecap="round" opacity=".6"/>`,
};

export function foodSVG(item, color, cls = 'food') {
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true" data-food="${item}" data-color="${color}">${DRAW[item](HEX[color], color)}</svg>`;
}

// The monster faces the viewer; its mouth (the food's target) is .mouth-target.
export const MONSTER = `
<svg class="mon-svg" viewBox="0 0 200 210" aria-hidden="true">
  <g class="arm l"><ellipse cx="26" cy="128" rx="13" ry="24" fill="#3FAE93" transform="rotate(25 26 128)"/></g>
  <g class="arm r"><ellipse cx="174" cy="128" rx="13" ry="24" fill="#3FAE93" transform="rotate(-25 174 128)"/></g>
  <g class="foot l"><ellipse cx="68" cy="196" rx="24" ry="12" fill="#3FAE93"/></g>
  <g class="foot r"><ellipse cx="132" cy="196" rx="24" ry="12" fill="#3FAE93"/></g>
  <g class="body">
    <path d="M62 36 56 6l24 24zM138 36l6-30-24 24z" fill="#F7C948" stroke="#D9A21B" stroke-width="3" stroke-linejoin="round"/>
    <path d="M100 26c52 0 80 40 80 92 0 48-32 76-80 76s-80-28-80-76c0-52 28-92 80-92z" fill="#4FC1A6"/>
    <ellipse cx="100" cy="150" rx="50" ry="38" fill="#A8E6D4"/>
    <circle cx="44" cy="82" r="5" fill="#3FAE93"/><circle cx="160" cy="70" r="7" fill="#3FAE93"/><circle cx="150" cy="160" r="5" fill="#3FAE93"/>
    <g class="eyes">
      <g class="eye-open">
        <circle cx="74" cy="78" r="19" fill="#fff"/><circle cx="126" cy="78" r="19" fill="#fff"/>
        <g class="pupils"><circle cx="76" cy="84" r="8.5" fill="#22223B"/><circle cx="128" cy="84" r="8.5" fill="#22223B"/>
        <circle cx="79" cy="80" r="3" fill="#fff"/><circle cx="131" cy="80" r="3" fill="#fff"/></g>
        <rect class="lid" x="52" y="56" width="96" height="44" fill="#4FC1A6"/>
      </g>
      <g class="eye-squint"><path d="M60 70l18 9-18 9M140 70l-18 9 18 9" fill="none" stroke="#22223B" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g>
      <g class="eye-happy"><path d="M58 84q16-18 32 0M110 84q16-18 32 0" fill="none" stroke="#22223B" stroke-width="6" stroke-linecap="round"/></g>
    </g>
    <circle cx="52" cy="112" r="9" fill="#FF8FB1" opacity=".8"/><circle cx="148" cy="112" r="9" fill="#FF8FB1" opacity=".8"/>
    <g class="mouth">
      <path class="m-smile" d="M74 112q26 24 52 0" fill="none" stroke="#22223B" stroke-width="6" stroke-linecap="round"/>
      <g class="m-open"><ellipse cx="100" cy="122" rx="30" ry="24" fill="#5A1F33"/><ellipse cx="100" cy="136" rx="17" ry="9" fill="#EF6F86"/><path d="M78 104l6 9 6-9 6 9 6-9 6 9 6-9 6 9" fill="#fff"/></g>
      <g class="m-chew"><path d="M78 116q22 10 44 0" fill="none" stroke="#22223B" stroke-width="6" stroke-linecap="round"/><ellipse cx="62" cy="114" rx="11" ry="9" fill="#3FAE93"/><ellipse cx="138" cy="114" rx="11" ry="9" fill="#3FAE93"/></g>
      <g class="m-yuck"><path d="M76 120q8-8 16 0t16 0 16 0" fill="none" stroke="#22223B" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M96 122q8 22 18 2z" fill="#EF6F86" stroke="#C94A64" stroke-width="2"/></g>
    </g>
    <circle class="mouth-target" cx="100" cy="120" r="2" fill="none"/>
  </g>
</svg>`;
