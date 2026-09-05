import { PROD, TYPES } from '@ironvow/config';
import { isoX, isoY, onScreen, w2s } from '../render/camera';
import type { Draw } from '../render/primitives';
import { drawBuilding } from '../render/buildings';
import { C } from '../render/palette';
import { drawHpBar, isoDiamond, roundRect } from '../render/primitives';
import { drawDeco, drawTerrain } from '../render/terrain';
import { drawProjectile, drawUnit } from '../render/units';
import type { ClientBuilding } from './types';
import type { World } from './world';

/**
 * One frame.
 *
 * Everything is gathered into a single depth-sorted list before anything is
 * drawn, because in an isometric projection the only correct order is by
 * gx + gy: a unit standing in front of a tower has to be painted after it, and
 * that cannot be decided per-category.
 */

function draw(w: World, ctx: CanvasRenderingContext2D): Draw {
  return { ctx, cam: w.cam, vp: w.vp, t: w.t };
}

export function renderFrame(w: World, ctx: CanvasRenderingContext2D): void {
  if (w.mode === 'battle' && w.battle) renderBattle(w, ctx);
  else renderBase(w, ctx);
}

/**
 * Depth-sorted draw list.
 *
 * Split by scene rather than one union across both, so the narrowing in each
 * loop is exhaustive and a battle entity cannot leak into the base renderer.
 */
type BaseEntity =
  | { d: number; k: 'deco'; i: number }
  | { d: number; k: 'building'; b: ClientBuilding };

type BattleEntity =
  | { d: number; k: 'deco'; i: number }
  | { d: number; k: 'struct'; i: number }
  | { d: number; k: 'unit'; i: number };

function renderBase(w: World, ctx: CanvasRenderingContext2D): void {
  const d = draw(w, ctx);
  drawTerrain(d, w.terrain);

  // Scouting: draw the defender's frozen base in enemy livery instead of the
  // player's own, so the layout can actually be studied before committing.
  if (w.preview) {
    renderPreview(w, ctx, d);
    return;
  }

  const ents: BaseEntity[] = [];
  if (w.quality === 'high') {
    w.terrain.deco.forEach((deco, i) => {
      if (onScreen(w.cam, w.vp, deco.gx, deco.gy)) ents.push({ d: deco.gx + deco.gy, k: 'deco', i });
    });
  }
  for (const b of w.player?.buildings ?? []) {
    ents.push({ d: b.gx + b.gy + TYPES[b.type].s * 0.5, k: 'building', b });
  }
  ents.sort((a, b) => a.d - b.d);

  const place = w.placement;
  if (place) {
    const s = TYPES[place.type].s;
    isoDiamond(d, place.gx, place.gy, s, s,
      place.ok ? 'rgba(90,220,110,.35)' : 'rgba(230,70,50,.35)', 0,
      place.ok ? '#8fe07a' : '#ff7a63');
  }

  for (const e of ents) {
    if (e.k === 'deco') {
      drawDeco(d, w.terrain.deco[e.i]!);
      continue;
    }
    const b = e.b;
    // The building being relocated is drawn as the ghost instead, so it does
    // not appear twice while the move is in flight.
    if (place?.movingId === b.id) continue;

    ctx.save();
    if (b.bump) {
      const k = 1 + Math.sin(b.bump * Math.PI) * 0.09;
      const s = TYPES[b.type].s;
      const [cx, cy] = w2s(w.cam, w.vp, isoX(b.gx + s / 2, b.gy + s / 2), isoY(b.gx + s / 2, b.gy + s / 2));
      ctx.translate(cx, cy);
      ctx.scale(k, k);
      ctx.translate(-cx, -cy);
    }
    // Progress is interpolated locally between polls, so the bar creeps rather
    // than jumping every thirty seconds.
    const job = builderProgress(b, w.now);
    // A building still going up is drawn faint: it is a plan, not a building.
    // One being upgraded is solid, because it is working the whole time.
    drawBuilding(d, job ? { ...b, ...job } : b, false, job?.scaffold ? 0.5 : undefined);
    ctx.restore();

    if (b.id === w.selectedId) {
      const s = TYPES[b.type].s;
      isoDiamond(d, b.gx, b.gy, s, s, 'rgba(232,178,60,.2)', 0, C.gold);
    }
  }

  if (place) {
    drawBuilding(d, { type: place.type, gx: place.gx, gy: place.gy, level: 1 }, false, 0.55);
  }

  for (const b of w.player?.buildings ?? []) {
    // No pouch over a scaffold: it is not producing anything yet.
    const goingUp = b.completesAt !== null && b.upgradingTo === null;
    if (PROD[b.type] && b.stock >= 1 && !goingUp) drawCollectBubble(w, d, b);
  }
  drawPopups(w, d);
}

function renderPreview(w: World, ctx: CanvasRenderingContext2D, d: Draw): void {
  const snapshot = w.preview!;
  const ents: BattleEntity[] = [];
  if (w.quality === 'high') {
    w.terrain.deco.forEach((deco, i) => {
      if (onScreen(w.cam, w.vp, deco.gx, deco.gy)) ents.push({ d: deco.gx + deco.gy, k: 'deco', i });
    });
  }
  snapshot.buildings.forEach((b, i) => {
    ents.push({ d: b.gx + b.gy + TYPES[b.type].s * 0.5, k: 'struct', i });
  });
  ents.sort((a, b) => a.d - b.d);

  for (const e of ents) {
    if (e.k === 'deco') drawDeco(d, w.terrain.deco[e.i]!);
    else if (e.k === 'struct') {
      const b = snapshot.buildings[e.i]!;
      drawBuilding(d, { type: b.type, gx: b.gx, gy: b.gy, level: b.level }, true);
    }
  }
}

function renderBattle(w: World, ctx: CanvasRenderingContext2D): void {
  const d = draw(w, ctx);
  const battle = w.battle!;
  drawTerrain(d, w.terrain);

  const ents: BattleEntity[] = [];
  if (w.quality === 'high') {
    w.terrain.deco.forEach((deco, i) => {
      if (onScreen(w.cam, w.vp, deco.gx, deco.gy)) ents.push({ d: deco.gx + deco.gy, k: 'deco', i });
    });
  }
  battle.structs.forEach((s, i) => {
    if (!s.dead) ents.push({ d: s.gx + s.gy + s.size * 0.5, k: 'struct', i });
  });
  battle.units.forEach((u, i) => {
    if (!u.dead) ents.push({ d: u.x + u.y, k: 'unit', i });
  });
  ents.sort((a, b) => a.d - b.d);

  for (const e of ents) {
    if (e.k === 'deco') {
      drawDeco(d, w.terrain.deco[e.i]!);
    } else if (e.k === 'unit') {
      const u = battle.units[e.i]!;
      drawUnit(d, {
        type: u.t,
        x: u.x,
        y: u.y,
        mine: battle.kind === 'raid' ? u.side === 'atk' : u.side === 'def',
        hp: u.hp,
        maxHp: u.maxHp,
        moving: u.moving,
        face: u.face,
        swing: w.unitSwing.get(e.i) ?? 0,
        flash: w.unitFlash.get(e.i) ?? 0,
        born: w.unitBorn.get(e.i) ?? 0,
      });
    } else {
      const s = battle.structs[e.i]!;
      drawBuilding(d, {
        type: s.t, gx: s.gx, gy: s.gy, level: s.lv,
        aim: w.fx.aim.get(e.i),
        recoil: w.fx.recoil.get(e.i),
      }, battle.kind === 'raid');

      if (w.fx.flash.has(e.i)) {
        isoDiamond(d, s.gx, s.gy, s.size, s.size, 'rgba(255,255,255,.28)');
      }
      if (s.hp < s.maxHp) {
        const [cx, cy] = w2s(w.cam, w.vp, isoX(s.cx, s.cy), isoY(s.cx, s.cy));
        drawHpBar(d, cx, cy - (52 + s.size * 20) * w.cam.z, 30 * w.cam.z, s.hp / s.maxHp);
      }
    }
  }

  for (const p of battle.projs) {
    drawProjectile(d, { x: p.x, y: p.y, kind: p.kind });
  }
}

/** How far along this building's job is, or null when no builder is on it. */
function builderProgress(
  b: ClientBuilding,
  now: number,
): { progress: number; scaffold: boolean } | null {
  if (!b.completesAt) return null;
  const ends = new Date(b.completesAt).getTime();
  const total = b.jobSeconds && b.jobSeconds > 0 ? b.jobSeconds * 1000 : null;
  const remaining = Math.max(0, ends - now);
  // Without a known duration the best honest guess is a bar that fills as the
  // remaining time shrinks against the largest job in the game.
  const span = total ?? Math.max(remaining, 1);
  return {
    progress: total ? 1 - remaining / span : 1 - remaining / Math.max(span, 1),
    scaffold: b.upgradingTo === null,
  };
}

function drawCollectBubble(w: World, d: Draw, b: ClientBuilding): void {
  const { ctx, cam, vp } = d;
  const z = cam.z;
  const s = TYPES[b.type].s;
  const [bx, by] = w2s(cam, vp, isoX(b.gx + s / 2, b.gy + s / 2), isoY(b.gx + s / 2, b.gy + s / 2));
  // A slow bob keyed off the id, so a row of mines does not pulse in unison.
  const phase = b.id.charCodeAt(b.id.length - 1) % 10;
  const cy = by - (86 + Math.sin(w.t * 2.6 + phase) * 3) * z;

  ctx.fillStyle = 'rgba(20,28,40,.9)';
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = Math.max(1.4, 2.2 * z);
  ctx.beginPath();
  ctx.ellipse(bx, cy, 15 * z, 15 * z, 0, 0, 6.29);
  ctx.fill();
  ctx.stroke();

  if (b.type === 'mine') {
    ctx.fillStyle = C.gold;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1, 1.6 * z);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(bx - 5 * z + i * 5 * z, cy + 3 * z - i * 2.5 * z, 4 * z, 2.8 * z, 0, 0, 6.29);
      ctx.fill();
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#c3d2e0';
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1, 1.6 * z);
    ctx.beginPath();
    ctx.moveTo(bx - 7 * z, cy + 4 * z);
    ctx.lineTo(bx - 4 * z, cy - 4 * z);
    ctx.lineTo(bx + 4 * z, cy - 4 * z);
    ctx.lineTo(bx + 7 * z, cy + 4 * z);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(bx - 5 * z, cy + 13 * z);
  ctx.lineTo(bx, cy + 21 * z);
  ctx.lineTo(bx + 5 * z, cy + 13 * z);
  ctx.fillStyle = 'rgba(20,28,40,.9)';
  ctx.fill();
}

function drawPopups(w: World, d: Draw): void {
  const { ctx, cam, vp } = d;
  for (const p of w.popups) {
    const [px, py] = w2s(cam, vp, isoX(p.x, p.y), isoY(p.x, p.y));
    ctx.globalAlpha = Math.max(0, Math.min(1, 1 - p.t / 1.3));
    ctx.fillStyle = p.color;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 3.2;
    ctx.font = `900 ${(16 * cam.z).toFixed(0)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = py - 60 * cam.z - p.t * 34;
    ctx.strokeText(p.text, px, y);
    ctx.fillText(p.text, px, y);
    ctx.globalAlpha = 1;
  }
}

export { roundRect };
