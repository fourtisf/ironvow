// IRONVOW — X profile and header, generated as SVG from a hand-built wordmark.
//
//   node tools/logo/make.mjs        → tools/logo/out/*.svg (X profile, header, lockup)
//   node tools/logo/site.mjs        → apps/web/public/{icon.svg,wordmark.svg,manifest.webmanifest}
//   node tools/logo/render.cjs      → apps/web/public/*.png (needs the Playwright Chromium)
//
//
// The letters are polygons, not a font: a wordmark that depends on Arial Black
// being installed renders differently on every machine that opens the file,
// and an X profile is opened by everyone. Angular joins, cap height 100,
// stroke 24 — the same chunky-outline register as the game's art.

import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const GOLD = '#e8b23c';
export const GOLD_D = '#a8761b';
export const IRON = '#1b2432';
export const IRON_D = '#141c28';
export const PARCH = '#f2e4c4';
export const LINE = '#141c28';

/* --- glyphs: [width, polygons]; a polygon with a `hole` is drawn evenodd --- */
const G = {
  I: [24, [[[0, 0], [24, 0], [24, 100], [0, 100]]]],
  R: [78, [
    [[0, 0], [24, 0], [24, 100], [0, 100]],
    { outer: [[0, 0], [56, 0], [72, 16], [72, 46], [58, 60], [0, 60]],
      hole: [[24, 22], [48, 22], [50, 24], [50, 36], [48, 38], [24, 38]] },
    [[36, 60], [58, 60], [78, 100], [54, 100]],
  ]],
  O: [84, [
    { outer: [[16, 0], [68, 0], [84, 16], [84, 84], [68, 100], [16, 100], [0, 84], [0, 16]],
      hole: [[26, 24], [58, 24], [60, 26], [60, 74], [58, 76], [26, 76], [24, 74], [24, 26]] },
  ]],
  N: [84, [
    [[0, 0], [24, 0], [24, 100], [0, 100]],
    [[60, 0], [84, 0], [84, 100], [60, 100]],
    [[0, 0], [28, 0], [84, 72], [84, 100], [56, 100], [0, 28]],
  ]],
  V: [88, [[[0, 0], [28, 0], [44, 66], [60, 0], [88, 0], [58, 100], [30, 100]]]],
  W: [120, [
    [[0, 0], [24, 0], [46, 100], [22, 100]],
    [[48, 0], [72, 0], [46, 100], [22, 100]],
    [[48, 0], [72, 0], [98, 100], [74, 100]],
    [[96, 0], [120, 0], [98, 100], [74, 100]],
  ]],
};
const TRACK = 14;

const pts = (p) => p.map(([x, y]) => `${x},${y}`).join(' ');

/** The word as SVG at scale `k`, origin top-left. Returns {svg, width}. */
export function wordmark(text, k, fill, stroke = null, sw = 0) {
  let x = 0;
  const parts = [];
  for (const ch of text) {
    const [w, polys] = G[ch];
    for (const poly of polys) {
      const attrs = `fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw / k}" stroke-linejoin="miter"` : ''}`;
      if (Array.isArray(poly)) {
        parts.push(`<polygon points="${pts(poly)}" ${attrs}></polygon>`);
      } else {
        const d = `M ${pts(poly.outer).replace(/ /g, ' L ')} Z M ${pts(poly.hole).replace(/ /g, ' L ')} Z`;
        parts.push(`<path d="${d}" fill-rule="evenodd" ${attrs}></path>`);
      }
    }
    parts[parts.length - 1] = parts[parts.length - 1]; // keep order
    // wrap this glyph's parts in a translate
    const n = polys.length;
    const glyph = parts.splice(parts.length - n, n).join('');
    parts.push(`<g transform="translate(${x} 0)">${glyph}</g>`);
    x += w + TRACK;
  }
  const width = x - TRACK;
  return { svg: `<g transform="scale(${k})">${parts.join('')}</g>`, width: width * k, height: 100 * k };
}

/** A crenellated wall of `merlons` merlons spanning `w` px, at (0,0) top-left of the merlons. */
export function wall(w, merlons, k, withOutline = true) {
  // Merlon = gap = one unit. merlons m, gaps m-1, plus half a gap at each end.
  const unit = w / (2 * merlons);
  const mh = 16 * k, bh = 24 * k, base = 8 * k;
  let d = `M 0 ${mh}`;
  for (let i = 0; i < merlons; i++) {
    const x0 = unit * (0.5 + 2 * i), x1 = x0 + unit;
    d += ` H ${x0} V 0 H ${x1} V ${mh}`;
  }
  d += ` H ${w} V ${mh + bh} H 0 Z`;
  const o = withOutline ? ` stroke="${LINE}" stroke-width="${3 * k}" stroke-linejoin="miter"` : '';
  return `<path d="${d}" fill="${GOLD}"${o}></path>` +
    `<rect x="0" y="${mh + bh}" width="${w}" height="${base}" fill="${GOLD_D}"></rect>`;
}

/* ------------------------------------------------------------- profile --- */
function profile() {
  const S = 400;
  const wl = 236; // wall width
  const k = 2.6;  // wall scale (merlon 16k tall, bar 24k)
  const wallH = (16 + 24 + 8) * k;
  const wx = (S - wl) / 2, wy = (S - wallH) / 2 + 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <radialGradient id="vig" cx="50%" cy="42%" r="70%">
      <stop offset="0" stop-color="${IRON}"></stop>
      <stop offset="1" stop-color="${IRON_D}"></stop>
    </radialGradient>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#vig)"></rect>
  <!-- One fine ring, well inside X's circular crop. -->
  <circle cx="${S / 2}" cy="${S / 2}" r="176" fill="none" stroke="${GOLD}" stroke-width="2.5" opacity="0.9"></circle>
  <circle cx="${S / 2}" cy="${S / 2}" r="168" fill="none" stroke="${GOLD}" stroke-width="1" opacity="0.35"></circle>
  <g transform="translate(${wx} ${wy})">${wall(wl, 3, k)}</g>
</svg>`;
}

/* -------------------------------------------------------------- header --- */
function header() {
  const W = 1500, H = 500;
  const k = 1.2;                       // wordmark scale → cap height 120
  const wm = wordmark('IRONVOW', k, PARCH);
  // Centred a little right of middle: the avatar sits over the bottom-left on
  // desktop and the sides are cropped on phones, so the safe area is the
  // middle 1100 px and the upper two thirds.
  const cx = 800;
  const x0 = cx - wm.width / 2;
  const y0 = 150;
  const wallK = 1.15;
  const wallH = (16 + 24 + 8) * wallK;
  const wy = y0 + wm.height + 22;
  const tagY = wy + wallH + 46;

  // Faint isometric grid — the game's field, at a whisper.
  let grid = '';
  const tw = 64, th = 32;
  for (let i = -12; i < 40; i++) {
    grid += `<line x1="${i * tw}" y1="0" x2="${i * tw + H * 2}" y2="${H}" />`;
    grid += `<line x1="${i * tw}" y1="0" x2="${i * tw - H * 2}" y2="${H}" />`;
  }
  void th;

  const tag = 'FORGE · MUSTER · CONQUER';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="vig" cx="54%" cy="45%" r="75%">
      <stop offset="0" stop-color="${IRON}"></stop>
      <stop offset="1" stop-color="${IRON_D}"></stop>
    </radialGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${PARCH}" stop-opacity="0"></stop>
      <stop offset="0.5" stop-color="${PARCH}" stop-opacity="1"></stop>
      <stop offset="1" stop-color="${PARCH}" stop-opacity="0"></stop>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#vig)"></rect>
  <g stroke="${PARCH}" stroke-width="1" opacity="0.035">${grid}</g>
  <!-- A hairline rule top and bottom, the way a plate is edged. -->
  <rect x="60" y="36" width="${W - 120}" height="1.5" fill="url(#fade)" opacity="0.45"></rect>
  <rect x="60" y="${H - 38}" width="${W - 120}" height="1.5" fill="url(#fade)" opacity="0.45"></rect>
  <g transform="translate(${x0} ${y0})">${wm.svg}</g>
  <g transform="translate(${x0} ${wy})">${wall(wm.width, 6, wallK)}</g>
  <text x="${cx}" y="${tagY}" text-anchor="middle" font-family="Liberation Sans, Arial, Helvetica, sans-serif" font-weight="700" font-size="21" letter-spacing="7" fill="${GOLD}">${tag}</text>
</svg>`;
}

/* ---------------------------------------------- wordmark alone, for reuse --- */
function lockup() {
  const k = 1;
  const wm = wordmark('IRONVOW', k, PARCH);
  const wallK = 0.95;
  const pad = 40;
  const W = wm.width + pad * 2;
  const wallH = (16 + 24 + 8) * wallK;
  const H = pad + wm.height + 18 + wallH + pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${IRON}"></rect>
  <g transform="translate(${pad} ${pad})">${wm.svg}</g>
  <g transform="translate(${pad} ${pad + wm.height + 18})">${wall(wm.width, 6, wallK)}</g>
</svg>`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = new URL('./out/', import.meta.url).pathname;
  mkdirSync(out, { recursive: true });
  writeFileSync(out + 'ironvow-x-profile.svg', profile());
  writeFileSync(out + 'ironvow-x-header.svg', header());
  writeFileSync(out + 'ironvow-wordmark.svg', lockup());
  console.log('wrote ironvow-x-profile.svg, ironvow-x-header.svg, ironvow-wordmark.svg to', out);
}
