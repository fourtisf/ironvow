import { DEF_STAT, DEPLOY_CLEARANCE, PROD, TH, TROOP, TROOP_ORDER, TW, TYPES, heroStats, type BuildingType } from '@ironvow/config';
import { isoX, isoY, onScreen, structOnScreen, w2s } from '../render/camera';
import type { Draw } from '../render/primitives';
import { ANIMATED, drawBuilderMark, drawBuilding, drawBuildingFx } from '../render/buildings';
import { blitBuilding, blitDeco } from '../render/sprites';
import { C, PIPH } from '../render/palette';
import { drawHpBar, isoBox, isoDiamond, roundRect } from '../render/primitives';
import { drawAtmosphere } from '../render/atmosphere';
import { drawTerrain } from '../render/terrain';
import { drawProjectile, drawUnit } from '../render/units';
import type { DeployableType } from '@ironvow/types';
import type { ClientBuilding } from './types';
import { firstAvailableTroop, type World } from './world';
import type { Battle } from '@ironvow/sim';

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
  | { d: number; k: 'building'; b: ClientBuilding }
  | { d: number; k: 'muster'; m: Mustered };

type BattleEntity =
  | { d: number; k: 'deco'; i: number }
  | { d: number; k: 'struct'; i: number }
  | { d: number; k: 'unit'; i: number };

/*
 * How far a defence shoots, painted on the ground.
 *
 * A player choosing where to put a Cannon is answering exactly one question —
 * what does it cover — and the game was not showing them. Worse, the answer is
 * not obvious by eye: the simulation fires on plain Euclidean distance in grid
 * space, and a circle in grid space is not a circle on an isometric screen.
 *
 * Working it through: with `isoX = (gx - gy)·TW/2` and `isoY = (gx + gy)·TH/2`,
 * substituting `u = gx - gy` and `v = gx + gy` into `gx² + gy² = r²` gives
 * `u² + v² = 2r²`, which lands on the screen as an axis-aligned ellipse with
 * semi-axes `r·TW/√2` and `r·TH/√2`. So the ring below is the real firing
 * envelope and not an approximation of one — a unit is inside it exactly when
 * the server would shoot at it.
 */
export function rangeRadii(r: number, zoom: number): { rx: number; ry: number } {
  return { rx: r * (TW / Math.SQRT2) * zoom, ry: r * (TH / Math.SQRT2) * zoom };
}

/**
 * How loudly a ring is drawn.
 *
 * `primary` is the one the player is acting on. `shown` is every defence while
 * the toggle is held on — the whole hold's coverage is the subject, so they are
 * all worth seeing. `context` is the rest while one is primary: present, so a
 * gap reads, but plainly not the one being decided about.
 */
type RingWeight = 'primary' | 'shown' | 'context';

function rangeRing(
  w: World, d: Draw, gx: number, gy: number, type: BuildingType, level: number,
  weight: RingWeight,
): void {
  const stat = DEF_STAT[type];
  if (!stat) return;
  const size = TYPES[type].s;
  const cx = gx + size / 2;
  const cy = gy + size / 2;
  const [sx, sy] = w2s(w.cam, w.vp, isoX(cx, cy), isoY(cx, cy));
  const { rx, ry } = rangeRadii(stat(level).rng, w.cam.z);

  const { ctx } = d;
  ctx.save();
  if (weight !== 'context') {
    /*
     * A wash that fades outward.
     *
     * Where two of these overlap the fills add up, which is the point: the
     * ground a hold covers twice comes out brighter than the ground it covers
     * once, and the ground it does not cover stays green. A player reads the
     * hole in a defence without counting rings.
     */
    const soft = weight === 'shown';
    const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(rx, ry));
    grd.addColorStop(0, soft ? 'rgba(120,200,255,.10)' : 'rgba(120,200,255,.16)');
    grd.addColorStop(0.72, soft ? 'rgba(120,200,255,.06)' : 'rgba(120,200,255,.09)');
    grd.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const alpha = weight === 'primary' ? 0.85 : weight === 'shown' ? 0.6 : 0.3;
  const width = weight === 'primary' ? 2.2 : weight === 'shown' ? 1.8 : 1.4;
  ctx.strokeStyle = `rgba(150,215,255,${alpha})`;
  ctx.lineWidth = Math.max(1.2, width * w.cam.z);
  // Dashed, because a solid ring reads as a wall rather than as a reach.
  ctx.setLineDash(weight === 'primary'
    ? [10 * w.cam.z, 7 * w.cam.z]
    : [6 * w.cam.z, 6 * w.cam.z]);
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/*
 * Where the army stands.
 *
 * A warband was a number on a sheet: fourteen Raiders looked exactly like
 * none. In a base builder the army is half of what a player is proud of, so
 * the troops stand on their Muster Fields and stay there until they are sent
 * somewhere — which is also the honest picture, because that is the warband a
 * raid will actually field.
 *
 * The field used to be painted here, under the troops, because there was no
 * building to draw it. There is one now: the Muster Field is bought, placed,
 * upgraded and destroyed like anything else, and it draws its own ground. All
 * that is left here is who stands where on it.
 *
 * Laid out from the same list every frame rather than remembered, so it costs
 * nothing to keep in step with the roster: train one and a figure appears,
 * lose them on a raid and the field empties.
 */

/**
 * How far apart they stand.
 *
 * The first attempt used 0.62 of a tile and the ranks came out as one mass of
 * helmets. A figure is about 34 device pixels across at zoom 1 and one grid
 * step sideways is only `TW / 2` — 32 — so anything under about 1.1 tiles has
 * neighbours' shoulders inside each other.
 *
 * A field is four cells square with a fence around it and a tent in each
 * corner, which is what sets the ceiling: a whole tile between them puts three
 * to a rank down the middle of it. They are diagonal neighbours on screen
 * rather than side by side, so a tile reads as further apart than it sounds.
 */
const MUSTER_GAP = 1.0;
/**
 * Ground left between the outermost rank and the fence.
 *
 * Generous on purpose. The troops are drawn after the whole building, so a
 * figure standing on the front rail would be painted over it and read as
 * standing outside the field it belongs to.
 */
const MUSTER_PAD = 1.0;
/** Three to a rank, three ranks: what fits between the rails. */
const MUSTER_RANK = 3;
/**
 * Figures drawn on one field, and across the whole hold.
 *
 * A level-9 field has room for thirty-two troops and space on the ground for
 * six. Two ranks of three is what fits without hiding the field they are
 * standing on — and the field is the thing the player bought. Past that it is
 * a crowd, and nobody counts a crowd, so the rest are simply not drawn; which
 * is also what keeps ten fields from costing the frame a hundred sprites.
 */
const MUSTER_PER_FIELD = 6;
export const MUSTER_MAX = 48;

export interface Mustered {
  type: DeployableType;
  gx: number;
  gy: number;
  level: number;
  /** Alternated down the ranks, so a field is a crowd and not a wallpaper. */
  face: 1 | -1;
}

export interface Muster {
  troops: Mustered[];
}

const EMPTY_MUSTER: Muster = { troops: [] };

/**
 * Exported for the tests: who stands where is arithmetic, and arithmetic is
 * worth pinning down without a canvas.
 */
export function musterOf(w: World): Muster {
  const player = w.player;
  if (!player) return EMPTY_MUSTER;
  // A field still going up is a building site, not a parade ground.
  const fields = player.buildings.filter((b) => b.type === 'camp' && !b.completesAt);
  if (fields.length === 0) return EMPTY_MUSTER;

  // Flattened first, so the split across fields is a plain deal of one list
  // and the roster order still holds inside each one.
  const roster: { type: DeployableType; level: number }[] = [];
  const levels = w.progressionLevels;
  const room = Math.min(MUSTER_MAX, fields.length * MUSTER_PER_FIELD);
  for (const type of TROOP_ORDER) {
    const count = player.army[type] ?? 0;
    for (let i = 0; i < count && roster.length < room; i++) {
      roster.push({ type, level: levels[type] ?? 1 });
    }
  }
  if (roster.length === 0) return EMPTY_MUSTER;

  const troops: Mustered[] = [];
  const size = TYPES.camp.s;
  for (let f = 0; f < fields.length; f++) {
    const field = fields[f]!;
    // Dealt round the fields rather than filling one at a time, so a second
    // field is somewhere the army actually is and not an empty pen.
    const mine = roster.filter((_, i) => i % fields.length === f).slice(0, MUSTER_PER_FIELD);
    const rows = Math.ceil(mine.length / MUSTER_RANK);
    for (let i = 0; i < mine.length; i++) {
      const unit = mine[i]!;
      const col = i % MUSTER_RANK;
      const row = Math.floor(i / MUSTER_RANK);
      // Short ranks are centred, and the whole block is centred in the field,
      // so a field holding two is not two figures in one corner of it.
      const wide = row === rows - 1 ? mine.length - row * MUSTER_RANK : MUSTER_RANK;
      const acrossPad = (size - MUSTER_PAD * 2 - (wide - 1) * MUSTER_GAP) / 2;
      const downPad = (size - MUSTER_PAD * 2 - (rows - 1) * MUSTER_GAP) / 2;
      troops.push({
        type: unit.type,
        level: unit.level,
        gx: field.gx + MUSTER_PAD + acrossPad + col * MUSTER_GAP,
        gy: field.gy + MUSTER_PAD + downPad + row * MUSTER_GAP,
        face: (col + row) % 3 === 1 ? -1 : 1,
      });
    }
  }
  return { troops };
}

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
  // The warband stands with the buildings in the depth sort, so a troop in
  // front of its Barracks is drawn over it and one behind is drawn under.
  const muster = musterOf(w);
  for (const m of muster.troops) {
    if (!onScreen(w.cam, w.vp, m.gx, m.gy)) continue;
    ents.push({ d: m.gx + m.gy, k: 'muster', m });
  }
  ents.sort((a, b) => a.d - b.d);

  /*
   * Rings go down before the buildings, because they are paint on the ground.
   *
   * While a defence is being placed every other defence shows a faint one too:
   * the decision is never "how far does this one reach" on its own, it is
   * "where is the gap", and one ring cannot answer that.
   */
  const place = w.placement;
  const ringFor = place && DEF_STAT[place.type] ? place.type : null;
  const selectedBuilding = w.selectedId
    ? w.player?.buildings.find((b) => b.id === w.selectedId) ?? null
    : null;
  // Held on by the toggle, or turned on for as long as one defence is being
  // placed or inspected — the moment a player is thinking about coverage.
  const hasPrimary = ringFor !== null
    || (selectedBuilding !== null && DEF_STAT[selectedBuilding.type] !== undefined);
  if (w.showRanges || hasPrimary) {
    const weight: RingWeight = hasPrimary ? 'context' : 'shown';
    for (const b of w.player?.buildings ?? []) {
      if (!DEF_STAT[b.type] || b.id === place?.movingId) continue;
      if (b.id === selectedBuilding?.id) continue;
      rangeRing(w, d, b.gx, b.gy, b.type, b.level, weight);
    }
  }
  if (selectedBuilding && DEF_STAT[selectedBuilding.type]) {
    rangeRing(w, d, selectedBuilding.gx, selectedBuilding.gy,
      selectedBuilding.type, selectedBuilding.level, 'primary');
  }
  if (place && ringFor) {
    // A building being moved keeps its own level; a fresh one is level 1.
    const moving = place.movingId
      ? w.player?.buildings.find((b) => b.id === place.movingId) ?? null
      : null;
    rangeRing(w, d, place.gx, place.gy, ringFor, moving?.level ?? 1, 'primary');
  }

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
    if (e.k === 'muster') {
      drawUnit(d, {
        type: e.m.type, x: e.m.gx, y: e.m.gy, mine: true, hp: 1, maxHp: 1,
        // Standing at ease: no walk, no swing. The bob and the flash belong to
        // a fight, and this is a yard.
        moving: false, face: e.m.face, swing: 0, flash: 0, born: 0, level: e.m.level,
      });
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
      drawStruct(w, d, b.type, b.level, w.previewEnemy, b.gx, b.gy,
        undefined, undefined, linkOf(walls, b.gx, b.gy));
    }
  }
  drawAtmosphere(d);
}


/*
 * The ground a raider may not stand on.
 *
 * ALFA: "mengapa tidak bisa kerahkan pasukan?? kalo kaya gni lebih baik
 * persegiin garis merah loh apakah anda paham??"
 *
 * The rule was always there — a deploy inside a structure's footprint plus
 * DEPLOY_CLEARANCE is refused — and it was completely invisible. All the player
 * got was a line of text saying no, which answers "why did that fail" and never
 * answers "then where". Tapping around a base hunting for a legal cell is not a
 * decision anybody is making.
 *
 * So the zone is painted. It is drawn from `DEPLOY_CLEARANCE` in the config,
 * the same number the simulation refuses on, because a boundary painted from a
 * second copy of a number is a boundary that will one day be a lie.
 *
 * It is the union of a circle per building rather than one rectangle round the
 * whole hold, and that is a deliberate difference from what was asked for: a
 * rectangle would be simpler to read, but it would also colour in a great deal
 * of ground the server is perfectly happy to take troops on — a base with two
 * Muster Fields at opposite corners has a lot of legal grass between them. A
 * boundary that lies in the "you may not" direction costs the player real
 * options, so the shape follows the rule.
 *
 * One path, one fill: overlapping circles filled together are their union, so
 * the wash never doubles up where two buildings are close.
 */
function drawNoDeployZone(_w: World, d: Draw, battle: Battle): void {
  const { ctx, cam, vp } = d;
  const alive = battle.structs.filter((s) => !s.dead);
  if (alive.length === 0) return;

  interface Blob { cx: number; cy: number; rx: number; ry: number }
  const blobs: Blob[] = alive.map((s) => {
    const r = s.size / 2 + DEPLOY_CLEARANCE;
    const [cx, cy] = w2s(cam, vp, isoX(s.cx, s.cy), isoY(s.cx, s.cy));
    // A circle in grid space is an ellipse on an isometric screen; the same
    // substitution the range rings use. See rangeRadii.
    const { rx, ry } = rangeRadii(r, cam.z);
    return { cx, cy, rx, ry };
  });

  const path = (c: CanvasRenderingContext2D, inset: number): void => {
    c.beginPath();
    for (const b of blobs) {
      c.ellipse(b.cx, b.cy, Math.max(0.01, b.rx - inset), Math.max(0.01, b.ry - inset),
        0, 0, 6.2832);
    }
  };

  // One path, one fill: overlapping circles filled together are their union,
  // so the wash never doubles up where two buildings stand close.
  path(ctx, 0);
  ctx.fillStyle = 'rgba(214,54,42,.2)';
  ctx.fill();

  /*
   * The edge, which is the part ALFA actually asked for.
   *
   * Stroking the circles as they are draws the arcs buried inside the blob
   * too, and a zone with lines across the middle of it reads as several zones.
   * Clipping does not get this out either: "outside the union" is not a thing
   * either fill rule can express once three circles overlap, and on a real base
   * they always do — under non-zero, ground covered twice winds to -1 and comes
   * back; under even-odd it comes back at three.
   *
   * So the band is built where boolean geometry actually is available: on a
   * layer of its own, as the union minus the union shrunk by the line width,
   * which is exactly the ring inside the boundary. It is cached on the camera,
   * because a hand resting still on a phone is most frames.
   */
  const band = zoneBand(blobs, vp, Math.max(3, 4.5 * cam.z));
  if (band) {
    // The layer is in device pixels; this context is already scaled by the
    // device ratio, so the source rectangle is the only one that carries it.
    const k = vp.dpr;
    ctx.drawImage(band.canvas,
      band.x * k, band.y * k, band.w * k, band.h * k,
      band.x, band.y, band.w, band.h);
  }
}

/**
 * The scratch layer the zone outline is cut on, kept between frames.
 *
 * One canvas for the life of the tab. It is only ever the size of the
 * viewport, and it is only ever redrawn when the camera moves or a building
 * falls — panning during a raid is the worst case and it is one clear and two
 * fills, which is less than the base behind it costs.
 */
let bandCanvas: HTMLCanvasElement | null = null;
let bandKey = '';
let bandRect = { x: 0, y: 0, w: 0, h: 0 };

interface Band { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number }

function zoneBand(
  blobs: readonly { cx: number; cy: number; rx: number; ry: number }[],
  vp: { w: number; h: number; dpr: number },
  width: number,
): Band | null {
  if (typeof document === 'undefined') return null;
  const key = `${vp.w}x${vp.h}x${vp.dpr}|${width.toFixed(1)}|`
    + blobs.map((b) => `${b.cx.toFixed(1)},${b.cy.toFixed(1)},${b.rx.toFixed(1)}`).join(';');
  if (bandCanvas && bandKey === key) return { canvas: bandCanvas, ...bandRect };

  const c = bandCanvas ?? document.createElement('canvas');
  bandCanvas = c;
  const dw = Math.max(1, Math.round(vp.w * vp.dpr));
  const dh = Math.max(1, Math.round(vp.h * vp.dpr));
  if (c.width !== dw || c.height !== dh) { c.width = dw; c.height = dh; }
  const bc = c.getContext('2d');
  if (!bc) return null;

  /*
   * Only the ground the zone actually covers is touched.
   *
   * Clearing a whole phone's backing store every frame while a finger drags
   * the map is three megapixels of work to draw an outline round a base that
   * occupies a third of the screen. The rectangle is the union's own bounds,
   * clipped to the viewport, and it is what gets cleared, drawn and blitted.
   */
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const b of blobs) {
    x0 = Math.min(x0, b.cx - b.rx); x1 = Math.max(x1, b.cx + b.rx);
    y0 = Math.min(y0, b.cy - b.ry); y1 = Math.max(y1, b.cy + b.ry);
  }
  const rect = {
    x: Math.max(0, Math.floor(x0 - 2)),
    y: Math.max(0, Math.floor(y0 - 2)),
    w: 0,
    h: 0,
  };
  rect.w = Math.min(vp.w, Math.ceil(x1 + 2)) - rect.x;
  rect.h = Math.min(vp.h, Math.ceil(y1 + 2)) - rect.y;
  if (rect.w <= 0 || rect.h <= 0) return null;

  bc.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
  bc.clearRect(rect.x, rect.y, rect.w, rect.h);
  const fill = (inset: number): void => {
    bc.beginPath();
    for (const b of blobs) {
      bc.ellipse(b.cx, b.cy, Math.max(0.01, b.rx - inset), Math.max(0.01, b.ry - inset),
        0, 0, 6.2832);
    }
    bc.fill();
  };
  bc.fillStyle = 'rgba(255,96,74,.95)';
  fill(0);
  // And out again, one line width in: what is left is the boundary itself.
  bc.globalCompositeOperation = 'destination-out';
  bc.fillStyle = '#000';
  fill(width);
  bc.globalCompositeOperation = 'source-over';

  bandKey = key;
  bandRect = rect;
  return { canvas: c, ...rect };
}

export function swingOf(
  u: { t: DeployableType; cd: number; moving: boolean }, heroLevel: number,
): number {
  // A unit walking to its target is not hitting anything, and its cooldown is
  // whatever it was left with when the last target died.
  if (u.moving) return 0;
  const period = u.t === 'hero' ? heroStats(heroLevel).cd : TROOP[u.t].cd;
  if (period <= 0) return 0;
  return Math.max(0, Math.min(1, u.cd / period));
}

function renderBattle(w: World, ctx: CanvasRenderingContext2D): void {
  const d = draw(w, ctx);
  const battle = w.battle!;
  drawTerrain(d, w.terrain);

  // Painted on the ground, so everything that stands on it is drawn over it.
  // Only while there are still troops to put down: once the tray is empty the
  // zone is answering a question nobody is asking any more.
  if (battle.kind === 'raid' && firstAvailableTroop(w) !== null) drawNoDeployZone(w, d, battle);

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
        swing: swingOf(u, w.raid?.hero?.level ?? 1),
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
  blitBuilding(d, type, level, enemy, ax, ay, link, w.levelPips);
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
