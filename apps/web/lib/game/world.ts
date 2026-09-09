import {
  ITEM,
  type ItemType,
  type TrapType,
  MAX_DPR,
  N,
  PROD,
  TH,
  TICKS_PER_SECOND,
  TICK_SECONDS,
  TW,
  TYPES,
  ZOOM_MAX,
  ZOOM_MIN,
  clamp,
  type BuildingType,
  type TroopType,
} from '@ironvow/config';
import { createBattle, type Battle } from '@ironvow/sim';
import type { BattleSpeed } from './eta';
import { SKY_FADE, type Phase } from './daylight';
import { sfx } from '../sfx';
import { PIPH } from '../render/palette';
import { type Camera, centerOn, clampCam, s2g, frameBase, newCamera, type Viewport } from '../render/camera';
import { generateTerrain, type Terrain } from '../render/terrain';
import { boatAt } from '../render/boat';
import type { Livery } from '../render/livery';
import type { BaseSnapshot, BattleKind, DeployableType, DeployCommand, ItemCommand } from '@ironvow/types';
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
  onBattleEnd: (commands: DeployCommand[], items: ItemCommand[]) => void;
  /** The boat on the water was tapped: cross to the other base. */
  onBoard: () => void;
  /**
   * The ghost moved or its footprint changed colour. The placement bar is
   * React, the ghost is not, and without this the bar kept saying Blocked —
   * with DONE greyed out — over a ghost that had long since turned green.
   */
  onPlacementChanged: () => void;
  /**
   * The player tapped a spot the ghost can stand on.
   *
   * Placing used to take two taps a long way apart — one on the ground at the
   * top of the screen, one on a bar pinned to the bottom — and the second one
   * is not a decision anybody was making. A tap is the whole gesture now, and
   * the bar stays for CANCEL and for anyone who reaches for it.
   */
  onPlacementCommit: () => void;
  /** The player panned or zoomed. The tutorial's second step listens. */
  onCameraMoved: () => void;
}

export interface World {
  cam: Camera;
  vp: Viewport;
  terrain: Terrain;
  /** Animation clock in seconds. */
  t: number;
  /** Wall-clock milliseconds, refreshed each frame for the builder bars. */
  now: number;
  /** Set by the canvas so a resize can re-size the backing store. */
  resize: (() => void) | null;
  /**
   * War Lab levels, so the warband mustered in the yard wears the kit it
   * actually fights in. Pushed down when `/progression` answers; a hold
   * without a Lab is every troop at level 1, which is the default.
   */
  progressionLevels: Partial<Record<TroopType, number>>;
  /**
   * Whether every defence is painting what it covers.
   *
   * Lives on the world rather than in React state because the renderer reads
   * it sixty times a second and nothing else does; a re-render per frame to
   * carry one boolean would be the tail wagging the dog.
   */
  showRanges: boolean;
  /**
   * Whether a previewed base is drawn in enemy livery.
   *
   * True everywhere it matters — scouting shows the hold you are about to hit.
   * The door is the exception: the hold behind the sign-in card is the one
   * somebody is being invited to build, not one to attack, so it wears the
   * player's own blue and gold.
   */
  previewEnemy: boolean;
  /**
   * Level badges over the roofs. Always on in the game; off only where the
   * renderer is being used to take a photograph of it.
   */
  levelPips: boolean;
  /**
   * How fast a raid is watched. See `SPEEDS` — the simulation still runs every
   * tick, in order; this only decides how many of them a second of real time
   * is worth, so the commands the server replays are unchanged by it.
   */
  battleSpeed: BattleSpeed;

  mode: Mode;
  player: PlayerState | null;
  selectedId: string | null;
  /** A building the guide is pointing at, drawn with a marker over it. */
  coachTargetId: string | null;
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
  /** Items used this raid, in tick order. Sent alongside the deploys. */
  battleItems: ItemCommand[];
  /**
   * A recording, not a fight: taps deploy nothing.
   *
   * Without this a replay is only a replay until somebody touches the screen.
   * The recorded commands are pushed in by the caller, and a tap would add a
   * troop that was never there — so what is watched stops being what happened,
   * with nothing to say it changed. It matters most on the public watch page,
   * where the viewer has no stake in the fight being true.
   */
  watching: boolean;
  /**
   * The hour on the field. Cosmetic, and only ever read by the renderer — the
   * simulation resolves a midnight raid exactly as it resolves a midday one,
   * and two people watching the same shared replay in different time zones
   * watch the same fight under different skies.
   */
  /**
   * Where the boat sits, or null on a field with no water in view.
   *
   * Computed once from the terrain rather than every frame: the lakes never
   * move, and a boat whose position is recomputed against a changing camera is
   * a boat nobody can tap twice.
   */
  boat: { gx: number; gy: number } | null;
  /**
   * Which stone the structures are cut from, when nothing else can say.
   *
   * Normally the player's own world decides it. A shared replay has no player
   * — that is the point of it — so the page watching one sets this from the
   * replay instead, or a night raid would be watched in daylight art.
   */
  livery: Livery | null;
  phase: Phase;
  /** The phase being left behind, and how far out of it: 1 means arrived. */
  skyFrom: Phase;
  skyMix: number;
  /**
   * Where items landed, for the renderer.
   *
   * Kept on the world rather than read back off the battle, because a Firepot
   * has no lasting state in the simulation at all — it burns once and is gone —
   * and the flash the player needs to see it happen outlives the tick it
   * happened on.
   */
  bursts: { x: number; y: number; r: number; item: ItemType | TrapType; born: number }[];
  /** How many timeline events have been heard. */
  heard: number;
  /** What the tray has selected for the next deploy. */
  selectedTroop: DeployableType | null;
  /**
   * The item armed for the next tap, or null.
   *
   * Mutually exclusive with `selectedTroop` at the point of use rather than in
   * state: arming an item is a deliberate act and the next tap spends it, then
   * it disarms itself. A mode you can forget you are in is a mode that throws
   * a Firepot at nothing.
   */
  selectedItem: ItemType | null;
  /** Leftover time not yet consumed by a fixed step. */
  tickAccumulator: number;
  /** Cosmetic per-structure state the simulation does not carry. */
  fx: { aim: Map<number, number>; recoil: Map<number, number>; flash: Map<number, number> };
  unitFlash: Map<number, number>;
  unitBorn: Map<number, number>;

  events: WorldEvents;
}

export function createWorld(events: WorldEvents): World {
  // Generated before the world literal so the boat can be put on the water it
  // actually made, rather than at a guessed coordinate that a different seed
  // would leave sitting on dry land.
  const terrain = generateTerrain();
  return {
    cam: newCamera(),
    vp: { w: 1, h: 1, dpr: 1 },
    terrain,
    t: 0,
    now: Date.now(),
    resize: null,
    progressionLevels: {},
    showRanges: false,
    previewEnemy: true,
    levelPips: true,
    battleSpeed: 1,
    mode: 'base',
    player: null,
    selectedId: null,
    coachTargetId: null,
    placement: null,
    popups: [],
    battle: null,
    raid: null,
    preview: null,
    battleCommands: [],
    watching: false,
    boat: boatAt(terrain.lakes),
    livery: null,
    phase: 'day',
    skyFrom: 'day',
    skyMix: 1,
    battleItems: [],
    bursts: [],
    heard: 0,
    selectedTroop: null,
    selectedItem: null,
    tickAccumulator: 0,
    fx: { aim: new Map(), recoil: new Map(), flash: new Map() },
    unitFlash: new Map(),
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
  clampCam(w.cam, dpr);
}

export function setMode(w: World, mode: Mode): void {
  if (w.mode === mode) return;
  w.mode = mode;
  w.events.onModeChange(mode);
}

/**
 * The closest the opening frame will push in.
 *
 * A cap and not a target: `frameBase` fits what is actually there, and this
 * only stops a hold with three buildings in it from filling a desktop window
 * with one Town Hall.
 */
export const HOME_ZOOM_MAX = 1;

/**
 * Open on the base, centred on it.
 *
 * ALFA, looking at the game on a monitor: "perbaiki tampilanya". It opened on
 * the whole 56-tile plateau — which is the right frame for a hold that fills
 * it, and the wrong one for every hold before that. A new base is five
 * buildings in the middle of an empty field, and fitting the field to a 1920px
 * window put them on screen at about a fifth of the size they are on a phone:
 * a game seen through the wrong end of a telescope.
 *
 * So the frame is the buildings, not the ground they stand on. It grows with
 * the base — a maxed hold still opens on the whole plateau, because by then the
 * plateau is what the base covers — and `HOME_ZOOM_MAX` keeps a small one from
 * going too far the other way.
 */
export function centerOnKeep(w: World): void {
  const own = w.player?.buildings ?? [];
  if (own.length === 0) {
    centerOn(w.cam, N / 2, N / 2, HOME_ZOOM_MAX, w.vp.dpr);
    return;
  }
  frameBase(
    w.cam,
    w.vp,
    own.map((b) => ({ gx: b.gx, gy: b.gy, size: TYPES[b.type].s })),
    homeMargin(w.vp.w),
    HOME_ZOOM_MAX,
  );
}

/**
 * Air left round the base at the opening frame.
 *
 * A share of the width rather than a number of pixels. Fixed at the 110 a
 * desktop wants, it took 220 of a 420px phone — more than half the screen — and
 * the fit fell back to the zoom floor, which is the very thing this framing
 * exists to stop happening. The floor keeps a narrow phone from framing the
 * base flush to both edges; the cap keeps a monitor from leaving a field of
 * grass round it.
 *
 * The margin is for the next building: somewhere to drop it without panning
 * first.
 */
function homeMargin(width: number): number {
  return clamp(width * 0.1, 40, 110);
}

/** Show a defender's base, framed, without starting the fight. */
export function showPreview(w: World, snapshot: BaseSnapshot, enemy = true): void {
  w.preview = snapshot;
  w.previewEnemy = enemy;
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

/**
 * A fight that has already happened, to be watched rather than played.
 *
 * The commands have to reach `createBattle`, which buckets them by tick before
 * the first step. Handing them over afterwards — pushing them into
 * `battleCommands` — does nothing at all: that array is the outbox, the record
 * of what the player did, and the schedule is already built by the time
 * anything is added to it. A replay fed that way runs an empty fight, and looks
 * exactly like a base nobody attacked.
 */
export interface Recorded {
  commands: readonly DeployCommand[];
  items: readonly ItemCommand[];
}

export function beginBattle(
  w: World,
  raid: ScoutedRaid,
  kind: BattleKind = 'raid',
  recorded?: Recorded,
): void {
  w.raid = raid;
  // A recording is watched: taps deploy nothing, and nothing is submitted.
  w.watching = recorded !== undefined;
  w.battleCommands = [];
  w.battleItems = [];
  w.bursts = [];
  w.heard = 0;
  w.battle = createBattle(
    {
      snapshot: raid.snapshot,
      commands: recorded?.commands ?? [],
      items: recorded?.items ?? [],
      army: raid.army,
      seed: raid.seed,
      kind,
      // The loadout the server froze when the raid opened, not whatever the
      // player has upgraded to since.
      hero: raid.hero,
      troopLevels: raid.troopLevels,
      // The pouch the server froze when the raid opened, so the tray's counts
      // and the server's replay agree about what there was to spend.
      pouch: raid.pouch ?? {},
    },
    // Recorded so the client can hear the fight: the sounds below are
    // driven by the sim's own events rather than guessed from the renderer.
    { timeline: true },
  );
  w.tickAccumulator = 0;
  w.fx = { aim: new Map(), recoil: new Map(), flash: new Map() };
  w.unitFlash = new Map();
  w.unitBorn = new Map();
  w.selectedTroop = firstAvailableTroop(w);
  w.selectedItem = null;
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

  // Watching it at two, three or four times over is the player's call, and it
  // changes nothing the server sees: a deploy is recorded at the tick it
  // happened on, and the ticks are all still run, in order.
  w.tickAccumulator += dt * w.battleSpeed;

  /*
   * Catching up after the tab was hidden.
   *
   * ALFA: "dan kalo misal buka chrome lain otomatis berhnti nyerang mengapa"
   *
   * Because the raid ran on the frame clock, and there are no frames in a tab
   * nobody is looking at. `requestAnimationFrame` stops entirely when a window
   * goes to the background, and the delta on the way back was clamped to 50 ms
   * so nothing would teleport — so two minutes away advanced the battle by a
   * twentieth of a second. The troops did not pause politely: the raid timer in
   * the corner is the same clock, so the whole attack simply stopped.
   *
   * The battle takes real elapsed time now (see `GameCanvas`), and this is what
   * makes that safe: the backlog is paid off over several frames rather than in
   * one, at up to eight seconds of battle per frame. Two minutes away is caught
   * up inside a quarter of a second of wall time, which is a beat, not a hitch
   * — and every tick still happens, in order, so the commands the server
   * replays are the ones that were played.
   */
  const maxSteps = Math.ceil(TICKS_PER_SECOND * 8);
  let steps = 0;
  // Past a normal frame's worth we are replaying the past, and a wall of
  // sword-hits from two minutes ago is not information.
  const quiet = w.tickAccumulator > 1;

  while (w.tickAccumulator >= TICK_SECONDS && steps < maxSteps) {
    w.tickAccumulator -= TICK_SECONDS;
    steps++;
    const before = snapshotHp(battle);
    const ended = battle.step();
    markDamage(w, battle, before);
    if (quiet) w.heard = battle.events.length;
    else hear(w, battle);
    if (ended) {
      w.events.onBattleEnd(w.battleCommands, w.battleItems);
      return;
    }
  }
}

export interface Hp {
  structs: number[];
  units: number[];
}

export function snapshotHp(battle: Battle): Hp {
  return {
    structs: battle.structs.map((s) => s.hp),
    units: battle.units.map((u) => u.hp),
  };
}

/**
 * Play the events the last step produced.
 *
 * Each sound is throttled inside `sfx`, so a volley of twelve archers is one
 * whistle and a rank of cannons is not a wall of noise. Rampart hits are
 * near-silent on purpose: they happen every tick of a siege.
 */
function hear(w: World, battle: Battle): void {
  const events = battle.events;
  for (; w.heard < events.length; w.heard++) {
    const e = events[w.heard]!;
    switch (e.k) {
      case 'shot':
        if (e.kind === 'ball') sfx.cannon(); else sfx.arrow();
        break;
      case 'structDead': {
        const s = battle.structs[e.struct];
        if (s?.t === 'wall') sfx.wallBreak(); else sfx.collapse();
        break;
      }
      case 'hitStruct': {
        const s = battle.structs[e.struct];
        if (s && s.t !== 'wall' && e.dmg > 0) sfx.sword();
        break;
      }
      case 'unitDead':
        sfx.fall();
        break;
      /*
       * A trap going off.
       *
       * Driven from the simulation's own event rather than from the trap list,
       * because the flash has to land on the tick it fired on and the trap
       * itself carries only the tick number. It is also the moment the trap
       * stops being invisible to the attacker, which is the whole feature —
       * so it gets a sound of its own rather than borrowing a hit.
       */
      case 'trap':
        w.bursts.push({ x: e.x, y: e.y, r: e.r, item: e.item, born: w.t });
        if (e.item === 'spike') sfx.wallBreak(); else sfx.hit();
        break;
      case 'spawn':
        if (e.side === 'atk') {
          if (e.type === 'hero') sfx.hero(); else sfx.deploy();
        }
        break;
      default:
        break;
    }
  }
}

/**
 * Flash whatever took damage this tick.
 *
 * Prototype bug #4: the flash decay lived inside the loop that only visited
 * defensive structures, so a damaged mine stayed washed out for the rest of the
 * battle. Every entity's per-frame state is now decayed in one place —
 * `decayFx` below — and nowhere else.
 */
export function markDamage(w: World, battle: Battle, before: Hp): void {
  battle.structs.forEach((s, i) => {
    if (s.hp < (before.structs[i] ?? s.hp)) w.fx.flash.set(i, 0.12);
  });
  /*
   * And the units, which were never flashed at all.
   *
   * `unitFlash` was read by the renderer and decayed here, and nothing ever
   * wrote to it — so a Raider taking cannon fire looked exactly like a Raider
   * standing still, right up until it vanished. Being hit has to be visible or
   * a losing raid has no story in it.
   */
  battle.units.forEach((u, i) => {
    if (!u.dead && u.hp < (before.units[i] ?? u.hp)) w.unitFlash.set(i, 0.16);
  });
}

/** One place, every entity. */
export function decayFx(w: World, dt: number): void {
  for (const map of [w.fx.flash, w.fx.recoil, w.unitFlash]) {
    for (const [k, v] of map) {
      const next = v - dt * (map === w.fx.recoil ? 4 : 1);
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
  if (!battle || battle.ended || w.watching) return;
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

/**
 * Use the armed item at a grid position, recording the command.
 *
 * Unlike a deploy, an item may land anywhere on the map, including on top of a
 * building — that is what an item is for. It disarms itself afterwards, so the
 * next tap is a deploy again.
 */
export function useItemAt(w: World, gx: number, gy: number): void {
  const battle = w.battle;
  const item = w.selectedItem;
  if (!battle || battle.ended || !item || w.watching) return;
  const out = battle.useItem(item, gx, gy);
  if (!out.ok) {
    w.events.onToast(out.reason === 'outOfBounds' ? 'Too far out' : 'None of those left');
    w.selectedItem = null;
    return;
  }
  w.battleItems.push(out.command);
  w.bursts.push({ x: gx, y: gy, r: ITEM[item].r, item, born: w.t });
  w.selectedItem = null;
  if (item === 'horn') sfx.horn(); else sfx.hit();
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

/** Centre the ghost on a grid point: a tap on the ground. */
export function movePlacementTo(w: World, gx: number, gy: number): void {
  const p = w.placement;
  if (!p) return;
  const s = TYPES[p.type].s;
  placeGhostAt(w, gx - s / 2, gy - s / 2);
}

/**
 * Put the ghost's top-left corner at a grid point.
 *
 * A drag goes through here with the corner the finger picked the building up
 * by, so the building stays under the finger where it was grabbed instead of
 * jumping to centre itself on it — grabbed by the roof, a Keep used to leap
 * two tiles north the moment it moved, and land on its neighbours.
 */
export function placeGhostAt(w: World, gx: number, gy: number): void {
  const p = w.placement;
  if (!p) return;
  const s = TYPES[p.type].s;
  const was = `${p.gx},${p.gy},${p.ok}`;
  p.gx = clamp(Math.round(gx), 2, N - 2 - s);
  p.gy = clamp(Math.round(gy), 2, N - 2 - s);
  p.ok = localCellsFree(w, p.type, p.gx, p.gy, p.movingId);
  const moved = `${p.gx},${p.gy},${p.ok}` !== was;
  if (moved) {
    p.resumed = false;
    w.events.onPlacementChanged();
  }
}


/*
 * The nearest patch of ground this will actually fit on.
 *
 * ALFA: "saya baru ngerjain task d suruh bangun mala ga ada bangunan perbaiki
 * ini harusnya ada tugas kita cuman mindahin ke tempat yang kita suka aja"
 *
 * A War Order said build a Rampart, they opened BUILD, and the game answered
 * "Blocked — pick another spot" over a ghost sitting on top of their own
 * buildings. The ghost started four cells south of the Keep, which was open
 * ground until the day a new hold came with two Muster Fields in exactly that
 * spot. So the first thing a player following an order saw was a refusal, and
 * the only way out was to guess where the game would say yes.
 *
 * A building is never offered on ground it cannot stand on now. It opens on the
 * nearest free footprint, and a tap on something already built slides it to the
 * nearest free one instead of doing nothing — the order puts the building in
 * your hands, and all that is left is moving it somewhere you like.
 *
 * The search is the same outward shell walk the server seeds a new base with,
 * so both answer "where does this fit" the same way.
 */
export function nearestFreeSpot(
  w: World, type: BuildingType, gx: number, gy: number,
  ignoreId: string | null, maxRadius = N,
): { gx: number; gy: number } | null {
  const s = TYPES[type].s;
  const ox = clamp(Math.round(gx), 2, N - 2 - s);
  const oy = clamp(Math.round(gy), 2, N - 2 - s);
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        // Only the shell of each square, so the walk stays outward-first and
        // the first hit really is the nearest.
        if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const cx = ox + dx;
        const cy = oy + dy;
        if (cx < 2 || cy < 2 || cx + s > N - 2 || cy + s > N - 2) continue;
        if (localCellsFree(w, type, cx, cy, ignoreId)) return { gx: cx, gy: cy };
      }
    }
  }
  return null;
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
export function startPlacement(
  w: World, type: BuildingType, movingId: string | null,
  at?: { gx: number; gy: number },
): void {
  const existing = movingId ? w.player?.buildings.find((b) => b.id === movingId) : undefined;
  const keep = w.player?.buildings.find((b) => b.type === 'keep');
  const wantX = existing?.gx ?? at?.gx ?? (keep ? keep.gx : 26);
  const wantY = existing?.gy ?? at?.gy ?? (keep ? keep.gy + 4 : 30);
  /*
   * A building already in hand, standing somewhere it fits.
   *
   * Picking one up keeps it exactly where it is — that spot is free by
   * definition, and a move that begins by teleporting the building is not a
   * move. A new one opens on the nearest free footprint to the same place,
   * which is what stops an order to build from opening on "Blocked".
   */
  /*
   * `at` is a run of Ramparts carrying on from the last one laid, and it is
   * taken exactly as given even though it is now occupied by that Rampart —
   * the ghost sits on it, red, and PLACE greys out until the player says where
   * the next one goes. Hunting for free ground here is what turned a row of
   * taps on PLACE into a spray of walls around the Keep.
   */
  const spot = existing || at
    ? { gx: wantX, gy: wantY }
    : nearestFreeSpot(w, type, wantX, wantY, movingId) ?? { gx: wantX, gy: wantY };
  const gx = spot.gx;
  const gy = spot.gy;

  w.placement = {
    type,
    gx,
    gy,
    ok: localCellsFree(w, type, gx, gy, movingId),
    movingId,
    fromX: gx,
    fromY: gy,
    resumed: at !== undefined,
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

/**
 * The building under a screen point, roof included.
 *
 * Buildings stand up out of their footprint, and a finger lands on the roof
 * far more often than on the ground beneath it. So the point is tested
 * against the footprint, then against the footprint slid down the screen by
 * every height up to the building's own — which is the shape a box makes
 * seen from this angle. Front-most wins where roofs overlap.
 */
export function buildingAtScreen(w: World, sx: number, sy: number) {
  const direct = buildingAt(w, ...s2g(w.cam, w.vp, sx, sy));
  if (direct) return direct;
  const z = w.cam.z;
  const list = [...(w.player?.buildings ?? [])].sort((a, b) => (b.gx + b.gy) - (a.gx + a.gy));
  for (const b of list) {
    const s = TYPES[b.type].s;
    const height = (PIPH[b.type] ?? 60) * z;
    for (let dy = 6 * z; dy <= height; dy += 6 * z) {
      const [gx, gy] = s2g(w.cam, w.vp, sx, sy + dy);
      if (gx >= b.gx && gx < b.gx + s && gy >= b.gy && gy < b.gy + s) return b;
    }
  }
  return null;
}


/**
 * Change the light.
 *
 * Kept here rather than assigned from the canvas host so the crossfade cannot
 * be started halfway: the phase being left and the progress out of it have to
 * move together, and setting one without the other paints a sky nobody asked
 * for until the next change.
 */
export function setPhase(w: World, phase: Phase): void {
  if (phase === w.phase) return;
  // From whatever is actually on screen, which during a fade is not `phase`.
  w.skyFrom = w.skyMix >= 1 ? w.phase : w.skyFrom;
  w.phase = phase;
  w.skyMix = 0;
}

/** Walk the crossfade forward. Does nothing once it has arrived. */
export function stepSky(w: World, dt: number): void {
  if (w.skyMix >= 1) return;
  w.skyMix = Math.min(1, w.skyMix + dt / SKY_FADE);
}
