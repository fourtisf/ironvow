// The logo as the website wears it: favicon, app icons, the wordmark on the
// first screen, and the card a shared link unfurls into.
import { mkdirSync, writeFileSync } from 'node:fs';
import { GOLD, IRON, IRON_D, PARCH, wall, wordmark } from './make.mjs';

const OUT = new URL('../../apps/web/public', import.meta.url).pathname;
const SRC = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
mkdirSync(SRC, { recursive: true });

/** Square app icon. The mark stays inside the middle 80%, the maskable safe zone. */
function icon(S, rounded) {
  const r = rounded ? S * 0.2 : 0;
  const wl = S * 0.62;
  const k = wl / 92;                 // wall() geometry is 16k + 24k + 8k tall
  const wallH = 48 * k;
  const wx = (S - wl) / 2, wy = (S - wallH) / 2 + S * 0.015;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <radialGradient id="vig" cx="50%" cy="40%" r="72%">
      <stop offset="0" stop-color="${IRON}"></stop>
      <stop offset="1" stop-color="${IRON_D}"></stop>
    </radialGradient>
  </defs>
  <rect width="${S}" height="${S}" rx="${r}" fill="url(#vig)"></rect>
  <rect x="${S * 0.06}" y="${S * 0.06}" width="${S * 0.88}" height="${S * 0.88}" rx="${r * 0.75}" fill="none" stroke="${GOLD}" stroke-width="${S * 0.018}" opacity="0.55"></rect>
  <g transform="translate(${wx} ${wy})">${wall(wl, 3, k)}</g>
</svg>`;
}

/** The wordmark on nothing, for the sign-in card. */
function mark() {
  const wm = wordmark('IRONVOW', 1, PARCH);
  const wallK = 0.95;
  const wallH = 48 * wallK;
  const W = wm.width, H = wm.height + 16 + wallH;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="IRONVOW">
  <g>${wm.svg}</g>
  <g transform="translate(0 ${wm.height + 16})">${wall(W, 6, wallK)}</g>
</svg>`;
}

/** 1200×630, what a shared link shows. */
function og() {
  const W = 1200, H = 630;
  const k = 1.15;
  const wm = wordmark('IRONVOW', k, PARCH);
  const x0 = (W - wm.width) / 2;
  const y0 = 196;
  const wallK = 1.1;
  const wallH = 48 * wallK;
  const wy = y0 + wm.height + 22;
  const tagY = wy + wallH + 52;
  let grid = '';
  for (let i = -12; i < 40; i++) {
    grid += `<line x1="${i * 64}" y1="0" x2="${i * 64 + H * 2}" y2="${H}" />`;
    grid += `<line x1="${i * 64}" y1="0" x2="${i * 64 - H * 2}" y2="${H}" />`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="vig" cx="50%" cy="45%" r="75%">
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
  <rect x="60" y="40" width="${W - 120}" height="1.5" fill="url(#fade)" opacity="0.45"></rect>
  <rect x="60" y="${H - 42}" width="${W - 120}" height="1.5" fill="url(#fade)" opacity="0.45"></rect>
  <g transform="translate(${x0} ${y0})">${wm.svg}</g>
  <g transform="translate(${x0} ${wy})">${wall(wm.width, 6, wallK)}</g>
  <text x="${W / 2}" y="${tagY}" text-anchor="middle" font-family="Liberation Sans, Arial, Helvetica, sans-serif" font-weight="700" font-size="24" letter-spacing="8" fill="${GOLD}">FORGE · MUSTER · CONQUER</text>
</svg>`;
}

writeFileSync(`${OUT}/icon.svg`, icon(512, true));
writeFileSync(`${OUT}/wordmark.svg`, mark());
writeFileSync(SRC + 'site-icon-square.svg', icon(512, false));
writeFileSync(SRC + 'site-icon-rounded.svg', icon(512, true));
writeFileSync(SRC + 'site-og.svg', og());
writeFileSync(`${OUT}/manifest.webmanifest`, JSON.stringify({
  name: 'IRONVOW',
  short_name: 'IRONVOW',
  description: 'Forge. Muster. Conquer. A base builder with async raiding.',
  start_url: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: IRON_D,
  theme_color: IRON,
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2) + '\n');
console.log('wrote icon.svg, wordmark.svg, manifest.webmanifest and the raster sources');
