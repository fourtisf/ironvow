import { TYPES, type BuildingType } from '@ironvow/config';
import { isoX, isoY, w2s, type Camera, type Viewport } from './camera';
import { drawBuildingBody } from './buildings';
import type { Draw } from './primitives';
import { hasCanopy, paintDecoBase, paintDecoCanopy, type Deco } from './deco';

/**
 * Sprite cache for the static art: buildings and the treeline.
 *
 * A structure's static art is a pure function of type, level, livery and zoom,
 * yet a base of two hundred of them was re-issuing every path every frame:
 * ~4,700 canvas path operations per frame, which measured at 10fps against a
 * 4x-throttled CPU standing in for a mid-range Android. So each distinct
 * (type, level, enemy, zoom) is rasterised once into its own canvas and blitted
 * from then on.
 *
 * Two details keep it honest:
 *
 *  - Zoom is bucketed, but the blit is scaled to the *exact* zoom. Bucketing
 *    the drawn size instead would let a rampart drift up to a bucket-width away
 *    from its own footprint, and a row of them would visibly fail to line up.
 *  - Bounds are measured from the art rather than hard-coded, by rendering once
 *    oversized and scanning for the alpha extent. A hand-written table would be
 *    wrong the first time anyone changed a roof height, and the failure mode is
 *    a silently clipped building.
 */


/** Half-size of the measuring canvas, in px at zoom 1. */
const MEASURE_R = 256;
/**
 * Slack around the measured box, in device-independent px.
 *
 * Stroke widths are clamped to a minimum, so at low zoom an outline is
 * proportionally fatter than it was when measured at zoom 1.
 */
const SLACK = 4;
/** Eviction budget. Roughly 24 MB of backing store at 4 bytes a pixel. */
const MAX_PIXELS = 6_000_000;

interface Bounds {
  /** Offsets from the sprite's anchor point, in px at scale 1. */
  l: number;
  t: number;
  r: number;
  b: number;
}

interface Sprite {
  canvas: HTMLCanvasElement;
  /** Scale this was rasterised at. */
  k: number;
  /** Offset from the anchor to the sprite's top-left, in px at `k`. */
  dx: number;
  dy: number;
  /** CSS px. */
  w: number;
  h: number;
  px: number;
}

/** Draws the shape at the origin, at the given scale. */
type Painter = (ctx: CanvasRenderingContext2D, scale: number) => void;

const bounds = new Map<string, Bounds>();
const cache = new Map<string, Sprite>();
let cachePixels = 0;

/** Only for the tests: drop everything and start over. */
export function clearSpriteCache(): void {
  cache.clear();
  cachePixels = 0;
}

export function spriteCacheSize(): number {
  return cache.size;
}

function measure(shape: string, paint: Painter): Bounds {
  const hit = bounds.get(shape);
  if (hit) return hit;

  const R = MEASURE_R;
  const c = document.createElement('canvas');
  c.width = R * 2;
  c.height = R * 2;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(1, 0, 0, 1, R, R);
  paint(ctx, 1);

  const data = ctx.getImageData(0, 0, R * 2, R * 2).data;
  let minX = R * 2, minY = R * 2, maxX = -1, maxY = -1;
  for (let y = 0; y < R * 2; y++) {
    const row = y * R * 2 * 4;
    for (let x = 0; x < R * 2; x++) {
      if (data[row + x * 4 + 3]! === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  // A shape that drew nothing would otherwise produce an inverted box and a
  // zero-sized canvas, which throws on drawImage.
  const box: Bounds = maxX < 0
    ? { l: -1, t: -1, r: 1, b: 1 }
    : { l: minX - R, t: minY - R, r: maxX + 1 - R, b: maxY + 1 - R };
  bounds.set(shape, box);
  return box;
}

function rasterise(shape: string, paint: Painter, box: Bounds, k: number, dpr: number): Sprite {
  const dx = box.l * k - SLACK;
  const dy = box.t * k - SLACK;
  const wDev = Math.max(1, Math.round(((box.r - box.l) * k + SLACK * 2) * dpr));
  const hDev = Math.max(1, Math.round(((box.b - box.t) * k + SLACK * 2) * dpr));

  const c = document.createElement('canvas');
  c.width = wDev;
  c.height = hDev;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, -dx * dpr, -dy * dpr);
  paint(ctx, k);

  return { canvas: c, k, dx, dy, w: wDev / dpr, h: hDev / dpr, px: wDev * hDev };
}

function evictTo(budget: number): void {
  // Map iterates in insertion order and every hit is re-inserted, so the front
  // of the map is the least recently used.
  for (const [key, sprite] of cache) {
    if (cachePixels <= budget) return;
    cache.delete(key);
    cachePixels -= sprite.px;
  }
}

/**
 * Rasterise once per (shape, scale bucket, pixel ratio), then reuse.
 *
 * `shape` must capture everything the painter varies on except the scale, or
 * two different structures will share one bitmap.
 */
function spriteFor(shape: string, paint: Painter, scale: number, dpr: number): Sprite {
  const box = measure(shape, paint);
  const span = Math.max(0.001, box.r - box.l);
  // The scale is derived from a whole number of device pixels rather than taken
  // as given. That makes the bitmap exactly as wide as the space it is blitted
  // into, so the draw is a straight copy: no resampling, and outlines stay as
  // crisp as they were when they went straight to the frame. It also quantises
  // the cache key for free — finer where a pixel matters and coarser where it
  // does not — so a settled camera reuses one entry per structure.
  const wDev = Math.max(1, Math.round((span * scale + SLACK * 2) * dpr));
  const key = `${shape}|${wDev}|${dpr}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const k = (wDev / dpr - SLACK * 2) / span;
  const sprite = rasterise(shape, paint, box, k, dpr);
  cache.set(key, sprite);
  cachePixels += sprite.px;
  if (cachePixels > MAX_PIXELS) evictTo(MAX_PIXELS);
  return sprite;
}

function blit(
  ctx: CanvasRenderingContext2D, sprite: Sprite, dpr: number, ax: number, ay: number,
): void {
  // Drawn at its natural size and landed on whole device pixels, which together
  // make this a one-to-one copy. The cost is up to half a device pixel of
  // placement error, less than the thinnest line in the art and identical every
  // frame, so nothing shimmers.
  const snap = (v: number): number => Math.round(v * dpr) / dpr;
  ctx.drawImage(sprite.canvas, snap(ax + sprite.dx), snap(ay + sprite.dy), sprite.w, sprite.h);
}

/**
 * Blit a building's static art at its true position and scale.
 *
 * `ax`, `ay` are the screen coordinates of the building's anchor — grid
 * (gx, gy) — which the caller already has from the depth sort.
 */
export function blitBuilding(
  d: Draw, type: BuildingType, level: number, enemy: boolean, ax: number, ay: number,
  link = 0,
): void {
  const { ctx, cam, vp } = d;
  const z = cam.z;
  // `link` only varies for Ramparts, and only over sixteen values, so it costs
  // nothing on every other type and at most sixteen sprites on that one.
  const shape = `b|${type}|${level}|${enemy ? 1 : 0}|${link}`;
  const paint: Painter = (c, k) => {
    // The art is translation-invariant, so a camera at the origin puts grid
    // (0,0) at the canvas origin, where the transform has already been aimed.
    const cam0: Camera = { x: 0, y: 0, z: k, tz: k };
    const vp0: Viewport = { w: 0, h: 0, dpr: vp.dpr };
    drawBuildingBody({ ctx: c, cam: cam0, vp: vp0, t: 0 }, { type, gx: 0, gy: 0, level, link }, enemy);
  };
  blit(ctx, spriteFor(shape, paint, z, vp.dpr), vp.dpr, ax, ay);
}

/**
 * Blit one cached piece of a unit at its anchor.
 *
 * Troops move, so most of a unit has to be drawn live — but only the parts
 * that actually move do. The kit a troop wears does not change between frames,
 * and since the War Lab tiers it is by far the most expensive half to draw, so
 * it is rasterised once per (shape, scale, pixel ratio) like a building and
 * blitted under the legs and the weapon.
 *
 * `shape` must name everything the painter varies on except the scale.
 */
export function blitUnitPart(
  d: Draw, shape: string, scale: number, ax: number, ay: number, paint: Painter,
): void {
  blit(d.ctx, spriteFor(shape, paint, scale, d.vp.dpr), d.vp.dpr, ax, ay);
}

/**
 * One piece of scenery.
 *
 * A tree is two blits rather than one so its canopy can still sway; the sway is
 * a few pixels of horizontal offset, which is exactly what a separate sprite
 * costs nothing to express. Everything else is a single blit.
 *
 * The whole shape scales with `deco.s * cam.z`, so that product is the only
 * cache dimension: two trees of different sizes at the same zoom share nothing,
 * but the same tree across a pan shares everything.
 */
export function blitDeco(d: Draw, deco: Deco): void {
  const { ctx, cam, vp, t } = d;
  const [sx, sy] = w2s(cam, vp, isoX(deco.gx, deco.gy), isoY(deco.gx, deco.gy));
  if (sx < -60 || sx > vp.w + 60 || sy < -60 || sy > vp.h + 80) return;
  const s = deco.s * cam.z;

  const kind = deco.k;
  const v = deco.v;
  const base = spriteFor(`d|${kind}|${v}`, (c, k) => paintDecoBase(c, kind, k, v), s, vp.dpr);
  blit(ctx, base, vp.dpr, sx, sy);
  if (!hasCanopy(kind)) return;

  const sway = Math.sin(t * 1.1 + deco.p) * 1.8 * s;
  blit(ctx, spriteFor(`d|canopy|${kind}`, (c, k) => paintDecoCanopy(c, kind, k), s, vp.dpr), vp.dpr, sx + sway, sy);
}
