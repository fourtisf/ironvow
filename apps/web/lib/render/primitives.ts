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
  ctx.lineWidth = Math.max(1.6, 2.6 * z);
  ctx.strokeStyle = o;

  ctx.fillStyle = left;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]); ctx.lineTo(dd[0], dd[1]); ctx.lineTo(D[0], D[1]); ctx.lineTo(A[0], A[1]);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  ctx.fillStyle = right;
  ctx.beginPath();
  ctx.moveTo(dd[0], dd[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(Cc[0], Cc[1]); ctx.lineTo(D[0], D[1]);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(Cc[0], Cc[1]); ctx.lineTo(D[0], D[1]);
  ctx.closePath(); ctx.fill(); ctx.stroke();

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
  ctx.fillStyle = fill;
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
  const face = (p: Corner, q: Corner, col: string): void => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(K[0], K[1]);
    ctx.closePath(); ctx.fill(); ctx.stroke();
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
  ctx.fillStyle = 'rgba(20,40,18,.26)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 3 * z, ((w * TW) / 2) * 0.62 * z, ((h * TH) / 2) * 0.72 * z, 0, 0, 6.29);
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
