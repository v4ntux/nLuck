// Отрисовка реалистичных карт в SVG (без картинок — всё векторное, чёткое на любом экране)

export const SUIT_SYMBOL = { spades: '♠', clubs: '♣', diamonds: '♦', hearts: '♥' };
export const SUIT_NAME = { spades: 'Пики', clubs: 'Трефы', diamonds: 'Бубны', hearts: 'Червы' };
export const RANK_LABEL = {}; // можно заменить на { J: 'В', Q: 'Д', K: 'К', A: 'Т' }
const RED = '#c8102e';
const BLACK = '#16181d';

export const isRed = suit => suit === 'hearts' || suit === 'diamonds';
export const suitColor = suit => (isRed(suit) ? RED : BLACK);
export const rankLabel = rank => RANK_LABEL[rank] || rank;

// Спрайт с мастями и рубашкой — вставляется в документ один раз
export const SPRITE = `
<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute">
  <defs>
    <symbol id="s-hearts" viewBox="0 0 100 100"><path d="M50 92C22 68 2 50 2 29 2 13 14 2 29 2c10 0 17 6 21 14C54 8 61 2 71 2c15 0 27 11 27 27 0 21-20 39-48 63z"/></symbol>
    <symbol id="s-diamonds" viewBox="0 0 100 100"><path d="M50 2C60 20 74 36 90 50 74 64 60 80 50 98 40 80 26 64 10 50 26 36 40 20 50 2z"/></symbol>
    <symbol id="s-spades" viewBox="0 0 100 100"><path d="M50 2C40 20 4 38 4 62c0 15 11 25 24 25 9 0 16-4 20-10-1 9-5 16-13 21h30c-8-5-12-12-13-21 4 6 11 10 20 10 13 0 24-10 24-25C96 38 60 20 50 2z"/></symbol>
    <symbol id="s-clubs" viewBox="0 0 100 100"><circle cx="50" cy="27" r="21"/><circle cx="25" cy="60" r="21"/><circle cx="75" cy="60" r="21"/><path d="M40 40h20v26H40z"/><path d="M47 58c0 16-5 28-15 40h36c-10-12-15-24-15-40z"/></symbol>
    <pattern id="back-pat" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="14" height="14" fill="#9a2a20"/>
      <path d="M0 7h14M7 0v14" stroke="#b8473a" stroke-width="1.4"/>
      <circle cx="7" cy="7" r="2.2" fill="#f1d38a"/>
    </pattern>
    <radialGradient id="back-glow" cx="50%" cy="50%" r="60%">
      <stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity=".25"/>
    </radialGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fdfaf2"/><stop offset="1" stop-color="#f1e8d4"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f7dc8b"/><stop offset="1" stop-color="#b8862b"/>
    </linearGradient>
  </defs>
</svg>`;

const pip = (suit, x, y, size, flip = false) =>
  `<use href="#s-${suit}" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}"${flip ? ` transform="rotate(180 ${x} ${y})"` : ''}/>`;

// Раскладка значков на числовых картах (x: 62/100/138, y от 52 до 228)
const L = 64, C = 100, R = 136;
const PIPS = {
  '2': [[C, 56], [C, 224]],
  '3': [[C, 56], [C, 140], [C, 224]],
  '4': [[L, 56], [R, 56], [L, 224], [R, 224]],
  '5': [[L, 56], [R, 56], [C, 140], [L, 224], [R, 224]],
  '6': [[L, 56], [R, 56], [L, 140], [R, 140], [L, 224], [R, 224]],
  '7': [[L, 56], [R, 56], [C, 98], [L, 140], [R, 140], [L, 224], [R, 224]],
  '8': [[L, 56], [R, 56], [C, 98], [L, 140], [R, 140], [C, 182], [L, 224], [R, 224]],
  '9': [[L, 56], [R, 56], [L, 112], [R, 112], [C, 140], [L, 168], [R, 168], [L, 224], [R, 224]],
  '10': [[L, 56], [R, 56], [C, 84], [L, 112], [R, 112], [L, 168], [R, 168], [C, 196], [L, 224], [R, 224]],
};

function corner(rank, suit) {
  const label = rankLabel(rank);
  const fs = label.length > 1 ? 26 : 30;
  return `<g>
    <text x="21" y="38" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${fs}" letter-spacing="${label.length > 1 ? -2 : 0}">${label}</text>
    ${pip(suit, 21, 54, 20)}
  </g>`;
}

// Палитры одежды для картинок, как на классических колодах
const ROBES = {
  spades: ['#1f3f8a', '#c8102e'],
  clubs: ['#c8102e', '#1f3f8a'],
  diamonds: ['#1f6d3a', '#c8102e'],
  hearts: ['#c8102e', '#1f3f8a'],
};

function figureHalf(rank, suit) {
  const [main, accent] = ROBES[suit];
  const col = suitColor(suit);
  const skin = '#f3d2ab';
  let hat = '', hair = '', extra = '';
  if (rank === 'K') {
    hat = `<path d="M78 66 L80 44 L90 56 L100 38 L110 56 L120 44 L122 66 Z" fill="url(#gold)" stroke="#7a5a12" stroke-width="1.2"/>
           <circle cx="100" cy="40" r="3" fill="${accent}"/><circle cx="100" cy="60" r="2.6" fill="${main}"/>`;
    hair = `<path d="M84 84 Q86 104 100 108 Q114 104 116 84 Q108 96 100 96 Q92 96 84 84Z" fill="#8a5a2b"/>`;
    extra = `<path d="M140 136 L150 46" stroke="#7a5a12" stroke-width="3"/><circle cx="150" cy="44" r="5" fill="url(#gold)" stroke="#7a5a12"/>`;
  } else if (rank === 'Q') {
    hat = `<path d="M84 64 Q100 50 116 64 L114 56 L108 60 L100 48 L92 60 L86 56 Z" fill="url(#gold)" stroke="#7a5a12" stroke-width="1.2"/><circle cx="100" cy="50" r="2.6" fill="${accent}"/>`;
    hair = `<path d="M82 66 Q78 92 74 112 L86 108 Q84 90 86 72Z M118 66 Q122 92 126 112 L114 108 Q116 90 114 72Z" fill="#d9a441"/>`;
    extra = `<g transform="translate(140 108)"><circle r="7" fill="${accent}"/><circle r="3" fill="#f7dc8b"/><path d="M0 7 L0 30" stroke="#1f6d3a" stroke-width="2"/></g>`;
  } else {
    hat = `<path d="M80 66 Q82 46 104 46 Q124 48 122 64 Z" fill="${accent}" stroke="#222" stroke-width="1"/><path d="M118 52 Q136 36 146 42" stroke="url(#gold)" stroke-width="4" fill="none"/>`;
    hair = `<path d="M82 68 Q80 84 86 92 L88 72Z M118 68 Q120 84 114 92 L112 72Z" fill="#6b3f1d"/>`;
    extra = `<path d="M56 136 L60 92" stroke="#7a5a12" stroke-width="3"/><path d="M60 92 l-6 -10 l12 0z" fill="#b9bec7" stroke="#555"/>`;
  }
  return `<g>
    <path d="M36 140 L36 122 Q52 100 100 102 Q148 100 164 122 L164 140 Z" fill="${main}"/>
    <path d="M36 140 L36 128 Q54 112 76 112 L84 140Z M164 140 L164 128 Q146 112 124 112 L116 140Z" fill="${accent}" opacity=".9"/>
    <path d="M70 140 Q72 118 100 116 Q128 118 130 140" fill="none" stroke="url(#gold)" stroke-width="3"/>
    <path d="M84 104 Q100 120 116 104 L112 98 Q100 108 88 98Z" fill="#fff" stroke="#999" stroke-width=".6"/>
    ${hair}
    <ellipse cx="100" cy="80" rx="15" ry="18" fill="${skin}" stroke="#a37b52" stroke-width=".8"/>
    <circle cx="94" cy="78" r="1.6" fill="#222"/><circle cx="106" cy="78" r="1.6" fill="#222"/>
    <path d="M100 80 L98 88 L101 88" fill="none" stroke="#a37b52" stroke-width=".9"/>
    <path d="M95 92 Q100 95 105 92" fill="none" stroke="#b03a3a" stroke-width="1.2"/>
    ${hat}
    ${extra}
    <g fill="${col}">${pip(suit, 52, 50, 22)}</g>
  </g>`;
}

function faceCard(rank, suit) {
  const half = figureHalf(rank, suit);
  return `
    <rect x="34" y="28" width="132" height="224" rx="5" fill="#fbf4e2" stroke="url(#gold)" stroke-width="2.5"/>
    <g>${half}</g>
    <g transform="rotate(180 100 140)">${half}</g>
    <path d="M36 140 H164" stroke="#7a5a12" stroke-width="1.2"/>
    <rect x="34" y="28" width="132" height="224" rx="5" fill="none" stroke="${suitColor(suit)}" stroke-width="1" opacity=".5"/>`;
}

function aceCard(suit) {
  if (suit === 'spades') {
    return `<circle cx="100" cy="140" r="58" fill="none" stroke="url(#gold)" stroke-width="2"/>
      <circle cx="100" cy="140" r="52" fill="none" stroke="${BLACK}" stroke-width=".8" stroke-dasharray="3 3"/>
      ${pip(suit, 100, 138, 86)}`;
  }
  return pip(suit, 100, 140, 64);
}

/** SVG-разметка лицевой стороны */
export function cardFace(card) {
  const { rank, suit } = card;
  const col = suitColor(suit);
  let body;
  if (rank === 'A') body = aceCard(suit);
  else if (rank === 'J' || rank === 'Q' || rank === 'K') body = faceCard(rank, suit);
  else body = PIPS[rank].map(([x, y]) => pip(suit, x, y, rank === '10' ? 34 : 38, y > 140)).join('');
  return `<svg class="card-svg" viewBox="0 0 200 280" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="198" height="278" rx="14" fill="url(#paper)" stroke="#bfb39a" stroke-width="1.5"/>
    <g fill="${col}">
      ${body}
      ${corner(rank, suit)}
      <g transform="rotate(180 100 140)">${corner(rank, suit)}</g>
    </g>
  </svg>`;
}

/** SVG-разметка рубашки */
export function cardBack() {
  return `<svg class="card-svg" viewBox="0 0 200 280" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="198" height="278" rx="14" fill="#f8f2e4" stroke="#bfb39a" stroke-width="1.5"/>
    <rect x="12" y="12" width="176" height="256" rx="8" fill="url(#back-pat)"/>
    <rect x="12" y="12" width="176" height="256" rx="8" fill="url(#back-glow)"/>
    <rect x="18" y="18" width="164" height="244" rx="6" fill="none" stroke="#f1d38a" stroke-width="2"/>
    <g transform="translate(100 140)">
      <ellipse rx="44" ry="30" fill="#7a1220" stroke="#f1d38a" stroke-width="2.5"/>
      <text y="11" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="32" fill="#f1d38a">108</text>
    </g>
  </svg>`;
}

/** DOM-элемент карты */
export function cardEl(card, { back = false, cls = '' } = {}) {
  const el = document.createElement('div');
  el.className = `card ${cls}`.trim();
  el.innerHTML = back || !card ? cardBack() : cardFace(card);
  if (card && !back) { el.dataset.id = card.id; el.setAttribute('aria-label', `${rankLabel(card.rank)} ${SUIT_SYMBOL[card.suit]}`); }
  return el;
}
