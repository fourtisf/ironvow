import { N, TH, TW } from '@ironvow/config';
import { w2s } from './camera';
import { C } from './palette';
import type { Draw } from './primitives';

/**
 * What moves over the hold that is not part of it: cloud shadows crossing the
 * field, and now and then a flight of birds. Neither has any effect on the
 * game; both are what makes a still scene look alive rather than paused.
 * High quality only.
 */

/* ------------------------------------------------------------- clouds --- */

interface Cloud {
  /** Base size, CSS px at zoom 1. */
  w: number;
  /** Where it was at t = 0, world px. */
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  /** Which lobes it is made of. */
  v: number;
}

// The field is about 3,600 world px across; a cloud crosses it in a couple of
// minutes and wraps round. Speeds differ so they never line up.
const CLOUDS: readonly Cloud[] = [
  { w: 640, x0: -900, y0: 300, vx: 15, vy: 6, v: 0 },
  { w: 460, x0: 600, y0: 1100, vx: 11, vy: 4.5, v: 1 },
  { w: 820, x0: 1800, y0: -100, vx: 18, vy: 7.5, v: 2 },
];
const WRAP_X0 = -(N * TW) / 2 - 900, WRAP_X1 = (N * TW) / 2 + 900;
const WRAP_Y0 = -600, WRAP_Y1 = N * TH + 600;

const LOBES: readonly (readonly [number, number, number, number][])[] = [
  [[0, 0, .34, .2], [-.28, .04, .22, .13], [.24, -.03, .26, .15], [.05, .12, .3, .12], [-.1, -.1, .2, .1]],
  [[0, 0, .3, .18], [-.3, .05, .2, .12], [.27, .02, .2, .11], [-.02, .13, .26, .1]],
  [[0, 0, .3, .17], [-.32, -.02, .24, .13], [.3, .04, .24, .14], [.08, -.12, .22, .11], [-.08, .14, .32, .12], [.34, -.08, .16, .09]],
];

const cloudSprites = new Map<string, HTMLCanvasElement>();

/**
 * A cloud's shadow, rasterised once per (variant, size). Softness comes from
 * laying the same lobes down several times at slightly growing scale and low
 * alpha — no filter, which Safari's canvas does not have.
 */
function cloudSprite(v: number, wDev: number): HTMLCanvasElement {
  const key = `${v}|${wDev}`;
  const hit = cloudSprites.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  const hDev = Math.round(wDev * 0.56);
  c.width = wDev;
  c.height = hDev;
  const ctx = c.getContext('2d')!;
  ctx.translate(wDev / 2, hDev / 2);
  // Eight layers from 70% to 105% of the lobes' size, each barely there: the
  // middle adds up to a shade a cloud would throw, and the edge fades over a
  // third of the width instead of stopping.
  ctx.fillStyle = 'rgba(8,24,14,0.021)';
  for (let layer = 0; layer < 8; layer++) {
    const grow = 0.7 + layer * 0.05;
    ctx.beginPath();
    for (const [x, y, rx, ry] of LOBES[v]!) {
      ctx.moveTo((x + rx * grow) * wDev, y * wDev);
      ctx.ellipse(x * wDev, y * wDev, rx * grow * wDev, ry * grow * wDev, 0, 0, 6.29);
    }
    ctx.fill();
  }
  if (cloudSprites.size > 18) cloudSprites.delete(cloudSprites.keys().next().value!);
  cloudSprites.set(key, c);
  return c;
}

const wrap = (v: number, lo: number, hi: number): number => lo + ((((v - lo) % (hi - lo)) + (hi - lo)) % (hi - lo));

export function drawCloudShadows(d: Draw): void {
  const { ctx, cam, vp, t } = d;
  for (const c of CLOUDS) {
    const wx = wrap(c.x0 + c.vx * t, WRAP_X0, WRAP_X1);
    const wy = wrap(c.y0 + c.vy * t, WRAP_Y0, WRAP_Y1);
    const [sx, sy] = w2s(cam, vp, wx, wy);
    const w = c.w * cam.z;
    const h = w * 0.56;
    if (sx + w / 2 < 0 || sx - w / 2 > vp.w || sy + h / 2 < 0 || sy - h / 2 > vp.h) continue;
    const wDev = Math.max(2, Math.round(w * vp.dpr));
    const sprite = cloudSprite(c.v, wDev);
    // One to one: the sprite is exactly as many device pixels as it covers.
    const cw = sprite.width / vp.dpr;
    const ch = sprite.height / vp.dpr;
    const snap = (v: number): number => Math.round(v * vp.dpr) / vp.dpr;
    ctx.drawImage(sprite, snap(sx - cw / 2), snap(sy - ch / 2), cw, ch);
  }
}

/* -------------------------------------------------------------- birds --- */

const FLOCK = 5;
const FLIGHT = 75;      // seconds for one crossing
const FLIGHT_GAP = 40;  // seconds of empty sky between crossings

/** A flight of birds, high over the hold, every couple of minutes. */
export function drawBirds(d: Draw): void {
  const { ctx, cam, vp, t } = d;
  const period = FLIGHT + FLIGHT_GAP;
  const phase = t % period;
  if (phase > FLIGHT) return;
  const f = phase / FLIGHT;
  // Diagonally across the world, a little above the field's centre line.
  const x = -2600 + f * 5200;
  const y = 200 + f * 1300;
  const z = cam.z;
  ctx.strokeStyle = C.line;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.2, 1.9 * z);
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < FLOCK; i++) {
    // A loose V behind the leader.
    const side = i % 2 === 0 ? 1 : -1;
    const rank = Math.ceil(i / 2);
    const [sx, sy] = w2s(cam, vp, x - rank * 34 + Math.sin(t * 0.7 + i) * 6, y + side * rank * 22);
    if (sx < -30 || sx > vp.w + 30 || sy < -30 || sy > vp.h + 30) continue;
    const flap = Math.sin(t * 9 + i * 1.1);
    const s = 7 * z;
    const lift = flap * 3.2 * z;
    ctx.beginPath();
    ctx.moveTo(sx - s, sy - lift);
    ctx.quadraticCurveTo(sx - s * 0.4, sy + lift * 0.2, sx, sy);
    ctx.quadraticCurveTo(sx + s * 0.4, sy + lift * 0.2, sx + s, sy - lift);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function drawAtmosphere(d: Draw): void {
  drawCloudShadows(d);
  drawBirds(d);
}
