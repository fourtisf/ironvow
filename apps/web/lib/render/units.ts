import { TROOP, type TroopType } from '@ironvow/config';
import { isoX, isoY, w2s } from './camera';
import type { Draw } from './primitives';
import { C } from './palette';
import { drawHpBar, roundRect } from './primitives';

/**
 * Troop art and battle effects, ported from the prototype.
 *
 * `flash` is decayed by the caller in one place for every entity. Prototype
 * bug #4 came from decaying it inside a loop that only visited defensive
 * structures, which left damaged mines washed out for the rest of the battle.
 */

export interface DrawableUnit {
  type: TroopType;
  x: number;
  y: number;
  /** True when this unit belongs to the viewer. */
  mine: boolean;
  hp: number;
  maxHp: number;
  moving: boolean;
  face: 1 | -1;
  /** Swing animation, 1 at the moment of the blow, decaying to 0. */
  swing: number;
  /** Hit flash, decaying to 0. */
  flash: number;
  /** Spawn time, so units of the same type do not march in lockstep. */
  born: number;
}

export function drawUnit(d: Draw, u: DrawableUnit): void {
  const { ctx, cam, vp, t } = d;
  const z = cam.z;
  const def = TROOP[u.type];
  const [sx, sy] = w2s(cam, vp, isoX(u.x, u.y), isoY(u.x, u.y));
  const S = (u.type === 'ram' ? 1.5 : 1) * 2.0 * z;
  const team = u.mine ? '#3f7fd6' : '#c2412d';
  const teamL = u.mine ? '#6ba4f0' : '#e0684f';
  const f = u.face;
  const walk = u.moving ? Math.sin(t * 11 + u.born * 7) : 0;
  const bob = u.moving ? Math.abs(Math.sin(t * 11 + u.born * 7)) * 1.1 * S : 0;
  const flashing = u.flash > 0;
  const P = (col: string): string => (flashing ? '#ffd8c2' : col);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const LW = Math.max(1.4, 2.1 * S);

  ctx.fillStyle = 'rgba(20,40,18,.3)';
  ctx.beginPath(); ctx.ellipse(sx, sy + 1.5 * z, 8.5 * S, 4 * S, 0, 0, 6.29); ctx.fill();
  ctx.strokeStyle = teamL;
  ctx.lineWidth = Math.max(1.5, 1.5 * S);
  ctx.beginPath(); ctx.ellipse(sx, sy + 1.5 * z, 8 * S, 3.6 * S, 0, 0, 6.29); ctx.stroke();

  const Y = (v: number): number => sy - v * S - bob;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = LW;

  if (u.type === 'ram') {
    ctx.fillStyle = P('#7a4f28');
    roundRect(ctx, sx - 15 * S, Y(15), 30 * S, 9 * S, 3 * S); ctx.fill(); ctx.stroke();
    ctx.fillStyle = P(C.wood);
    roundRect(ctx, sx - 17 * S, Y(11), 34 * S, 8 * S, 3.5 * S); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3f4a56';
    ctx.beginPath(); ctx.arc(sx + 17 * S * f, Y(15), 4 * S, 0, 6.29); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2b3440';
    for (const o of [-8, 8]) {
      ctx.beginPath(); ctx.arc(sx + o * S, Y(2.5), 3.6 * S, 0, 6.29); ctx.fill(); ctx.stroke();
    }
    for (const o of [-9, 7]) {
      ctx.fillStyle = P(team);
      roundRect(ctx, sx + o * S, Y(24), 6.5 * S, 9 * S, 2.5 * S); ctx.fill(); ctx.stroke();
      ctx.fillStyle = P('#e0b88f');
      ctx.beginPath(); ctx.arc(sx + (o + 3.2) * S, Y(27), 3.6 * S, 0, 6.29); ctx.fill(); ctx.stroke();
    }
  } else {
    // legs
    ctx.strokeStyle = C.line;
    ctx.fillStyle = P('#4a5462');
    [walk, -walk].forEach((w, i) => {
      ctx.save();
      ctx.translate(sx + (i ? 3 : -3) * S, Y(9));
      ctx.rotate(w * 0.42 * f);
      roundRect(ctx, -2.4 * S, 0, 4.8 * S, 10 * S, 2.2 * S);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    });
    // tunic
    ctx.fillStyle = P(def.col2);
    roundRect(ctx, sx - 7 * S, Y(23), 14 * S, 15 * S, 4.5 * S); ctx.fill(); ctx.stroke();
    // team sash
    ctx.fillStyle = P(team);
    roundRect(ctx, sx - 7 * S, Y(18), 14 * S, 4.5 * S, 2 * S); ctx.fill();
    ctx.strokeStyle = C.line; ctx.stroke();
    // pauldron
    ctx.fillStyle = P(def.col);
    ctx.beginPath(); ctx.ellipse(sx - 7.5 * S * f, Y(22), 4.2 * S, 3.4 * S, 0, 0, 6.29); ctx.fill(); ctx.stroke();
    // head and helm
    ctx.fillStyle = P('#e6bd93');
    ctx.beginPath(); ctx.arc(sx, Y(28.5), 5.4 * S, 0, 6.29); ctx.fill(); ctx.stroke();
    ctx.fillStyle = P(u.type === 'archer' ? '#3f7a44' : '#9aa7b4');
    ctx.beginPath(); ctx.arc(sx, Y(29.5), 5.8 * S, Math.PI * 1.03, Math.PI * 2.02); ctx.fill(); ctx.stroke();
    if (u.type === 'lancer') {
      ctx.fillStyle = P(team);
      roundRect(ctx, sx - 1.6 * S, Y(38), 3.2 * S, 6 * S, 1.4 * S); ctx.fill(); ctx.stroke();
    }

    const sw = u.swing;
    if (u.type === 'raider') {
      ctx.save();
      ctx.translate(sx + 7 * S * f, Y(20));
      ctx.rotate((-0.7 + sw * 1.5) * f);
      ctx.fillStyle = P('#cfdae6');
      roundRect(ctx, 0, -1.8 * S, 17 * S, 3.6 * S, 1.6 * S); ctx.fill(); ctx.stroke();
      ctx.fillStyle = P(C.woodD);
      roundRect(ctx, -4.5 * S, -2.4 * S, 5 * S, 4.8 * S, 2 * S); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = P(team);
      ctx.strokeStyle = C.line;
      ctx.beginPath(); ctx.ellipse(sx - 8 * S * f, Y(18), 4.6 * S, 6 * S, 0, 0, 6.29); ctx.fill(); ctx.stroke();
    } else if (u.type === 'archer') {
      ctx.strokeStyle = P(C.woodD);
      ctx.lineWidth = Math.max(1.6, 2.2 * S);
      ctx.beginPath(); ctx.arc(sx + 6 * S * f, Y(21), 8 * S, -1.1, 1.1); ctx.stroke();
      ctx.strokeStyle = P('#f2e4c4');
      ctx.lineWidth = Math.max(1, 1.2 * S);
      ctx.beginPath();
      ctx.moveTo(sx + (6 + 8 * Math.cos(-1.1)) * S * f, Y(21) + 8 * S * Math.sin(-1.1));
      ctx.lineTo(sx + (3 - sw * 3) * S * f, Y(21));
      ctx.lineTo(sx + (6 + 8 * Math.cos(1.1)) * S * f, Y(21) + 8 * S * Math.sin(1.1));
      ctx.stroke();
      ctx.strokeStyle = C.line;
      ctx.lineWidth = LW;
    } else {
      ctx.save();
      ctx.translate(sx + 6 * S * f, Y(21));
      ctx.rotate((-1.35 + sw * 0.9) * f);
      ctx.strokeStyle = P(C.woodD);
      ctx.lineWidth = Math.max(1.6, 2.4 * S);
      ctx.beginPath(); ctx.moveTo(0, 8 * S); ctx.lineTo(0, -22 * S); ctx.stroke();
      ctx.fillStyle = P('#cfdae6');
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(1.2, 1.7 * S);
      ctx.beginPath();
      ctx.moveTo(0, -30 * S); ctx.lineTo(4 * S, -20 * S); ctx.lineTo(-4 * S, -20 * S);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = P(team);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = LW;
      roundRect(ctx, sx - 12 * S * f, Y(25), 8 * S, 16 * S, 3 * S); ctx.fill(); ctx.stroke();
    }
  }

  if (u.hp < u.maxHp) drawHpBar(d, sx, Y(u.type === 'ram' ? 34 : 41), 30 * z, u.hp / u.maxHp);
}

export type FxKind = 'boom' | 'spark' | 'ring';

export interface Fx {
  k: FxKind;
  x: number;
  y: number;
  /** Age in seconds. */
  t: number;
  /** Footprint size, for a boom. */
  s?: number;
}

export const FX_LIFETIME = (k: FxKind): number => (k === 'boom' ? 0.75 : 0.4);

export function drawFx(d: Draw, f: Fx): void {
  const { ctx, cam, vp } = d;
  const z = cam.z;
  const [sx, sy] = w2s(cam, vp, isoX(f.x, f.y), isoY(f.x, f.y));

  if (f.k === 'boom') {
    const p = f.t / 0.75;
    ctx.globalAlpha = 1 - p;
    ctx.fillStyle = '#ffb347';
    ctx.beginPath(); ctx.arc(sx, sy - 10 * z, (14 + p * 34) * z * (f.s ?? 2) * 0.5, 0, 6.29); ctx.fill();
    ctx.fillStyle = '#fff2c8';
    ctx.beginPath(); ctx.arc(sx, sy - 10 * z, (7 + p * 16) * z * (f.s ?? 2) * 0.5, 0, 6.29); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (f.k === 'spark') {
    const p = f.t / 0.4;
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = '#ffd25c';
    ctx.lineWidth = 2.4 * z;
    for (let i = 0; i < 5; i++) {
      const a = i * 1.25 + f.x;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * 4 * z, sy - 8 * z + Math.sin(a) * 3 * z);
      ctx.lineTo(sx + Math.cos(a) * (5 + p * 13) * z, sy - 8 * z + Math.sin(a) * (3 + p * 8) * z);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else {
    const p = f.t / 0.4;
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = '#8fe07a';
    ctx.lineWidth = 3 * z;
    ctx.beginPath(); ctx.ellipse(sx, sy, (10 + p * 26) * z, (5 + p * 13) * z, 0, 0, 6.29); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export interface DrawableProjectile {
  x: number;
  y: number;
  kind: 'arrow' | 'ball';
}

export function drawProjectile(d: Draw, p: DrawableProjectile): void {
  const { ctx, cam, vp } = d;
  const z = cam.z;
  const [sx, sy] = w2s(cam, vp, isoX(p.x, p.y), isoY(p.x, p.y));
  if (p.kind === 'ball') {
    ctx.fillStyle = '#2b3440';
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1.8 * z;
    ctx.beginPath(); ctx.arc(sx, sy - 14 * z, 4.5 * z, 0, 6.29); ctx.fill(); ctx.stroke();
  } else {
    ctx.strokeStyle = '#f2e4c4';
    ctx.lineWidth = 2.2 * z;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx - 6 * z, sy - 14 * z);
    ctx.lineTo(sx + 6 * z, sy - 15 * z);
    ctx.stroke();
  }
}
