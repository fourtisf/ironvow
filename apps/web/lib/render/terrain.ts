import { APRON, IN0, IN1, N, TERRAIN_SEED, clamp } from '@ironvow/config';
import { mulberry } from '@ironvow/sim';
import { visibleGrid } from './camera';
import type { Draw } from './primitives';
import { C } from './palette';
import { isoDiamond, roundRect } from './primitives';
import { w2s, isoX, isoY } from './camera';

/**
 * The field and its surround.
 *
 * The apron is deliberately deep: it is what guarantees the flat backdrop can
 * never enter frame, whatever the camera clamp does at a corner.
 */

export type DecoKind = 'tree' | 'rock' | 'bush';

export interface Deco {
  gx: number;
  gy: number;
  k: DecoKind;
  s: number;
  /** Phase offset so neighbouring trees do not sway in lockstep. */
  p: number;
}

export interface Terrain {
  tile: Uint8Array;
  deco: Deco[];
}

/** Generated from a fixed seed, so every client draws the same map. */
export function generateTerrain(): Terrain {
  const r = mulberry(TERRAIN_SEED);
  const tile = new Uint8Array(N * N);
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const outside = gx < IN0 || gy < IN0 || gx >= IN1 || gy >= IN1;
      tile[gy * N + gx] = outside ? 1 : 0;
    }
  }

  // Scatter the treeline over the apron only, never over buildable ground.
  const deco: Deco[] = [];
  for (let i = 0; i < 420; i++) {
    const edge = Math.floor(r() * 4);
    const along = r() * (N + APRON);
    const depth = 1 + r() * (APRON - 4);
    let gx: number;
    let gy: number;
    if (edge === 0) { gx = along - APRON / 2; gy = -depth; }
    else if (edge === 1) { gx = along - APRON / 2; gy = N + depth; }
    else if (edge === 2) { gx = -depth; gy = along - APRON / 2; }
    else { gx = N + depth; gy = along - APRON / 2; }

    const roll = r();
    deco.push({
      gx, gy,
      k: roll < 0.68 ? 'tree' : roll < 0.86 ? 'rock' : 'bush',
      s: 0.7 + r() * 0.55,
      p: r() * 6.28,
    });
  }
  deco.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
  return { tile, deco };
}

export function drawTerrain(d: Draw, ter: Terrain): void {
  const { ctx, cam, vp } = d;

  // Three full-screen fills — a sentinel rect and two overlapping diamonds each
  // far wider than the viewport — were being laid down every frame before a
  // single building was drawn. At DPR 2 that is over four million pixels of
  // pure overdraw. Almost always the inner field alone already covers the
  // screen, and then one rect does the whole job.
  const v = visibleGrid(cam, vp);
  const inner = APRON * 0.45;
  const covered = v[0] >= -inner && v[1] <= N + inner && v[2] >= -inner && v[3] <= N + inner;
  if (covered) {
    ctx.fillStyle = C.grass;
    ctx.fillRect(0, 0, vp.w, vp.h);
  } else {
    // Sentinel. If this ever shows through, the apron is too small.
    ctx.fillStyle = '#0e1a12';
    ctx.fillRect(0, 0, vp.w, vp.h);
    isoDiamond(d, -APRON, -APRON, N + APRON * 2, N + APRON * 2, '#69a141');
    isoDiamond(d, -inner, -inner, N + inner * 2, N + inner * 2, C.grass);
  }

  // The apron used to be painted a tile at a time here, up to 432 diamonds a
  // frame, in the same green the diamond above had already laid down. It was
  // pure cost and is gone; `tile` survives because the apron/field split is
  // still what the camera clamp is written against.

  ctx.save();
  ctx.globalAlpha = 0.34;
  isoDiamond(d, IN0, IN0, IN1 - IN0, IN1 - IN0, 'rgba(0,0,0,0)', 0, '#4d7f33');
  ctx.restore();
}

/**
 * Deco painters.
 *
 * These draw at the origin in screen space at a given scale, which is what lets
 * the sprite cache rasterise each one once instead of re-issuing seven path
 * operations per tree per frame. A tree comes in two pieces because its canopy
 * sways and its trunk does not.
 */
export function paintDecoBase(ctx: CanvasRenderingContext2D, kind: DecoKind, s: number): void {
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.3, 2.2 * s);
  ctx.strokeStyle = C.line;

  if (kind === 'tree') {
    ctx.fillStyle = 'rgba(20,40,18,.24)';
    ctx.beginPath(); ctx.ellipse(0, 2 * s, 11 * s, 5 * s, 0, 0, 6.29); ctx.fill();
    ctx.fillStyle = C.woodD;
    roundRect(ctx, -2.6 * s, -16 * s, 5.2 * s, 17 * s, 2 * s);
    ctx.fill(); ctx.stroke();
  } else if (kind === 'rock') {
    ctx.fillStyle = 'rgba(20,40,18,.22)';
    ctx.beginPath(); ctx.ellipse(0, 2 * s, 10 * s, 4.5 * s, 0, 0, 6.29); ctx.fill();
    ctx.fillStyle = C.stone;
    ctx.beginPath();
    ctx.moveTo(-9 * s, 0);
    ctx.lineTo(-5 * s, -9 * s);
    ctx.lineTo(3 * s, -11 * s);
    ctx.lineTo(9 * s, -3 * s);
    ctx.lineTo(6 * s, s);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.stoneL;
    ctx.beginPath();
    ctx.moveTo(-5 * s, -9 * s);
    ctx.lineTo(3 * s, -11 * s);
    ctx.lineTo(s, -6 * s);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = '#3f8a41';
    ctx.beginPath(); ctx.ellipse(0, -5 * s, 9 * s, 7 * s, 0, 0, 6.29); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#54a84f';
    ctx.beginPath(); ctx.ellipse(-2 * s, -8 * s, 5 * s, 4 * s, 0, 0, 6.29); ctx.fill();
  }
}

/** A tree's canopy, which sways independently of its trunk. */
export function paintDecoCanopy(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.3, 2.2 * s);
  ctx.strokeStyle = C.line;
  ctx.fillStyle = '#3f8a41';
  ctx.beginPath(); ctx.ellipse(0, -26 * s, 14 * s, 12 * s, 0, 0, 6.29); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#54a84f';
  ctx.beginPath(); ctx.ellipse(-3 * s, -30 * s, 8 * s, 6.5 * s, 0, 0, 6.29); ctx.fill();
}
