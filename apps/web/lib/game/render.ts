import { PROD, TYPES, type BuildingType } from '@ironvow/config';
import { isoX, isoY, onScreen, structOnScreen, w2s } from '../render/camera';
import type { Draw } from '../render/primitives';
import { ANIMATED, drawBuilderMark, drawBuilding, drawBuildingFx } from '../render/buildings';
import { blitBuilding, blitDeco } from '../render/sprites';
import { C, PIPH } from '../render/palette';
import { drawHpBar, isoDiamond, roundRect } from '../render/primitives';
import { drawAtmosphere } from '../render/atmosphere';
import { drawTerrain } from '../render/terrain';
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
  {
    w.terrain.deco.forEach((deco, i) => {
      if (onScreen(w.cam, w.vp, deco.gx, deco.gy)) ents.push({ d: deco.gx + deco.gy, k: 'deco', i });
    });
  }
  const walls = new Set<number>();
  for (const b of w.player?.buildings ?? []) {
    // Every Rampart, not only the visible ones: a run that leaves the screen
    // must not grow an end cap at the edge of the viewport.
    if (b.type === 'wall') walls.add(wallKey(b.gx, b.gy));
    // Culled here rather than inside the draw call, so an off-screen structure
    // costs neither a sprite lookup nor a slot in the depth sort.
    if (!structOnScreen(w.cam, w.vp, b.gx, b.gy, TYPES[b.type].s)) continue;
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
      blitDeco(d, w.terrain.deco[e.i]!);
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
    const ghost = job?.scaffold ? 0.5 : undefined;
    if (ghost !== undefined) ctx.globalAlpha = ghost;
    drawStruct(w, d, b.type, b.level, false, b.gx, b.gy,
      undefined, undefined, linkOf(walls, b.gx, b.gy));
    ctx.restore();

    if (job) drawBuilderMark(d, { ...b, ...job }, TYPES[b.type].s);

    if (b.id === w.selectedId) {
      const s = TYPES[b.type].s;
      isoDiamond(d, b.gx, b.gy, s, s, 'rgba(232,178,60,.2)', 0, C.gold);
    }
    if (b.id === w.coachTargetId) drawCoachMarker(d, b.gx, b.gy, TYPES[b.type].s, b.type);
  }

  if (place) {
    drawBuilding(d, { type: place.type, gx: place.gx, gy: place.gy, level: 1 }, false, 0.55);
  }

  for (const b of w.player?.buildings ?? []) {
    // No pouch over a scaffold: it is not producing anything yet.
    const goingUp = b.completesAt !== null && b.upgradingTo === null;
    if (!PROD[b.type] || b.stock < 1 || goingUp) continue;
    if (!structOnScreen(w.cam, w.vp, b.gx, b.gy, TYPES[b.type].s)) continue;
    drawCollectBubble(w, d, b);
  }
  drawAtmosphere(d);
  drawPopups(w, d);
}

/*
 * Which Ramparts touch which.
 *
 * A Rampart is its own one-tile building, so nothing in the data says a run of
 * twenty is a wall — the art has to work it out. Rebuilt each frame rather
 * than cached on the world, because a wall breached mid-raid has to stop
 * joining onto its neighbour the moment it falls, and a cache keyed on
 * anything cheaper than "the walls standing right now" would be wrong exactly
 * when a player is watching.
 *
 * A few hundred set operations a frame; the sort above it costs more.
 */
const wallKey = (gx: number, gy: number): number => (gy + 256) * 1024 + (gx + 256);

function linkOf(walls: Set<number>, gx: number, gy: number): number {
  if (walls.size === 0) return 0;
  return (walls.has(wallKey(gx + 1, gy)) ? 1 : 0)
    | (walls.has(wallKey(gx, gy + 1)) ? 2 : 0)
    | (walls.has(wallKey(gx - 1, gy)) ? 4 : 0)
    | (walls.has(wallKey(gx, gy - 1)) ? 8 : 0);
}

function renderPreview(w: World, ctx: CanvasRenderingContext2D, d: Draw): void {
  const snapshot = w.preview!;
  const ents: BattleEntity[] = [];
  {
    w.terrain.deco.forEach((deco, i) => {
      if (onScreen(w.cam, w.vp, deco.gx, deco.gy)) ents.push({ d: deco.gx + deco.gy, k: 'deco', i });
    });
  }
  const walls = new Set<number>();
  snapshot.buildings.forEach((b, i) => {
    if (b.type === 'wall') walls.add(wallKey(b.gx, b.gy));
    if (!structOnScreen(w.cam, w.vp, b.gx, b.gy, TYPES[b.type].s)) return;
    ents.push({ d: b.gx + b.gy + TYPES[b.type].s * 0.5, k: 'struct', i });
  });
  ents.sort((a, b) => a.d - b.d);

  for (const e of ents) {
    if (e.k === 'deco') blitDeco(d, w.terrain.deco[e.i]!);
    else if (e.k === 'struct') {
      const b = snapshot.buildings[e.i]!;
      drawStruct(w, d, b.type, b.level, true, b.gx, b.gy,
        undefined, undefined, linkOf(walls, b.gx, b.gy));
    }
  }
  drawAtmosphere(d);
}

function renderBattle(w: World, ctx: CanvasRenderingContext2D): void {
  const d = draw(w, ctx);
  const battle = w.battle!;
  drawTerrain(d, w.terrain);

  const ents: BattleEntity[] = [];
  {
    w.terrain.deco.forEach((deco, i) => {
      if (onScreen(w.cam, w.vp, deco.gx, deco.gy)) ents.push({ d: deco.gx + deco.gy, k: 'deco', i });
    });
  }
  const walls = new Set<number>();
  battle.structs.forEach((s, i) => {
    // A breached Rampart stops joining its neighbours the frame it falls,
    // which is how a hole in a wall reads as a hole.
    if (!s.dead && s.t === 'wall') walls.add(wallKey(s.gx, s.gy));
    if (s.dead || !structOnScreen(w.cam, w.vp, s.gx, s.gy, s.size)) return;
    ents.push({ d: s.gx + s.gy + s.size * 0.5, k: 'struct', i });
  });
  battle.units.forEach((u, i) => {
    if (!u.dead) ents.push({ d: u.x + u.y, k: 'unit', i });
  });
  ents.sort((a, b) => a.d - b.d);

  for (const e of ents) {
    if (e.k === 'deco') {
      blitDeco(d, w.terrain.deco[e.i]!);
    } else if (e.k === 'unit') {
      const u = battle.units[e.i]!;
      /*
       * The level the raid was frozen with, not what the player has upgraded
       * to since. The simulation used exactly this number to work out the
       * unit's hit points and damage, so the kit a player sees on the field
       * is the kit that is actually fighting.
       */
      const level = u.t === 'hero'
        ? w.raid?.hero?.level ?? 1
        : w.raid?.troopLevels?.[u.t] ?? 1;
      drawUnit(d, {
        type: u.t,
        level,
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
      drawStruct(w, d, s.t, s.lv, battle.kind === 'raid', s.gx, s.gy,
        w.fx.aim.get(e.i), w.fx.recoil.get(e.i), linkOf(walls, s.gx, s.gy));

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
  drawAtmosphere(d);
}

/**
 * One structure: cached body, then whatever moves.
 *
 * The body is a blit of a canvas rasterised once per (type, level, livery,
 * zoom); only banners, smoke and a cannon's barrel are still real path work.
 */
function drawStruct(
  w: World, d: Draw, type: BuildingType, level: number, enemy: boolean,
  gx: number, gy: number, aim?: number, recoil?: number, link = 0,
): void {
  const [ax, ay] = w2s(w.cam, w.vp, isoX(gx, gy), isoY(gx, gy));
  blitBuilding(d, type, level, enemy, ax, ay, link);
  if (ANIMATED.has(type)) {
    drawBuildingFx(d, { type, gx, gy, level, aim, recoil }, enemy);
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

/**
 * The guide's pointer: a pulsing ring on the footprint and a gold chevron
 * bobbing above the roof, so "the Gold Mine" on the card is unmistakably
 * that one on the field.
 */
function drawCoachMarker(d: Draw, gx: number, gy: number, size: number, type: BuildingType): void {
  const { ctx, cam, vp, t } = d;
  const z = cam.z;
  const pulse = 0.5 + 0.5 * Math.sin(t * 4);
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.4 * pulse;
  isoDiamond(d, gx - 0.15, gy - 0.15, size + 0.3, size + 0.3, 'rgba(0,0,0,0)', 0, C.gold);
  ctx.restore();

  const [cx, cy] = w2s(cam, vp, isoX(gx + size / 2, gy + size / 2), isoY(gx + size / 2, gy + size / 2));
  const top = cy - ((PIPH[type] ?? 90) + 34) * z - Math.abs(Math.sin(t * 3)) * 10 * z;
  const s = 11 * z;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.6, 2.4 * z);
  ctx.strokeStyle = C.line;
  ctx.fillStyle = C.gold;
  ctx.beginPath();
  ctx.moveTo(cx, top + s);
  ctx.lineTo(cx - s, top - s * 0.4);
  ctx.lineTo(cx - s * 0.45, top - s * 0.4);
  ctx.lineTo(cx - s * 0.45, top - s * 1.6);
  ctx.lineTo(cx + s * 0.45, top - s * 1.6);
  ctx.lineTo(cx + s * 0.45, top - s * 0.4);
  ctx.lineTo(cx + s, top - s * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
