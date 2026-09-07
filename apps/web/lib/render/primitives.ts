import { TH, TW } from '@ironvow/config';
import { type Camera, type Viewport, isoX, isoY, w2s } from './camera';
import { C } from './palette';

/**
 * Isometric drawing primitives, ported from the prototype.
 *
 * Everything is a plain function taking a context. There are no classes and no
 * React components down here: the art is procedural, which is why the whole
 * game is 96 KB with no asset pipeline, and that is worth keeping.
 */

export interface Draw {
  ctx: CanvasRenderingContext2D;
  cam: Camera;
  vp: Viewport;
  /** Animation clock in seconds, for sway, smoke and banners. */
  t: number;
}

export type Corner = [number, number];

export interface BoxResult {
  A: Corner;
  B: Corner;
  C: Corner;
  D: Corner;
  cx: number;
  cy: number;
}

/*
 * Light, materials, and why a flat fill is not enough.
 *
 * Every surface in this game used to be one solid colour with a black line
 * round it. That reads as a diagram, not as a building: real light falls off
 * down a wall, catches the top edge, and shows the courses of whatever the
 * wall is made of. None of that needs an asset pipeline — it needs a gradient
 * per face, a rim on the lit edges, and a few lines clipped to the surface.
 *
 * It is affordable because building bodies are rasterised once into a sprite
 * and reused every frame; only the per-frame effects pass pays per frame, and
 * it does not use these.
 */

/** The sun's colour, blended into a surface to light it. */
const SUN = [255, 244, 214] as const;
/** The shadow's colour, blended into a surface to darken it. */
const SHADE = [26, 34, 52] as const;

/** `#rrggbb` to channels. Anything else — `rgba(…)`, a named colour — is null. */
function rgbOf(col: string): [number, number, number] | null {
  if (col.length !== 7 || col[0] !== '#') return null;
  const n = Number.parseInt(col.slice(1), 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Move a colour toward the sun (`amount > 0`) or into shadow (`amount < 0`).
 *
 * Deliberately not a multiply. Multiplying slides a colour toward black, which
 * turns every shadow the same muddy grey and loses the material; blending
 * toward a warm light and a cool shadow keeps stone reading as stone at both
 * ends. Colours this cannot parse are returned untouched, so a caller passing
 * `rgba(…)` still gets a flat fill rather than an exception.
 */
/**
 * Memo, because the units call this every frame.
 *
 * Building bodies are rasterised once, so parsing a hex there costs nothing.
 * Troops are not cached — they walk and swing — and forty of them asking for
 * six shaded colours apiece is a few hundred string parses a frame for a
 * result that never changes. Bounded so a livery experiment cannot grow it
 * without limit.
 */
const shadeCache = new Map<string, string>();

export function shade(col: string, amount: number): string {
  const key = `${col}|${amount}`;
  const hit = shadeCache.get(key);
  if (hit !== undefined) return hit;
  const out = mixToward(col, amount);
  if (shadeCache.size < 4096) shadeCache.set(key, out);
  return out;
}

function mixToward(col: string, amount: number): string {
  const rgb = rgbOf(col);
  if (!rgb) return col;
  const [r, g, b] = rgb;
  const [tr, tg, tb] = amount >= 0 ? SUN : SHADE;
  const k = Math.min(1, Math.abs(amount));
  return `rgb(${Math.round(r + (tr - r) * k)},${Math.round(g + (tg - g) * k)},${Math.round(b + (tb - b) * k)})`;
}

/**
 * What a colour is made of.
 *
 * The palette is the material vocabulary: every stone surface in the game is
 * one of a handful of greys and every timber one of a handful of browns, so
 * the fill colour already says what the courses on that face should look
 * like. Inferring it here is what lets one change put block courses on every
 * wall and plank lines on every hut without touching forty call sites — and a
 * colour that is not listed simply gets no texture, which is the old look.
 */
const MATERIAL: Record<string, 'stone' | 'wood'> = {
  '#b6c2cd': 'stone', '#8d9aa8': 'stone', '#5f6d7d': 'stone', '#9aa7b4': 'stone',
  '#96a3b0': 'stone', '#a9b6c2': 'stone', '#74828e': 'stone', '#54626e': 'stone',
  '#78858f': 'stone', '#77848f': 'stone', '#3f4a56': 'stone', '#454e58': 'stone',
  '#7d8994': 'stone', '#59626d': 'stone', '#8e9aa6': 'stone', '#b9c3cd': 'stone',
  '#6e7a86': 'stone', '#cfd8e2': 'stone', '#7e8a97': 'stone', '#9fabb8': 'stone',
  '#5c6672': 'stone', '#76818d': 'stone', '#616c79': 'stone', '#7d8894': 'stone',
  '#9d94b8': 'stone', '#8d84a8': 'stone', '#6d6584': 'stone', '#4c4560': 'stone',
  '#8a5a30': 'wood', '#5d3b1e': 'wood', '#734829': 'wood', '#a8926f': 'wood',
  '#8c5f39': 'wood', '#5a3a21': 'wood', '#6b5340': 'wood', '#4a382b': 'wood',
  '#5a4636': 'wood', '#a06f3d': 'wood', '#6b4526': 'wood',
};
// C.dirt and C.dirt2 are deliberately absent: they are ground, and planking
// the apron under a Barracks makes it look like a stage.

function lerp(p: Corner, q: Corner, f: number): Corner {
  return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
}

/**
 * Courses on a wall face, clipped to it.
 *
 * `lo0`/`lo1` are the face's bottom edge, `hi0`/`hi1` the top. Stone gets
 * horizontal courses with staggered joints; timber gets vertical planks. Both
 * are drawn in the face's own colour lightened and darkened rather than in
 * black, so at a distance they read as surface and not as a grid.
 */
function courses(
  ctx: CanvasRenderingContext2D, mat: 'stone' | 'wood', col: string,
  lo0: Corner, lo1: Corner, hi0: Corner, hi1: Corner, z: number,
): void {
  const rise = Math.hypot(hi0[0] - lo0[0], hi0[1] - lo0[1]);
  const run = Math.hypot(lo1[0] - lo0[0], lo1[1] - lo0[1]);
  if (rise < 14 || run < 12) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(lo0[0], lo0[1]); ctx.lineTo(lo1[0], lo1[1]);
  ctx.lineTo(hi1[0], hi1[1]); ctx.lineTo(hi0[0], hi0[1]);
  ctx.closePath();
  ctx.clip();
  ctx.lineWidth = Math.max(0.7, 1.1 * z);

  /*
   * Batched by colour, not by course.
   *
   * A wall of nine courses drawn line by line is four `stroke()` calls a
   * course; a Keep has eight blocks and sixteen faces, which was six hundred
   * strokes for one sprite and showed up as a stall the first time a base was
   * rasterised. Every line of the same colour goes into one path instead, so
   * the whole face costs three strokes whatever its height.
   */
  const line = (a: Corner, b: Corner, dx = 0, dy = 0): void => {
    ctx.moveTo(a[0] + dx, a[1] + dy); ctx.lineTo(b[0] + dx, b[1] + dy);
  };

  if (mat === 'stone') {
    const rows = Math.min(7, Math.max(2, Math.round(rise / (13 * z))));
    ctx.strokeStyle = shade(col, -0.2);
    ctx.beginPath();
    for (let i = 1; i < rows; i++) {
      const f = i / rows;
      line(lerp(lo0, hi0, f), lerp(lo1, hi1, f));
    }
    ctx.stroke();

    ctx.strokeStyle = shade(col, 0.16);
    ctx.beginPath();
    for (let i = 1; i < rows; i++) {
      const f = i / rows;
      line(lerp(lo0, hi0, f), lerp(lo1, hi1, f), 0, 1.1 * z);
    }
    ctx.stroke();

    // Two joints per course, offset on alternate rows: the stagger is what
    // stops a run of parallel lines reading as corrugation.
    ctx.strokeStyle = shade(col, -0.16);
    ctx.beginPath();
    for (let i = 1; i <= rows; i++) {
      const f = i / rows;
      for (let j = 0; j < 2; j++) {
        const u = (j + (i % 2 === 0 ? 0.28 : 0.72)) / 2;
        const bot = lerp(lo0, lo1, u);
        const top = lerp(hi0, hi1, u);
        line(lerp(bot, top, f), lerp(bot, top, f - 1 / rows));
      }
    }
    ctx.stroke();
  } else {
    const planks = Math.min(7, Math.max(2, Math.round(run / (11 * z))));
    ctx.strokeStyle = shade(col, -0.22);
    ctx.beginPath();
    for (let i = 1; i < planks; i++) {
      const u = i / planks;
      line(lerp(lo0, lo1, u), lerp(hi0, hi1, u));
    }
    ctx.stroke();

    ctx.strokeStyle = shade(col, 0.14);
    ctx.beginPath();
    for (let i = 1; i < planks; i++) {
      const u = i / planks;
      line(lerp(lo0, lo1, u), lerp(hi0, hi1, u), 1.1 * z, 0);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** A face lit from above: caught at the top, falling into shadow at the foot. */
function wallFill(
  ctx: CanvasRenderingContext2D, col: string, hi: Corner, lo: Corner,
): CanvasGradient | string {
  if (!rgbOf(col)) return col;
  const grd = ctx.createLinearGradient(hi[0], hi[1], lo[0], lo[1]);
  grd.addColorStop(0, shade(col, 0.17));
  grd.addColorStop(0.45, col);
  grd.addColorStop(1, shade(col, -0.26));
  return grd;
}

/**
 * A chunky outlined isometric cuboid. `hgt` is screen pixels before zoom.
 *
 * `base` lifts the whole box off the ground, which is how a storey is stacked
 * on a roof: without it every block has to start at the plinth, and a Keep
 * with a lantern above its hall could only be drawn as a spire growing out of
 * the earth through the middle of the building.
 */
export function isoBox(
  d: Draw, gx: number, gy: number, w: number, h: number, hgt: number,
  top: string, left: string, right: string, outline?: string, base = 0,
): BoxResult {
  const { ctx, cam, vp } = d;
  const z = cam.z;
  const o = outline ?? C.line;
  const P = (ax: number, ay: number, dz: number): Corner => {
    const [sx, sy] = w2s(cam, vp, isoX(ax, ay), isoY(ax, ay));
    return [sx, sy - dz * z];
  };
  const a = P(gx, gy, base);
  const b = P(gx + w, gy, base);
  const c = P(gx + w, gy + h, base);
  const dd = P(gx, gy + h, base);
  const A = P(gx, gy, base + hgt);
  const B = P(gx + w, gy, base + hgt);
  const Cc = P(gx + w, gy + h, base + hgt);
  const D = P(gx, gy + h, base + hgt);

  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.5, 2.4 * z);
  ctx.strokeStyle = o;

  /*
   * The two faces a box actually shows, and this is the one that was wrong.
   *
   * ALFA: "bangunanya masih patah2 itu perbaiki".
   *
   * With `isoX = (gx - gy)·TW/2` and `isoY = (gx + gy)·TH/2`, the corner at
   * `(gx, gy)` is the *north* point of the diamond, `(gx, gy + h)` the west,
   * `(gx + w, gy + h)` the south and `(gx + w, gy)` the east. So the two faces
   * turned toward the camera are the south-west run, west→south, and the
   * south-east run, east→south.
   *
   * This drew west→south and *north→west* — one face you can see and one you
   * never can. The whole east half of every box in the game had no wall on it:
   * the top face floated over open ground, and you could see the terrain, or
   * whatever stood behind, straight through the right-hand side of a Keep, a
   * Vault or a Barracks. Nothing about the code looked wrong, because the
   * hidden face was drawn first and the top covered most of the evidence.
   *
   * Painter's order is either visible face and then the top: they meet along
   * the south corner and never overlap. The `left` colour keeps the face it
   * was always meant for; `right` keeps the one it was already drawing.
   */
  ctx.fillStyle = wallFill(ctx, left, B, b);
  ctx.beginPath();
  ctx.moveTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(Cc[0], Cc[1]); ctx.lineTo(B[0], B[1]);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  const leftMat = MATERIAL[left];
  if (leftMat) courses(ctx, leftMat, left, b, c, B, Cc, z);

  ctx.fillStyle = wallFill(ctx, right, D, dd);
  ctx.beginPath();
  ctx.moveTo(dd[0], dd[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(Cc[0], Cc[1]); ctx.lineTo(D[0], D[1]);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  const rightMat = MATERIAL[right];
  if (rightMat) courses(ctx, rightMat, right, dd, c, D, Cc, z);

  ctx.fillStyle = wallFill(ctx, top, A, Cc);
  ctx.beginPath();
  ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(Cc[0], Cc[1]); ctx.lineTo(D[0], D[1]);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  /*
   * The rim.
   *
   * A thin warm line inside the two edges the sun reaches — the back-left and
   * back-right of the cap. It costs one stroke and it is most of the
   * difference between a solid drawn on a screen and a thing standing in a
   * light: the eye reads a lit edge as a physical corner.
   */
  if (hgt * z > 8) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = shade(top, 0.5);
    ctx.lineWidth = Math.max(1, 1.5 * z);
    ctx.beginPath();
    ctx.moveTo(D[0], D[1] + 1.2 * z);
    ctx.lineTo(A[0], A[1] + 1.2 * z);
    ctx.lineTo(B[0], B[1] + 1.2 * z);
    ctx.stroke();
    ctx.restore();
  }

  return { A, B, C: Cc, D, cx: (A[0] + Cc[0]) / 2, cy: (A[1] + Cc[1]) / 2 };
}

export function isoDiamond(
  d: Draw, gx: number, gy: number, w: number, h: number,
  fill: string, dz = 0, stroke?: string,
): void {
  const { ctx, cam, vp } = d;
  const P = (ax: number, ay: number): Corner => {
    const [sx, sy] = w2s(cam, vp, isoX(ax, ay), isoY(ax, ay));
    return [sx, sy - dz * cam.z];
  };
  const a = P(gx, gy);
  const b = P(gx + w, gy);
  const c = P(gx + w, gy + h);
  const dd = P(gx, gy + h);
  // Lit from the back corner, so a flat slab still has a direction to it.
  const grd = ctx.createLinearGradient(a[0], a[1], c[0], c[1]);
  if (rgbOf(fill)) {
    grd.addColorStop(0, shade(fill, 0.18));
    grd.addColorStop(0.6, fill);
    grd.addColorStop(1, shade(fill, -0.12));
    ctx.fillStyle = grd;
  } else {
    ctx.fillStyle = fill;
  }
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(dd[0], dd[1]);
  ctx.closePath(); ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1.4, 2.2 * cam.z);
    ctx.stroke();
  }
}

/** A hip roof: four slopes meeting at a ridge point above the centre. */
export function isoRoof(
  d: Draw, gx: number, gy: number, w: number, h: number,
  baseH: number, peakH: number, light: string, dark: string,
): Corner {
  const { ctx, cam, vp } = d;
  const z = cam.z;
  const P = (ax: number, ay: number, dz: number): Corner => {
    const [sx, sy] = w2s(cam, vp, isoX(ax, ay), isoY(ax, ay));
    return [sx, sy - dz * z];
  };
  const A = P(gx, gy, baseH);
  const B = P(gx + w, gy, baseH);
  const Cc = P(gx + w, gy + h, baseH);
  const D = P(gx, gy + h, baseH);
  const K = P(gx + w / 2, gy + h / 2, peakH);

  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.5, 2.5 * z);
  ctx.strokeStyle = C.line;

  /*
   * A roof, not a coloured triangle.
   *
   * Three things do the work: a gradient running up to the ridge, courses of
   * tiles clipped to the slope and following the eave, and a heavier board
   * along the eave itself. A tiled roof is the single most legible surface on
   * a building of this size — it is what the eye uses to judge scale — so it
   * is worth more detail than the walls under it.
   */
  const face = (p: Corner, q: Corner, col: string): void => {
    const eave: Corner = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (rgbOf(col)) {
      const grd = ctx.createLinearGradient(K[0], K[1], eave[0], eave[1]);
      grd.addColorStop(0, shade(col, 0.2));
      grd.addColorStop(0.5, col);
      grd.addColorStop(1, shade(col, -0.2));
      ctx.fillStyle = grd;
    } else {
      ctx.fillStyle = col;
    }
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(K[0], K[1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const slope = Math.hypot(K[0] - eave[0], K[1] - eave[1]);
    const span = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (slope < 16 || span < 14 || !rgbOf(col)) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(K[0], K[1]);
    ctx.closePath();
    ctx.clip();

    // Batched by colour, as on the walls: three strokes a slope, not three a
    // course.
    const rows = Math.min(6, Math.max(2, Math.round(slope / (12 * z))));
    ctx.lineWidth = Math.max(0.7, 1.1 * z);
    ctx.strokeStyle = shade(col, -0.24);
    ctx.beginPath();
    for (let i = 1; i < rows; i++) {
      const f = i / rows;
      const l = lerp(p, K, f); const r = lerp(q, K, f);
      ctx.moveTo(l[0], l[1]); ctx.lineTo(r[0], r[1]);
    }
    ctx.stroke();

    ctx.strokeStyle = shade(col, 0.2);
    ctx.beginPath();
    for (let i = 1; i < rows; i++) {
      const f = i / rows;
      const l = lerp(p, K, f); const r = lerp(q, K, f);
      ctx.moveTo(l[0], l[1] + 1.2 * z); ctx.lineTo(r[0], r[1] + 1.2 * z);
    }
    ctx.stroke();

    // The joints between tiles, staggered against the course below so the
    // slope does not read as a set of stripes.
    ctx.strokeStyle = shade(col, -0.18);
    ctx.beginPath();
    for (let i = 1; i <= rows; i++) {
      const f = i / rows;
      const l = lerp(p, K, f); const r = lerp(q, K, f);
      const l0 = lerp(p, K, f - 1 / rows); const r0 = lerp(q, K, f - 1 / rows);
      const tiles = Math.min(8, Math.max(2, Math.round((span * (1 - f)) / (11 * z))));
      for (let j = 1; j < tiles; j++) {
        const u = (j + (i % 2 === 0 ? 0 : 0.5)) / tiles;
        if (u >= 1) continue;
        const s0 = lerp(l, r, u);
        const s1 = lerp(l0, r0, u);
        ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]);
      }
    }
    ctx.stroke();

    // The eave board, and the ridge catching the light above it.
    ctx.strokeStyle = shade(col, -0.34);
    ctx.lineWidth = Math.max(1.6, 3.2 * z);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = shade(col, 0.55);
    ctx.lineWidth = Math.max(1, 1.6 * z);
    const l1 = lerp(p, K, 0.9);
    const r1 = lerp(q, K, 0.9);
    ctx.beginPath(); ctx.moveTo(l1[0], l1[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke();
    ctx.restore();
    ctx.lineWidth = Math.max(1.5, 2.5 * z);
    ctx.strokeStyle = C.line;
  };
  face(A, B, dark);
  face(A, D, dark);
  face(D, Cc, light);
  face(B, Cc, dark);
  return K;
}

export function shadowAt(d: Draw, gx: number, gy: number, w: number, h: number): void {
  const { ctx, cam, vp } = d;
  const z = cam.z;
  const [sx, sy] = w2s(cam, vp, isoX(gx + w / 2, gy + h / 2), isoY(gx + w / 2, gy + h / 2));
  /*
   * A soft shadow with a dark core.
   *
   * A flat ellipse at one alpha is the tell of a sprite pasted onto grass: a
   * real contact shadow is dense where the building meets the ground and
   * dissolves at its edge. A radial gradient costs one extra object and puts
   * the building on the field rather than above it.
   */
  const rx = ((w * TW) / 2) * 0.72 * z;
  const ry = ((h * TH) / 2) * 0.82 * z;
  const grd = ctx.createRadialGradient(sx, sy + 3 * z, 0, sx, sy + 3 * z, Math.max(rx, ry));
  grd.addColorStop(0, 'rgba(18,38,16,.34)');
  grd.addColorStop(0.62, 'rgba(20,40,18,.2)');
  grd.addColorStop(1, 'rgba(20,40,18,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.ellipse(sx, sy + 3 * z, rx, ry, 0, 0, 6.29);
  ctx.fill();
}

export function roundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawLevelPip(d: Draw, x: number, y: number, lv: number): void {
  const { ctx, cam } = d;
  const z = cam.z;
  if (z < 0.62) return;
  ctx.fillStyle = 'rgba(20,28,40,.86)';
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = Math.max(1, 1.6 * z);
  roundRect(ctx, x - 9 * z, y - 9 * z, 18 * z, 13 * z, 5 * z);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = C.parch;
  ctx.font = `900 ${(9.5 * z).toFixed(1)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(lv), x, y - 2.2 * z);
}

export function drawHpBar(d: Draw, x: number, y: number, w: number, ratio: number): void {
  const { ctx, cam } = d;
  const z = cam.z;
  ctx.fillStyle = 'rgba(10,14,22,.75)';
  roundRect(ctx, x - w / 2, y, w, 5.5 * z, 3 * z);
  ctx.fill();
  ctx.fillStyle = ratio > 0.5 ? '#5fd06a' : ratio > 0.22 ? '#e8b23c' : '#e0503a';
  roundRect(ctx, x - w / 2 + z, y + z, Math.max(0, (w - 2 * z) * ratio), 3.5 * z, 2 * z);
  ctx.fill();
}
