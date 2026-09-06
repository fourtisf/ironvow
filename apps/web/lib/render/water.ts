import { APRON, N } from '@ironvow/config';
import { isoX, isoY, w2s } from './camera';
import { C } from './palette';
import type { Draw } from './primitives';

/**
 * Water on the apron.
 *
 * Two pools, one broad and one small, cut into the lower ground so the world
 * around the hold is a place rather than a lawn. They are generated from the
 * same seed as the treeline, which keeps out of them.
 */

export interface Lake {
  /** Centre, grid units. */
  cx: number;
  cy: number;
  /** Shoreline in grid units, counter-clockwise. */
  pts: [number, number][];
}

/** A soft blob: a circle with two low-frequency ripples in its radius. */
function blob(r: () => number, cx: number, cy: number, rx: number, ry: number): Lake {
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  const pts: [number, number][] = [];
  const n = 30;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.2832;
    const k = 1 + 0.16 * Math.sin(3 * a + p1) + 0.09 * Math.sin(5 * a + p2);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return { cx, cy, pts };
}

export function generateLakes(r: () => number): Lake[] {
  // Off the south-east edge, where the cliff face is lit and the shore is in
  // full view; and a pond behind the hold to the north-west. Both start at
  // least four tiles out, clear of the cliff's shadow.
  return [
    blob(r, N + 11.5, 24 + r() * 6, 6.2, 8.4),
    blob(r, -8.5 - r() * 2, 30 + r() * 8, 3.6, 4.8),
  ];
}

/** Point-in-polygon against the shore scaled by `grow` about the centre. */
export function inLake(lakes: readonly Lake[], gx: number, gy: number, grow = 1): boolean {
  for (const l of lakes) {
    let inside = false;
    const pts = l.pts;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = l.cx + (pts[i]![0] - l.cx) * grow, yi = l.cy + (pts[i]![1] - l.cy) * grow;
      const xj = l.cx + (pts[j]![0] - l.cx) * grow, yj = l.cy + (pts[j]![1] - l.cy) * grow;
      if ((yi > gy) !== (yj > gy) && gx < ((xj - xi) * (gy - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/** True when any part of the lake could be on screen. Cheap and generous. */
function lakeOnScreen(d: Draw, l: Lake): boolean {
  const { cam, vp } = d;
  const reach = (APRON / 2) * 64 * cam.z;
  const [sx, sy] = w2s(cam, vp, isoX(l.cx, l.cy), isoY(l.cx, l.cy));
  return sx > -reach && sx < vp.w + reach && sy > -reach && sy < vp.h + reach;
}

function shore(d: Draw, l: Lake, grow: number, dy = 0): void {
  const { ctx, cam, vp } = d;
  ctx.beginPath();
  l.pts.forEach(([gx, gy], i) => {
    const x = l.cx + (gx - l.cx) * grow;
    const y = l.cy + (gy - l.cy) * grow;
    const [sx, sy] = w2s(cam, vp, isoX(x, y), isoY(x, y));
    if (i === 0) ctx.moveTo(sx, sy + dy);
    else ctx.lineTo(sx, sy + dy);
  });
  ctx.closePath();
}

export function drawLakes(d: Draw, lakes: readonly Lake[]): void {
  const { ctx, cam, t } = d;
  const z = cam.z;
  for (const l of lakes) {
    if (!lakeOnScreen(d, l)) continue;

    // Wet sand, then the bank's small drop, then the water.
    shore(d, l, 1.16);
    ctx.fillStyle = '#c9b477';
    ctx.fill();
    shore(d, l, 1.0, 3 * z);
    ctx.fillStyle = '#8d7a4a';
    ctx.fill();
    shore(d, l, 1.0);
    ctx.fillStyle = '#3a86bb';
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.4, 2.2 * z);
    ctx.strokeStyle = C.line;
    ctx.stroke();
    // Shallows at the middle, a touch lighter.
    shore(d, l, 0.72);
    ctx.fillStyle = 'rgba(96,176,222,.55)';
    ctx.fill();

    // Sun on the water: short strokes that brighten and fade out of step.
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, 1.6 * z);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.399;                       // golden angle, evenly spread
      const rr = 0.25 + ((i * 37) % 11) / 20;     // 0.25 .. 0.75 of the radius
      const gx = l.cx + Math.cos(a) * rr * (l.pts[0]![0] - l.cx) * 0.9;
      const gy = l.cy + Math.sin(a) * rr * (l.pts[7]![1] - l.cy) * 0.9;
      const [sx, sy] = w2s(cam, d.vp, isoX(gx, gy), isoY(gx, gy));
      const glow = 0.5 + 0.5 * Math.sin(t * 1.7 + i * 1.3);
      ctx.strokeStyle = `rgba(230,246,255,${(0.18 + 0.5 * glow).toFixed(3)})`;
      const len = (5 + 4 * glow) * z;
      ctx.beginPath();
      ctx.moveTo(sx - len, sy);
      ctx.lineTo(sx + len, sy);
      ctx.stroke();
    }
  }
}
