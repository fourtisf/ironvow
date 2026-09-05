import {
  MAX_DPR,
  N,
  PROD,
  TICKS_PER_SECOND,
  TICK_SECONDS,
  TYPES,
  clamp,
  type BuildingType,
  type TroopType,
} from '@ironvow/config';
import { createBattle, type Battle } from '@ironvow/sim';
import { type Camera, centerOn, clampCam, frameBase, newCamera, type Viewport } from '../render/camera';
import { generateTerrain, type Terrain } from '../render/terrain';
import type { BaseSnapshot, BattleKind, DeployableType, DeployCommand } from '@ironvow/types';
import type { FloatingText, Mode, Placement, PlayerState, ScoutedRaid } from './types';

/**
 * The mutable world.
 *
 * All of it lives behind a single ref and is driven by requestAnimationFrame.
 * None of it is React state: a base with three hundred ramparts would otherwise
 * re-render the tree sixty times a second, and the renderer would be fighting
 * the reconciler for the frame budget. React owns the HUD and the sheets; this
 * owns the field.
 */

export interface WorldEvents {
  /** A building was tapped, or the selection cleared. */
  onSelect: (buildingId: string | null) => void;
  onModeChange: (mode: Mode) => void;
  onToast: (message: string) => void;
  /** The player's own state changed locally and the HUD should re-read it. */
  onPlayerChanged: () => void;
  /** A battle reached an end condition. */
  onBattleEnd: (commands: DeployCommand[]) => void;
}

export interface World {
  cam: Camera;
  vp: Viewport;
  terrain: Terrain;
  /** Animation clock in seconds. */
  t: number;
  /** Wall-clock milliseconds, refreshed each frame for the builder bars. */
  now: number;
  /**
   * Graphics quality (spec S8.8).
   *
   * On low, the treeline is not drawn. It is four hundred swaying sprites
   * outside the play area, which is the largest block of work in a frame that
   * changes nothing about the game.
   */
  quality: 'high' | 'low';

  mode: Mode;
  player: PlayerState | null;
  selectedId: string | null;
  placement: Placement | null;
  popups: FloatingText[];

  /* --- battle --- */
  battle: Battle | null;
  raid: ScoutedRaid | null;
  /**
   * A defender's frozen base, drawn instead of the player's own while scouting.
   *
   * Spec S8.1: the player used to march blind at a loot figure. Showing the
   * real layout before committing is the single most-exercised decision in the
   * genre, and a summary in a modal is not the same thing as being able to look
   * at where the cannons are.
   */
  preview: BaseSnapshot | null;
  battleCommands: DeployCommand[];
  /** What the tray has selected for the next deploy. */
  selectedTroop: DeployableType | null;
  /** Leftover time not yet consumed by a fixed step. */
  tickAccumulator: number;
  /** Cosmetic per-structure state the simulation does not carry. */
  fx: { aim: Map<number, number>; recoil: Map<number, number>; flash: Map<number, number> };
  unitFlash: Map<number, number>;
  unitSwing: Map<number, number>;
  unitBorn: Map<number, number>;

  events: WorldEvents;
}

export function createWorld(events: WorldEvents): World {
  return {
    cam: newCamera(),
    vp: { w: 1, h: 1, dpr: 1 },
    terrain: generateTerrain(),
    t: 0,
    now: Date.now(),
    quality: 'high',
    mode: 'base',
    player: null,
    selectedId: null,
    placement: null,
    popups: [],
    battle: null,
    raid: null,
    preview: null,
    battleCommands: [],
    selectedTroop: null,
    tickAccumulator: 0,
    fx: { aim: new Map(), recoil: new Map(), flash: new Map() },
    unitFlash: new Map(),
    unitSwing: new Map(),
    unitBorn: new Map(),
    events,
  };
}

export function resizeWorld(w: World, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  // Capping device pixel ratio at 2 is the single biggest frame-rate lever on
  // high-density Android, where uncapped DPR quadruples the fill cost for a
  // difference nobody can see.
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const width = window.innerWidth;
  const height = window.innerHeight;
  w.vp = { w: width, h: height, dpr };
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clampCam(w.cam);
}

export function setMode(w: World, mode: Mode): void {
  if (w.mode === mode) return;
  w.mode = mode;
  w.events.onModeChange(mode);
}

/** Frame the player's own hold. */
export function centerOnKeep(w: World): void {
  const own = w.player?.buildings ?? [];
  if (own.length > 0) {
    frameBase(w.cam, w.vp, own.map((b) => ({ gx: b.gx, gy: b.gy, size: TYPES[b.type].s })));
    return;
  }
  centerOn(w.cam, N / 2, N / 2, 0.95);
}

/** Show a defender's base, framed, without starting the fight. */
export function showPreview(w: World, snapshot: BaseSnapshot): void {
  w.preview = snapshot;
  w.selectedId = null;
  w.placement = null;
  frameBase(w.cam, w.vp, snapshot.buildings.map((b) => ({ gx: b.gx, gy: b.gy, size: TYPES[b.type].s })));
}

export function clearPreview(w: World): void {
  w.preview = null;
  centerOnKeep(w);
}

/* ------------------------------------------------------------------ *
 * Local prediction
 *
 * The server owns every number. These functions only make the base feel
 * responsive between requests; each one is overwritten by the server's
 * answer as soon as it arrives.
 * ------------------------------------------------------------------ */

/** Advance the collect bubbles locally so a mine does not look frozen. */
export function predictProduction(w: World, dt: number): void {
  const player = w.player;
  if (!player) return;
  for (const b of player.buildings) {
    const rate = PROD[b.type];
    if (!rate) continue;
    // A building still going up earns nothing on the server, so predicting for
    // it would float a pouch over a scaffold and promise gold that is not
    // coming.
    if (b.completesAt !== null && b.upgradingTo === null) continue;
    const cap = rate(b.level) * 12;
    b.stock = Math.min(cap, b.stock + (rate(b.level) * dt) / 60);
  }
}

export function popup(w: World, gx: number, gy: number, text: string, color: string): void {
  w.popups.push({ x: gx, y: gy, text, color, t: 0 });
}

export function bump(w: World, buildingId: string): void {
  const b = w.player?.buildings.find((x) => x.id === buildingId);
  if (b) b.bump = 1;
}

/* --------------------------------------------------------------- battle --- */

export function beginBattle(w: World, raid: ScoutedRaid, kind: BattleKind = 'raid'): void {
  w.raid = raid;
  w.battleCommands = [];
  w.battle = createBattle(
    {
      snapshot: raid.snapshot,
      commands: [],
      army: raid.army,
      seed: raid.seed,
      kind,
      // The loadout the server froze when the raid opened, not whatever the
      // player has upgraded to since.
      hero: raid.hero,
      troopLevels: raid.troopLevels,
    },
    { timeline: false },
  );
  w.tickAccumulator = 0;
  w.fx = { aim: new Map(), recoil: new Map(), flash: new Map() };
  w.unitFlash = new Map();
  w.unitSwing = new Map();
  w.unitBorn = new Map();
  w.selectedTroop = firstAvailableTroop(w);
  w.selectedId = null;
  w.placement = null;
  w.preview = null;
  frameBase(w.cam, w.vp, raid.snapshot.buildings.map((b) => ({ gx: b.gx, gy: b.gy, size: TYPES[b.type].s })));
  setMode(w, 'battle');
}

export function firstAvailableTroop(w: World): DeployableType | null {
  const battle = w.battle;
  if (!battle) return null;
  for (const t of ['raider', 'archer', 'lancer', 'ram'] as const) {
    if ((battle.avail[t] ?? 0) > 0) return t;
  }
  // The hero is the last thing offered, not the first: picking it by default
  // would get it committed by accident on the opening tap.
  return battle.heroReady() ? 'hero' : null;
}

/**
 * Advance the battle by real time, in whole fixed steps.
 *
 * The leftover is carried, never rounded away: the simulation must see exactly
 * the same number of 1/30s ticks the server will replay, whatever the frame
 * rate happened to be. A slow phone renders fewer frames, not a different
 * battle.
 */
export function stepBattle(w: World, dt: number): void {
  const battle = w.battle;
  if (!battle || battle.ended) return;

  w.tickAccumulator += dt;
  // Cap the catch-up so a backgrounded tab does not run the whole raid in one
  // frame when it wakes.
  const maxSteps = Math.ceil(TICKS_PER_SECOND * 0.5);
  let steps = 0;

  while (w.tickAccumulator >= TICK_SECONDS && steps < maxSteps) {
    w.tickAccumulator -= TICK_SECONDS;
    steps++;
    const before = snapshotHp(battle);
    const ended = battle.step();
    markDamage(w, battle, before);
    if (ended) {
      w.events.onBattleEnd(w.battleCommands);
      return;
    }
  }
}

function snapshotHp(battle: Battle): number[] {
  return battle.structs.map((s) => s.hp);
}

/**
 * Flash whatever took damage this tick.
 *
 * Prototype bug #4: the flash decay lived inside the loop that only visited
 * defensive structures, so a damaged mine stayed washed out for the rest of the
 * battle. Every entity's per-frame state is now decayed in one place —
 * `decayFx` below — and nowhere else.
 */
function markDamage(w: World, battle: Battle, before: number[]): void {
  battle.structs.forEach((s, i) => {
    if (s.hp < (before[i] ?? s.hp)) w.fx.flash.set(i, 0.12);
  });
}

/** One place, every entity. */
export function decayFx(w: World, dt: number): void {
  for (const map of [w.fx.flash, w.fx.recoil, w.unitFlash, w.unitSwing]) {
    for (const [k, v] of map) {
      const next = v - dt * (map === w.unitSwing ? 4 : map === w.fx.recoil ? 4 : 1);
      if (next <= 0) map.delete(k);
      else map.set(k, next);
    }
  }
  for (let i = w.popups.length - 1; i >= 0; i--) {
    const p = w.popups[i]!;
    p.t += dt;
    if (p.t > 1.3) w.popups.splice(i, 1);
  }
  const player = w.player;
  if (player) {
    for (const b of player.buildings) {
      if (b.bump) b.bump = Math.max(0, b.bump - dt * 3);
    }
  }
}

/** Deploy at a grid position, recording the command for submission. */
export function deployAt(w: World, gx: number, gy: number): void {
  const battle = w.battle;
  if (!battle || battle.ended) return;
  const type = w.selectedTroop;
  if (!type) {
    w.events.onToast('Pick a troop first');
    return;
  }
  const out = battle.deploy(type, gx, gy);
  if (!out.ok) {
    w.events.onToast(
      out.reason === 'tooCloseToStructure' ? 'Too close to their buildings'
        : out.reason === 'outOfBounds' ? 'Too far out'
        : 'No troops of that kind left',
    );
    return;
  }
  w.battleCommands.push(out.command);
  w.unitBorn.set(battle.units.length - 1, w.t);
  if (type === 'hero' || (battle.avail[type] ?? 0) <= 0) w.selectedTroop = firstAvailableTroop(w);
  w.events.onPlayerChanged();
}

/* ------------------------------------------------------------ placement --- */

/** Local mirror of the server's `cellsFree`, for the red-or-green footprint. */
export function localCellsFree(
  w: World, type: BuildingType, gx: number, gy: number, ignoreId?: string | null,
): boolean {
  const s = TYPES[type].s;
  if (gx < 2 || gy < 2 || gx + s > N - 2 || gy + s > N - 2) return false;
  for (const b of w.player?.buildings ?? []) {
    if (ignoreId && b.id === ignoreId) continue;
    const bs = TYPES[b.type].s;
    if (gx < b.gx + bs && gx + s > b.gx && gy < b.gy + bs && gy + s > b.gy) return false;
  }
  return true;
}

export function movePlacementTo(w: World, gx: number, gy: number): void {
  const p = w.placement;
  if (!p) return;
  const s = TYPES[p.type].s;
  p.gx = clamp(Math.round(gx - s / 2), 2, N - 2 - s);
  p.gy = clamp(Math.round(gy - s / 2), 2, N - 2 - s);
  p.ok = localCellsFree(w, p.type, p.gx, p.gy, p.movingId);
}

/**
 * Start placing a new building, or pick an existing one up.
 *
 * Prototype bug #2: relocation lifted the building off the map and then
 * re-rendered the action bar, which reset its handlers back to "build new" and
 * lost the building for good. Here a move never removes anything — the building
 * stays exactly where it is until the server confirms the new position, and
 * `movingId` is the only thing that distinguishes the two cases.
 */
export function startPlacement(w: World, type: BuildingType, movingId: string | null): void {
  const existing = movingId ? w.player?.buildings.find((b) => b.id === movingId) : undefined;
  const keep = w.player?.buildings.find((b) => b.type === 'keep');
  const gx = existing?.gx ?? (keep ? keep.gx : 26);
  const gy = existing?.gy ?? (keep ? keep.gy + 4 : 30);

  w.placement = {
    type,
    gx,
    gy,
    ok: localCellsFree(w, type, gx, gy, movingId),
    movingId,
    fromX: gx,
    fromY: gy,
  };
  w.selectedId = null;
  setMode(w, 'place');
}

export function cancelPlacement(w: World): void {
  w.placement = null;
  setMode(w, 'base');
}

export function buildingAt(w: World, gx: number, gy: number) {
  for (const b of w.player?.buildings ?? []) {
    const s = TYPES[b.type].s;
    if (gx >= b.gx && gx < b.gx + s && gy >= b.gy && gy < b.gy + s) return b;
  }
  return null;
}
