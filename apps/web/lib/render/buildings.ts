import { TYPES, type BuildingType } from '@ironvow/config';
import { isoX, isoY, w2s } from './camera';
import type { Draw } from './primitives';
import { C, PIPH, bannerColor } from './palette';
import { drawLevelPip, isoBox, isoDiamond, isoRoof, roundRect, shadowAt } from './primitives';

/**
 * Procedural building art, ported from the prototype.
 *
 * Every structure is drawn from primitives at runtime. There is no sprite
 * sheet and no asset pipeline, which is what keeps the download tiny and lets a
 * level-9 Keep differ from a level-1 one without a second texture.
 *
 * It is split in two halves on purpose. `drawBuildingBody` depends only on
 * type, level and livery, so a full base of two hundred structures can be
 * rasterised once and blitted (see sprites.ts); `drawBuildingFx` is the handful
 * of parts that move — banners, smoke, a cannon barrel — and has to be redrawn
 * every frame. Before the split a single frame issued about 4,700 path
 * operations and ran at 10fps on a mid-range phone.
 */

export interface Renderable {
  type: BuildingType;
  gx: number;
  gy: number;
  level: number;
  /** 0..1 while a builder is on it. Undefined when idle. */
  progress?: number;
  /** True for a building that is still going up, as opposed to being upgraded. */
  scaffold?: boolean;
  /** Cannon barrel angle, set by the battle renderer. Cosmetic only. */
  aim?: number;
  /** 0..1, decays after firing. */
  recoil?: number;
}

/** Types with a moving part. Everything else needs no per-frame work at all. */
export const ANIMATED: ReadonlySet<BuildingType> = new Set<BuildingType>([
  'keep', 'forge', 'barr', 'lab', 'cannon',
]);

/**
 * The static half: the structure itself.
 *
 * Must stay a pure function of (type, level, enemy, zoom), because that tuple
 * is the sprite cache key. Anything reading the clock belongs in the fx half.
 */
export function drawBuildingBody(d: Draw, b: Renderable, enemy: boolean): void {
  const { ctx, cam, vp } = d;
  const def = TYPES[b.type];
  const s = def.s;
  const { gx, gy } = b;
  const z = cam.z;
  const lv = b.level;

  shadowAt(d, gx, gy, s, s);

  const P = (ax: number, ay: number): [number, number] => w2s(cam, vp, isoX(ax, ay), isoY(ax, ay));

  if (b.type === 'keep') {
    const wallH = 92 + lv * 4;
    const turH = 62 + lv * 3;
    isoBox(d, gx + 0.05, gy + 0.05, s - 0.1, s - 0.1, 12, '#9aa7b4', C.stoneD, '#78858f');

    // Back turret first, then the sides, then the keep block, then the front
    // turret: painter's order, so nothing occludes what should be in front.
    const turret = (tx: number, ty: number): void => {
      isoBox(d, tx, ty, 0.85, 0.85, turH, C.stoneL, C.stoneD, C.stone);
      isoRoof(d, tx, ty, 0.85, 0.85, turH, turH + 26,
        enemy ? '#a03828' : '#3f6fbe', enemy ? '#6d2216' : '#2a4c88');
    };
    turret(gx + 0.05, gy + 0.05);
    turret(gx + s - 0.9, gy + 0.05);
    turret(gx + 0.05, gy + s - 0.9);

    isoBox(d, gx + 0.72, gy + 0.72, s - 1.44, s - 1.44, wallH, C.stoneL, C.stoneD, C.stone);
    isoRoof(d, gx + 0.58, gy + 0.58, s - 1.16, s - 1.16, wallH, wallH + 34,
      enemy ? '#a03828' : '#3f6fbe', enemy ? '#6d2216' : '#2a4c88');

    for (let i = 0; i < 4; i++) {
      const f = 0.72 + ((s - 1.44) * (i + 0.5)) / 4;
      const [mx, my] = P(gx + f, gy + s - 0.72);
      ctx.fillStyle = C.stoneL;
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(1.2, 2 * z);
      roundRect(ctx, mx - 4.5 * z, my - (wallH + 9) * z, 9 * z, 11 * z, 1.5 * z);
      ctx.fill(); ctx.stroke();
    }

    const [dx, dy] = P(gx + s / 2, gy + s - 0.72);
    ctx.fillStyle = '#4a3a28';
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.2, 2 * z);
    ctx.beginPath();
    ctx.moveTo(dx - 8 * z, dy - 4 * z);
    ctx.lineTo(dx - 8 * z, dy - 22 * z);
    ctx.quadraticCurveTo(dx, dy - 33 * z, dx + 8 * z, dy - 22 * z);
    ctx.lineTo(dx + 8 * z, dy - 4 * z);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    turret(gx + s - 0.9, gy + s - 0.9);

  } else if (b.type === 'mine') {
    isoBox(d, gx + 0.05, gy + 0.05, s - 0.1, s - 0.1, 10, C.dirt, C.dirt2, '#a87a41');
    isoBox(d, gx + 0.2, gy + 0.2, 1.45, 1.45, 40, '#9c6a3e', '#5d3b1e', '#7a4f28');
    isoRoof(d, gx + 0.08, gy + 0.08, 1.7, 1.7, 40, 76, '#c9924f', '#7d5028');

    const [ex, ey] = P(gx + 0.92, gy + 1.65);
    ctx.fillStyle = '#241a12';
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.2, 2 * z);
    ctx.beginPath();
    ctx.moveTo(ex - 9 * z, ey);
    ctx.lineTo(ex - 9 * z, ey - 16 * z);
    ctx.quadraticCurveTo(ex, ey - 27 * z, ex + 9 * z, ey - 16 * z);
    ctx.lineTo(ex + 9 * z, ey);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = C.woodD;
    ctx.lineWidth = Math.max(1.6, 2.6 * z);
    ctx.beginPath();
    ctx.moveTo(ex - 11 * z, ey + z);
    ctx.lineTo(ex - 11 * z, ey - 18 * z);
    ctx.lineTo(ex + 11 * z, ey - 18 * z);
    ctx.lineTo(ex + 11 * z, ey + z);
    ctx.stroke();

    const [cx2, cy2] = P(gx + 1.75, gy + 1.15);
    ctx.fillStyle = '#5b6875';
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.2, 2 * z);
    roundRect(ctx, cx2 - 11 * z, cy2 - 16 * z, 22 * z, 12 * z, 3 * z);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.gold;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(cx2 - 6 * z + i * 6 * z, cy2 - 17 * z, 4.2 * z, 3 * z, 0, 0, 6.29);
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#2b3440';
    ctx.beginPath(); ctx.arc(cx2 - 6 * z, cy2 - 3 * z, 3.4 * z, 0, 6.29); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx2 + 6 * z, cy2 - 3 * z, 3.4 * z, 0, 6.29); ctx.fill(); ctx.stroke();

  } else if (b.type === 'forge') {
    isoBox(d, gx + 0.06, gy + 0.06, s - 0.12, s - 0.12, 9, '#6b5340', '#4a382b', '#5a4636');
    isoBox(d, gx + 0.3, gy + 0.3, 0.55, 0.55, 74, C.stoneL, C.stoneD, C.stone);
    isoBox(d, gx + 0.22, gy + 0.22, 1.55, 1.55, 42, '#a8927c', '#6b5a49', '#8a765f');
    isoRoof(d, gx + 0.22, gy + 0.22, 1.55, 1.55, 42, 60, '#7d5a3c', '#54402c');

  } else if (b.type === 'store') {
    isoBox(d, gx + 0.08, gy + 0.08, s - 0.16, s - 0.16, 8, '#6b5340', '#4a382b', '#5a4636');
    const r = isoBox(d, gx + 0.25, gy + 0.25, 1.5, 1.5, 44, C.wood, C.woodD, '#734829');
    isoRoof(d, gx + 0.25, gy + 0.25, 1.5, 1.5, 44, 60, '#a06f3d', '#6b4526');
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = Math.max(1.8, 3 * z);
    ctx.beginPath(); ctx.moveTo(r.A[0], r.A[1]); ctx.lineTo(r.C[0], r.C[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r.B[0], r.B[1]); ctx.lineTo(r.D[0], r.D[1]); ctx.stroke();
    ctx.fillStyle = C.gold;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.2, 2 * z);
    ctx.beginPath(); ctx.ellipse(r.cx, r.cy, 6 * z, 6 * z, 0, 0, 6.29); ctx.fill(); ctx.stroke();

  } else if (b.type === 'barr') {
    isoBox(d, gx + 0.08, gy + 0.08, s - 0.16, s - 0.16, 9, C.dirt, C.dirt2, '#a87a41');
    isoBox(d, gx + 0.42, gy + 0.42, s - 0.84, s - 0.84, 40, '#a8926f', '#5a3a21', '#8c5f39');
    isoRoof(d, gx + 0.3, gy + 0.3, s - 0.6, s - 0.6, 40, 104, '#e2d3ad', '#8f7a52');

    const [dx2, dy2] = P(gx + s / 2, gy + s - 0.42);
    ctx.fillStyle = '#3f2d1c';
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.2, 2 * z);
    roundRect(ctx, dx2 - 7 * z, dy2 - 26 * z, 14 * z, 22 * z, 6 * z);
    ctx.fill(); ctx.stroke();

    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const bx = dx2 - 34 * z + i * 9 * z;
      ctx.strokeStyle = C.woodD;
      ctx.lineWidth = Math.max(1.8, 2.9 * z);
      ctx.beginPath(); ctx.moveTo(bx, dy2 - 2 * z); ctx.lineTo(bx + 4 * z, dy2 - 28 * z); ctx.stroke();
      ctx.fillStyle = '#c9d6e4';
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(1, 1.6 * z);
      ctx.beginPath();
      ctx.moveTo(bx + 4 * z, dy2 - 34 * z);
      ctx.lineTo(bx + 7 * z, dy2 - 27 * z);
      ctx.lineTo(bx + z, dy2 - 27 * z);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }

  } else if (b.type === 'lab') {
    // A workshop: stone base, tiled roof, and a bubbling crucible whose glow
    // pulses on the same clock as the forge, so the pair read as related.
    isoBox(d, gx + 0.06, gy + 0.06, s - 0.12, s - 0.12, 9, C.stone, C.stoneD, '#77848f');
    isoBox(d, gx + 0.26, gy + 0.26, 1.48, 1.48, 38, '#8d84a8', '#4c4560', '#6d6584');
    isoRoof(d, gx + 0.16, gy + 0.16, 1.68, 1.68, 38, 72, '#7f6fb0', '#4e4276');

    const [px, py] = P(gx + s / 2, gy + s / 2);
    const top = py - 38 * z;

    // Crucible on a tripod.
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.4, 2.2 * z);
    ctx.fillStyle = '#3f4a56';
    ctx.beginPath();
    ctx.ellipse(px, top - 6 * z, 9 * z, 6 * z, 0, 0, 6.29);
    ctx.fill();
    ctx.stroke();

  } else if (b.type === 'cannon') {
    isoBox(d, gx + 0.1, gy + 0.1, s - 0.2, s - 0.2, 12, C.stone, C.stoneD, '#77848f');
    isoBox(d, gx + 0.42, gy + 0.42, 1.16, 1.16, 30, C.stoneL, C.stoneD, C.stone);
    const [px, py] = P(gx + s / 2, gy + s / 2);
    const top = py - 30 * z;
    ctx.fillStyle = '#3f4a56';
    ctx.strokeStyle = C.line;
    ctx.beginPath(); ctx.ellipse(px, top + 3 * z, 10 * z, 7 * z, 0, 0, 6.29); ctx.fill(); ctx.stroke();

  } else if (b.type === 'tower') {
    isoBox(d, gx + 0.12, gy + 0.12, s - 0.24, s - 0.24, 11, C.stone, C.stoneD, '#77848f');
    const th = 78 + lv * 3;
    isoBox(d, gx + 0.35, gy + 0.35, 1.3, 1.3, th, C.stoneL, C.stoneD, C.stone);
    isoRoof(d, gx + 0.18, gy + 0.18, 1.64, 1.64, th, th + 36,
      enemy ? '#a03828' : '#3f6fbe', enemy ? '#6d2216' : '#2a4c88');
    const [px, py] = P(gx + s / 2, gy + s / 2);
    const top = py - th * z;
    ctx.fillStyle = '#1b2432';
    roundRect(ctx, px - 2.8 * z, top + 22 * z, 5.6 * z, 13 * z, 2.4 * z);
    ctx.fill();

  } else if (b.type === 'wall') {
    const wh = 24 + lv * 2.2;
    isoBox(d, gx + 0.02, gy + 0.02, 0.96, 0.96, wh, '#96a3b0', '#54626e', '#74828e');
    const [px, py] = P(gx + 0.5, gy + 0.5);
    ctx.fillStyle = '#a9b6c2';
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.1, 1.8 * z);
    roundRect(ctx, px - 5 * z, py - (wh + 9) * z, 10 * z, 10 * z, 2 * z);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(30,40,52,.35)';
    ctx.lineWidth = Math.max(1, 1.5 * z);
    ctx.beginPath();
    ctx.moveTo(px, py - wh * z + 8 * z);
    ctx.lineTo(px, py + 6 * z);
    ctx.stroke();
  }

  if (b.type !== 'wall') {
    const [px, py] = P(gx + s / 2, gy + s / 2);
    drawLevelPip(d, px, py - (PIPH[b.type] ?? 0) * z, lv);
  }
}

/**
 * The moving half: banners, smoke, glow, a cannon barrel.
 *
 * Drawn straight to the frame on top of the cached body, so it is the only
 * per-building path work left in a steady-state frame. Skipped entirely on low
 * graphics quality.
 */
export function drawBuildingFx(d: Draw, b: Renderable, enemy: boolean): void {
  const { ctx, cam, vp, t } = d;
  const def = TYPES[b.type];
  const s = def.s;
  const { gx, gy } = b;
  const z = cam.z;
  const lv = b.level;
  const P = (ax: number, ay: number): [number, number] => w2s(cam, vp, isoX(ax, ay), isoY(ax, ay));

  if (b.type === 'keep') {
    const wallH = 92 + lv * 4;
    const [px, py] = P(gx + s / 2, gy + s / 2);
    const top = py - (wallH + 34) * z;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.5, 2.4 * z);
    // The pole belongs with the cloth, not with the stonework: a bare mast over
    // every Keep is what low quality looked like when it was in the body.
    ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, top - 30 * z); ctx.stroke();
    const wave = Math.sin(t * 2.4) * 3 * z;
    ctx.fillStyle = bannerColor(enemy);
    ctx.beginPath();
    ctx.moveTo(px, top - 30 * z);
    ctx.lineTo(px + 22 * z + wave, top - 25 * z);
    ctx.lineTo(px + 16 * z + wave, top - 17 * z);
    ctx.lineTo(px + 22 * z + wave, top - 10 * z);
    ctx.lineTo(px, top - 13 * z);
    ctx.closePath(); ctx.fill(); ctx.stroke();

  } else if (b.type === 'forge') {
    const [px, py] = P(gx + 0.575, gy + 0.575);
    const chimney = py - 74 * z;
    for (let i = 0; i < 4; i++) {
      const p = (t * 0.55 + i * 0.25) % 1;
      ctx.fillStyle = `rgba(190,200,212,${(0.4 * (1 - p)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px + Math.sin(p * 5 + i) * 8 * z, chimney - p * 42 * z, (3.5 + p * 9) * z, 0, 6.29);
      ctx.fill();
    }
    const glow = 0.55 + Math.sin(t * 4.5) * 0.2;
    ctx.fillStyle = `rgba(255,140,40,${glow.toFixed(2)})`;
    const [ax, ay] = P(gx + 1.5, gy + 1.5);
    ctx.beginPath(); ctx.ellipse(ax, ay - 10 * z, 8 * z, 5.5 * z, 0, 0, 6.29); ctx.fill();

  } else if (b.type === 'barr') {
    const K = P(gx + s / 2, gy + s / 2);
    K[1] -= 104 * z;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.3, 2.1 * z);
    ctx.beginPath(); ctx.moveTo(K[0], K[1]); ctx.lineTo(K[0], K[1] - 20 * z); ctx.stroke();
    ctx.fillStyle = bannerColor(enemy);
    const wave2 = Math.sin(t * 2.8 + 1.4) * 2.5 * z;
    ctx.beginPath();
    ctx.moveTo(K[0], K[1] - 20 * z);
    ctx.lineTo(K[0] + 15 * z + wave2, K[1] - 16 * z);
    ctx.lineTo(K[0], K[1] - 11 * z);
    ctx.closePath(); ctx.fill(); ctx.stroke();

  } else if (b.type === 'lab') {
    const [px, py] = P(gx + s / 2, gy + s / 2);
    const top = py - 38 * z;
    const bubble = 0.55 + Math.sin(t * 3.1) * 0.25;
    ctx.fillStyle = `rgba(150,240,190,${bubble.toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(px, top - 8 * z, 6.5 * z, 3.6 * z, 0, 0, 6.29);
    ctx.fill();

    // Vapour, drifting and fading.
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.42 + i * 0.33) % 1;
      ctx.fillStyle = `rgba(170,240,205,${(0.34 * (1 - p)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px + Math.sin(p * 4 + i * 2) * 6 * z, top - 12 * z - p * 34 * z, (2.6 + p * 6) * z, 0, 6.29);
      ctx.fill();
    }

  } else if (b.type === 'cannon') {
    const [px, py] = P(gx + s / 2, gy + s / 2);
    const top = py - 30 * z;
    const ang = b.aim ?? -0.5;
    const recoil = b.recoil ? b.recoil * 6 * z : 0;
    ctx.save();
    ctx.translate(px, top);
    ctx.rotate(ang);
    ctx.fillStyle = '#3f4a56';
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.5, 2.4 * z);
    roundRect(ctx, -7 * z - recoil, -6 * z, 38 * z, 12 * z, 5 * z);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5b6875';
    roundRect(ctx, -7 * z - recoil, -6 * z, 38 * z, 5 * z, 3 * z);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Uncached path: body then fx, straight to the frame.
 *
 * Kept for anywhere a one-off structure is drawn (the placement ghost) where a
 * cache entry would be evicted before it were ever reused.
 */
export function drawBuilding(d: Draw, b: Renderable, enemy: boolean, ghostAlpha?: number): void {
  const { ctx } = d;
  if (ghostAlpha !== undefined) {
    ctx.save();
    ctx.globalAlpha = ghostAlpha;
  }
  drawBuildingBody(d, b, enemy);
  drawBuildingFx(d, b, enemy);
  if (ghostAlpha !== undefined) ctx.restore();
  if (b.progress !== undefined) drawBuilderMark(d, b, TYPES[b.type].s);
}

/**
 * Scaffolding and a progress bar.
 *
 * A building still going up gets poles and a wash over its footprint, so it is
 * obvious at a glance that it is not working yet. One being upgraded gets only
 * the bar, because it is working the whole time and dimming it would say
 * otherwise.
 */
export function drawBuilderMark(d: Draw, b: Renderable, size: number): void {
  const { ctx, cam, vp } = d;
  const z = cam.z;
  const progress = Math.max(0, Math.min(1, b.progress ?? 0));
  const P = (ax: number, ay: number): [number, number] => w2s(cam, vp, isoX(ax, ay), isoY(ax, ay));

  if (b.scaffold) {
    isoDiamond(d, b.gx, b.gy, size, size, 'rgba(232,178,60,.18)', 0, '#e8b23c');

    // Four corner poles with a rail between them.
    const h = 26 + size * 8;
    ctx.strokeStyle = '#c9924f';
    ctx.lineWidth = Math.max(1.4, 2.2 * z);
    ctx.lineCap = 'round';
    const corners: [number, number][] = [
      [b.gx + 0.15, b.gy + 0.15], [b.gx + size - 0.15, b.gy + 0.15],
      [b.gx + size - 0.15, b.gy + size - 0.15], [b.gx + 0.15, b.gy + size - 0.15],
    ];
    const tops = corners.map(([cx, cy]) => {
      const [px, py] = P(cx, cy);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - h * z);
      ctx.stroke();
      return [px, py - h * z] as [number, number];
    });
    ctx.beginPath();
    ctx.moveTo(tops[0]![0], tops[0]![1]);
    for (const t of tops.slice(1)) ctx.lineTo(t[0], t[1]);
    ctx.closePath();
    ctx.stroke();
  }

  // Sized to be readable at the zoom a whole base is framed at, which is the
  // zoom the player actually spends their time in.
  const [bx, by] = P(b.gx + size / 2, b.gy + size / 2);
  const top = by - (56 + size * 22) * z;
  const w = 46 * z;
  const h = 8 * z;

  ctx.fillStyle = 'rgba(10,14,22,.85)';
  ctx.strokeStyle = '#e8b23c';
  ctx.lineWidth = Math.max(1, 1.4 * z);
  roundRect(ctx, bx - w / 2, top, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#8fe07a';
  roundRect(ctx, bx - w / 2 + 1.5 * z, top + 1.5 * z, Math.max(0, (w - 3 * z) * progress), h - 3 * z, (h - 3 * z) / 2);
  ctx.fill();
}
