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
  // Sentinel. If this ever shows through, the apron is too small.
  ctx.fillStyle = '#0e1a12';
  ctx.fillRect(0, 0, vp.w, vp.h);

  isoDiamond(d, -APRON, -APRON, N + APRON * 2, N + APRON * 2, '#69a141');
  isoDiamond(d, -APRON * 0.45, -APRON * 0.45, N + APRON * 0.9, N + APRON * 0.9, C.grass);

  const v = visibleGrid(cam, vp);
  const gx0 = clamp(Math.floor(v[0]), 0, N - 1);
  const gx1 = clamp(Math.ceil(v[1]), 0, N);
  const gy0 = clamp(Math.floor(v[2]), 0, N - 1);
  const gy1 = clamp(Math.ceil(v[3]), 0, N);
  for (let gy = gy0; gy < gy1; gy++) {
    for (let gx = gx0; gx < gx1; gx++) {
      if (ter.tile[gy * N + gx] === 0) continue;
      isoDiamond(d, gx, gy, 1.04, 1.04, C.grass);
    }
  }

  ctx.save();
  ctx.globalAlpha = 0.34;
  isoDiamond(d, IN0, IN0, IN1 - IN0, IN1 - IN0, 'rgba(0,0,0,0)', 0, '#4d7f33');
  ctx.restore();
}

export function drawDeco(d: Draw, deco: Deco): void {
  const { ctx, cam, vp, t } = d;
  const z = cam.z;
  const [sx, sy] = w2s(cam, vp, isoX(deco.gx, deco.gy), isoY(deco.gx, deco.gy));
  if (sx < -60 || sx > vp.w + 60 || sy < -60 || sy > vp.h + 80) return;
  const s = deco.s * z;

  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.3, 2.2 * z);
  ctx.strokeStyle = C.line;

  if (deco.k === 'tree') {
    const sway = Math.sin(t * 1.1 + deco.p) * 1.8 * s;
    ctx.fillStyle = 'rgba(20,40,18,.24)';
    ctx.beginPath(); ctx.ellipse(sx, sy + 2 * z, 11 * s, 5 * s, 0, 0, 6.29); ctx.fill();
    ctx.fillStyle = C.woodD;
    roundRect(ctx, sx - 2.6 * s, sy - 16 * s, 5.2 * s, 17 * s, 2 * s);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3f8a41';
    ctx.beginPath(); ctx.ellipse(sx + sway, sy - 26 * s, 14 * s, 12 * s, 0, 0, 6.29); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#54a84f';
    ctx.beginPath(); ctx.ellipse(sx + sway - 3 * s, sy - 30 * s, 8 * s, 6.5 * s, 0, 0, 6.29); ctx.fill();
  } else if (deco.k === 'rock') {
    ctx.fillStyle = 'rgba(20,40,18,.22)';
    ctx.beginPath(); ctx.ellipse(sx, sy + 2 * z, 10 * s, 4.5 * s, 0, 0, 6.29); ctx.fill();
    ctx.fillStyle = C.stone;
    ctx.beginPath();
    ctx.moveTo(sx - 9 * s, sy);
    ctx.lineTo(sx - 5 * s, sy - 9 * s);
    ctx.lineTo(sx + 3 * s, sy - 11 * s);
    ctx.lineTo(sx + 9 * s, sy - 3 * s);
    ctx.lineTo(sx + 6 * s, sy + s);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.stoneL;
    ctx.beginPath();
    ctx.moveTo(sx - 5 * s, sy - 9 * s);
    ctx.lineTo(sx + 3 * s, sy - 11 * s);
    ctx.lineTo(sx + s, sy - 6 * s);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = '#3f8a41';
    ctx.beginPath(); ctx.ellipse(sx, sy - 5 * s, 9 * s, 7 * s, 0, 0, 6.29); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#54a84f';
    ctx.beginPath(); ctx.ellipse(sx - 2 * s, sy - 8 * s, 5 * s, 4 * s, 0, 0, 6.29); ctx.fill();
  }
}
