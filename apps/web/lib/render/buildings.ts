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
  'keep', 'forge', 'barr', 'lab', 'cannon', 'brazier', 'standard',
]);

/* ------------------------------------------------------------- tiers --- */

/**
 * Four looks across a building's levels.
 *
 * A level-1 Gold Mine and a level-9 one used to be the same drawing with a
 * different number over it, which made upgrading a building you could see feel
 * like buying a number. Each tier changes the materials — timber, then stone,
 * then iron-braced, then gilded — so an upgrade that crosses one is visible
 * from across the base, and `grow` makes every level in between a little
 * taller than the last so the ones that do not cross a tier still show.
 */
export function tierOf(level: number): 0 | 1 | 2 | 3 {
  if (level >= 8) return 3;
  if (level >= 6) return 2;
  if (level >= 3) return 1;
  return 0;
}

/**
 * Height multiplier: 3% a level, so a level 9 stands about a quarter taller
 * than a level 1. Enough to see side by side, little enough that a chest does
 * not become a tower by the time it is maxed.
 */
export function growthOf(level: number): number {
  return 1 + (level - 1) * 0.03;
}

/** Where the level pip floats, following the growth so it never sinks in. */
/**
 * Extra clearance the level pip needs per tier.
 *
 * The tiers do not just scale the art, they add to it — a lantern storey on
 * the Keep, an observatory on the Lab, a second storey under the Barracks
 * roof. Scaling `PIPH` by growth alone leaves the pip buried in the roof of
 * exactly the buildings a player most wants to read the level of.
 */
const PIP_TIER: Record<string, number> = {
  keep: 12, barr: 26, lab: 12, mine: 6, forge: 4, store: 2, tower: 4,
};

export function pipHeightOf(type: BuildingType, level: number): number {
  return ((PIPH[type] ?? 0) + (PIP_TIER[type] ?? 0) * tierOf(level)) * growthOf(level);
}

/** Timber, dressed stone, iron-braced, gilded. */
const TIER_FRAME = ['#8a5a30', '#8d9aa8', '#5f6d7d', '#c9924f'] as const;
const TIER_FRAME_D = ['#5d3b1e', '#5f6d7d', '#3f4a56', '#8a5c1c'] as const;
const TIER_TRIM = ['#a06f3d', '#b6c2cd', '#8d9aa8', '#ffd25c'] as const;
/** Roofs of the player's own buildings, gilding at the top tier. */
const TIER_ROOF = ['#3f6fbe', '#3a67b0', '#33589a', '#c9924f'] as const;
const TIER_ROOF_D = ['#2a4c88', '#264478', '#203a68', '#8a5c1c'] as const;
const TIER_THATCH = ['#e2d3ad', '#d8c79b', '#c9b487', '#e8c88a'] as const;
const TIER_THATCH_D = ['#8f7a52', '#867049', '#7a6440', '#a8802c'] as const;
const TIER_LAB = ['#7f6fb0', '#7566ab', '#6a5ba1', '#c9924f'] as const;
const TIER_LAB_D = ['#4e4276', '#463c6d', '#3f3563', '#8a5c1c'] as const;

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
  const tier = tierOf(lv);
  const g = growthOf(lv);

  shadowAt(d, gx, gy, s, s);

  const P = (ax: number, ay: number): [number, number] => w2s(cam, vp, isoX(ax, ay), isoY(ax, ay));

  if (b.type === 'keep') {
    /*
     * The centre of the hold, and the one building a player looks at every
     * session. Each tier is a different castle rather than the same one
     * repainted: a stone hall with four squat turrets, then taller turrets
     * with pennants, then a lantern storey standing above the roof, then the
     * whole crown gilded.
     */
    const wallH = (88 + lv * 3) * g;
    const turH = (52 + lv * 2 + tier * 7) * g;
    // The roof darkens and then gilds as the Keep is raised, so the centre of
    // the hold announces its level from anywhere on the field.
    const roofL = enemy ? '#a03828' : TIER_ROOF[tier];
    const roofD = enemy ? '#6d2216' : TIER_ROOF_D[tier];
    const plinth = 12 + tier * 3;
    isoBox(d, gx + 0.05, gy + 0.05, s - 0.1, s - 0.1, plinth, '#9aa7b4', C.stoneD, '#78858f');

    // Back turret first, then the sides, then the keep block, then the front
    // turret: painter's order, so nothing occludes what should be in front.
    const turret = (tx: number, ty: number, pennant: boolean): void => {
      isoBox(d, tx, ty, 0.85, 0.85, turH, C.stoneL, C.stoneD, C.stone);
      isoRoof(d, tx, ty, 0.85, 0.85, turH, turH + 26 + tier * 5, roofL, roofD);
      if (!pennant || tier < 1) return;
      // A pennant on a staff: the first thing that reads as "this Keep grew"
      // from across the field, well before the stonework does.
      const [fx, fy] = P(tx + 0.425, ty + 0.425);
      const top = fy - (turH + 26 + tier * 5 + 20) * z;
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(1.1, 1.8 * z);
      ctx.beginPath();
      ctx.moveTo(fx, fy - (turH + 26 + tier * 5) * z);
      ctx.lineTo(fx, top);
      ctx.stroke();
      ctx.fillStyle = tier >= 3 ? C.gold : roofL;
      ctx.beginPath();
      ctx.moveTo(fx, top);
      ctx.lineTo(fx + 13 * z, top + 4 * z);
      ctx.lineTo(fx, top + 9 * z);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    };
    turret(gx + 0.05, gy + 0.05, true);
    turret(gx + s - 0.9, gy + 0.05, true);
    turret(gx + 0.05, gy + s - 0.9, false);

    isoBox(d, gx + 0.72, gy + 0.72, s - 1.44, s - 1.44, wallH, C.stoneL, C.stoneD, C.stone);
    const peak = isoRoof(d, gx + 0.58, gy + 0.58, s - 1.16, s - 1.16, wallH, wallH + 34, roofL, roofD);
    if (tier >= 2) {
      /*
       * A lantern storey riding on the roof, with a roof of its own. This is
       * the tier that changes the outline of the hold, which is the point: a
       * level-6 Keep should not be a level-3 Keep with a darker hat.
       */
      const lanternH = 22 + tier * 3;
      isoBox(
        d, gx + s / 2 - 0.42, gy + s / 2 - 0.42, 0.84, 0.84, lanternH,
        C.stoneL, C.stoneD, C.stone, undefined, wallH + 12,
      );
      isoRoof(
        d, gx + s / 2 - 0.5, gy + s / 2 - 0.5, 1.0, 1.0,
        wallH + 12 + lanternH, wallH + 12 + lanternH + 18, roofL, roofD,
      );
    } else {
      void peak;
    }
    if (tier >= 3) {
      // A gilded band where the roof meets the wall: the maxed Keep.
      isoBox(d, gx + 0.54, gy + 0.54, s - 1.08, s - 1.08, 7, C.gold, C.goldD, '#b8801c', undefined, wallH - 5);
    }

    // Merlons along the front parapet, one more per tier. Kept few and wide:
    // a dozen thin ones read as a comb laid on the roof, not as stonework.
    const merlons = 4 + tier;
    for (let i = 0; i < merlons; i++) {
      const f = 0.72 + ((s - 1.44) * (i + 0.5)) / merlons;
      const [mx, my] = P(gx + f, gy + s - 0.72);
      ctx.fillStyle = tier >= 3 ? C.gold : C.stoneL;
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(1.2, 2 * z);
      const mw = 8.5 * z;
      roundRect(ctx, mx - mw / 2, my - (wallH + 9) * z, mw, 11 * z, 1.5 * z);
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
    if (tier >= 1) {
      // Iron studs on the gate from tier 1, gilded hinges at the top.
      ctx.fillStyle = TIER_TRIM[tier];
      for (let i = 0; i < 2 + tier; i++) {
        ctx.beginPath();
        ctx.arc(dx - 4 * z + (i % 2) * 8 * z, dy - 10 * z - Math.floor(i / 2) * 7 * z, 1.6 * z, 0, 6.29);
        ctx.fill();
      }
    }

    turret(gx + s - 0.9, gy + s - 0.9, true);

  } else if (b.type === 'mine') {
    /*
     * A gold mine that looks like one.
     *
     * It used to be a hut with a cart beside it, which is a hut. What a
     * player should be able to read from across the base is: a pit cut into
     * the ground with the seam showing in its walls, a headframe standing
     * over the shaft to wind the ore up, and the ore itself heaped and
     * loaded. The tiers take it from a timber prop over a scratch in the
     * dirt to an iron-braced frame over a terraced pit.
     */
    const pit = 0.5 + tier * 0.08;
    const deep = (10 + tier * 5) * g;

    // The ground it is cut into.
    isoBox(d, gx + 0.05, gy + 0.05, s - 0.1, s - 0.1, 9, C.dirt, C.dirt2, '#a87a41');

    // The pit: terraces sinking, each darker, with the seam glinting in the
    // wall of every step. Drawn as diamonds at falling heights rather than as
    // a hole, because a hole in an isometric floor is only ever the shape of
    // the thing you draw at the bottom of it.
    const px0 = gx + 0.52;
    const py0 = gy + 1.02;
    const steps = 2 + tier;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const w = pit * 2 * (1 - f * 0.62);
      const shade = 78 - f * 44;
      isoDiamond(
        d, px0 - w / 2, py0 - w / 2, w, w,
        `rgb(${Math.round(shade * 1.5)},${Math.round(shade * 1.14)},${Math.round(shade * 0.76)})`,
        9 - (deep * f), i === 0 ? '#6b4a26' : undefined,
      );
      // The seam: gold in the cut face of each terrace.
      if (i > 0 && i < steps) {
        const [sx, sy] = P(px0, py0 + w / 2);
        ctx.fillStyle = i % 2 === 0 ? C.gold : '#ffd25c';
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath();
          ctx.ellipse(sx + k * 7 * z * (1 - f), sy - (9 - deep * f) * z + 2 * z, 2.6 * z, 1.5 * z, 0, 0, 6.29);
          ctx.fill();
        }
      }
    }

    // The headframe over the shaft: four legs meeting under a crown, with a
    // winch wheel and the rope down the middle.
    const legH = (40 + tier * 10) * g;
    const half = 0.34 + tier * 0.03;
    const [hx, hy] = P(px0, py0);
    const foot = (ax: number, ay: number): [number, number] => P(px0 + ax, py0 + ay);
    const crown = hy - legH * z;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = C.line;
    for (const [ax, ay] of [[-half, -half], [half, -half], [-half, half], [half, half]] as const) {
      const [lx, ly] = foot(ax, ay);
      ctx.lineWidth = Math.max(2.4, (3.4 + tier * 0.5) * z);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(hx, crown + 4 * z); ctx.stroke();
      ctx.strokeStyle = TIER_FRAME[tier];
      ctx.lineWidth = Math.max(1.4, (2.1 + tier * 0.5) * z);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(hx, crown + 4 * z); ctx.stroke();
      ctx.strokeStyle = C.line;
    }
    // A brace band around the legs, higher up on the better frames.
    for (let band = 0; band <= tier; band++) {
      const f = 0.42 + band * 0.17;
      ctx.strokeStyle = TIER_FRAME_D[tier];
      ctx.lineWidth = Math.max(1.2, 1.9 * z);
      ctx.beginPath();
      for (let i = 0; i <= 4; i++) {
        const [ax, ay] = ([[-half, -half], [half, -half], [half, half], [-half, half], [-half, -half]] as const)[i]!;
        const [lx, ly] = foot(ax, ay);
        const bx = lx + (hx - lx) * f;
        const by = ly + (crown + 4 * z - ly) * f;
        if (i === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
      }
      ctx.stroke();
    }

    // Winch wheel and rope.
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.2, 2 * z);
    ctx.fillStyle = TIER_TRIM[tier];
    ctx.beginPath(); ctx.arc(hx, crown, (7 + tier) * z, 0, 6.29); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2b3440';
    ctx.beginPath(); ctx.arc(hx, crown, (2.6 + tier * 0.3) * z, 0, 6.29); ctx.fill();
    ctx.strokeStyle = '#3f2d1c';
    ctx.lineWidth = Math.max(1, 1.5 * z);
    ctx.beginPath();
    ctx.moveTo(hx, crown + (7 + tier) * z);
    ctx.lineTo(hx, hy - 8 * z);
    ctx.stroke();
    // The bucket on the rope, hanging in the shaft.
    ctx.fillStyle = TIER_FRAME_D[tier];
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.1, 1.7 * z);
    roundRect(ctx, hx - 5 * z, hy - 14 * z, 10 * z, 8 * z, 1.6 * z);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.gold;
    ctx.beginPath(); ctx.ellipse(hx, hy - 14 * z, 4.4 * z, 1.9 * z, 0, 0, 6.29); ctx.fill();

    // Rails from the pit to the cart, and the cart heaped with ore.
    const railA = P(gx + 1.02, gy + 1.28);
    const railB = P(gx + 1.84, gy + 0.86);
    ctx.strokeStyle = '#4a3a28';
    ctx.lineWidth = Math.max(1.1, 1.7 * z);
    for (const off of [-3, 3]) {
      ctx.beginPath();
      ctx.moveTo(railA[0], railA[1] + off * z);
      ctx.lineTo(railB[0], railB[1] + off * z);
      ctx.stroke();
    }
    for (let i = 0; i <= 4; i++) {
      const f = i / 4;
      const tx = railA[0] + (railB[0] - railA[0]) * f;
      const ty = railA[1] + (railB[1] - railA[1]) * f;
      ctx.beginPath(); ctx.moveTo(tx, ty - 4 * z); ctx.lineTo(tx, ty + 4 * z); ctx.stroke();
    }

    const [cx2, cy2] = P(gx + 1.66, gy + 0.96);
    ctx.fillStyle = TIER_FRAME_D[tier];
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.2, 2 * z);
    roundRect(ctx, cx2 - 11 * z, cy2 - 16 * z, 22 * z, 12 * z, 3 * z);
    ctx.fill(); ctx.stroke();
    // Heaped, not level: a cart with a flat top of coins reads as a box.
    ctx.fillStyle = C.gold;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(cx2 - 6 * z + i * 6 * z, cy2 - (17 + (i === 1 ? 2 : 0)) * z, 4.2 * z, 3 * z, 0, 0, 6.29);
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#2b3440';
    ctx.beginPath(); ctx.arc(cx2 - 6 * z, cy2 - 3 * z, 3.4 * z, 0, 6.29); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx2 + 6 * z, cy2 - 3 * z, 3.4 * z, 0, 6.29); ctx.fill(); ctx.stroke();

    // Spoil heaps around the rim, more of them the deeper the mine goes.
    for (let i = 0; i < 2 + tier; i++) {
      const a = 0.6 + i * 1.9;
      const [ox, oy] = P(gx + 1 + Math.cos(a) * 0.72, gy + 1 + Math.sin(a) * 0.72);
      ctx.fillStyle = i % 2 === 0 ? '#7d5a3c' : '#6b4a2c';
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(1, 1.6 * z);
      ctx.beginPath();
      ctx.moveTo(ox - 8 * z, oy);
      ctx.quadraticCurveTo(ox, oy - (7 + i) * z, ox + 8 * z, oy);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if (tier >= 2) {
        ctx.fillStyle = C.gold;
        ctx.beginPath(); ctx.arc(ox + (i % 2 ? 2 : -2) * z, oy - 3 * z, 1.8 * z, 0, 6.29); ctx.fill();
      }
    }

  } else if (b.type === 'forge') {
    /*
     * A smithy: a stone furnace with its mouth open and glowing, a chimney
     * over it, an anvil out front and the iron it has made stacked beside
     * that. The tiers add chimneys and clad the furnace in iron, so a maxed
     * forge is a small factory rather than the same shed with a 9 on it.
     */
    const chim = (40 + tier * 6) * g;
    const stack = 1 + Math.min(2, tier);

    isoBox(d, gx + 0.06, gy + 0.06, s - 0.12, s - 0.12, 9, '#6b5340', '#4a382b', '#5a4636');

    // The furnace block, back-left, with its chimneys.
    isoBox(d, gx + 0.18, gy + 0.18, 1.1, 1.1, 34 * g,
      tier >= 2 ? '#7c8794' : '#a8927c', tier >= 2 ? '#4a545f' : '#6b5a49', tier >= 2 ? '#5f6d7d' : '#8a765f');
    for (let i = 0; i < stack; i++) {
      const off = i * 0.32;
      const h = chim - i * 7 * g;
      isoBox(d, gx + 0.24 + off, gy + 0.24 + off * 0.2, 0.42, 0.42, h,
        C.stoneL, C.stoneD, C.stone);
      // The cap is a slab laid on top, not another box: an isoBox is drawn
      // from the ground up, so a "cap" made of one stood in front of the
      // chimney as a second, taller tower.
      isoDiamond(d, gx + 0.18 + off, gy + 0.18 + off * 0.2, 0.54, 0.54,
        TIER_TRIM[tier], h + 3, TIER_FRAME_D[tier]);
    }

    // The mouth of the furnace, facing front-right. The glow itself is in the
    // fx half; this is the arch it burns inside.
    const [mx, my] = P(gx + 1.28, gy + 1.02);
    ctx.fillStyle = '#2a1c12';
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.2, 2 * z);
    ctx.beginPath();
    ctx.moveTo(mx - 10 * z, my);
    ctx.lineTo(mx - 10 * z, my - 12 * z);
    ctx.quadraticCurveTo(mx, my - 24 * z, mx + 10 * z, my - 12 * z);
    ctx.lineTo(mx + 10 * z, my);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (tier >= 1) {
      // Iron banding round the mouth.
      ctx.strokeStyle = TIER_FRAME_D[tier];
      ctx.lineWidth = Math.max(1.6, 2.6 * z);
      ctx.beginPath();
      ctx.moveTo(mx - 12 * z, my + z);
      ctx.lineTo(mx - 12 * z, my - 13 * z);
      ctx.quadraticCurveTo(mx, my - 27 * z, mx + 12 * z, my - 13 * z);
      ctx.lineTo(mx + 12 * z, my + z);
      ctx.stroke();
    }

    // The anvil, front-right, on its block.
    const [ax2, ay2] = P(gx + 1.58, gy + 1.58);
    ctx.fillStyle = C.woodD;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.1, 1.8 * z);
    roundRect(ctx, ax2 - 7 * z, ay2 - 9 * z, 14 * z, 9 * z, 1.5 * z);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#4a545f';
    ctx.beginPath();
    ctx.moveTo(ax2 - 9 * z, ay2 - 13 * z);
    ctx.lineTo(ax2 + 6 * z, ay2 - 13 * z);
    ctx.lineTo(ax2 + 11 * z, ay2 - 16 * z);
    ctx.lineTo(ax2 + 5 * z, ay2 - 18 * z);
    ctx.lineTo(ax2 - 5 * z, ay2 - 18 * z);
    ctx.lineTo(ax2 - 8 * z, ay2 - 16 * z);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // Ingots stacked, more of them the better the forge.
    const [ix, iy] = P(gx + 0.55, gy + 1.62);
    for (let row = 0; row <= tier; row++) {
      for (let i = 0; i <= 1; i++) {
        ctx.fillStyle = row === 0 ? '#9fb0c2' : '#c3d2e0';
        ctx.strokeStyle = C.line;
        ctx.lineWidth = Math.max(1, 1.5 * z);
        roundRect(ctx, ix - 11 * z + i * 11 * z, iy - 6 * z - row * 5 * z, 10 * z, 5 * z, 1.2 * z);
        ctx.fill(); ctx.stroke();
      }
    }

    // A quench trough once the smithy is worth the water.
    if (tier >= 2) {
      const [qx, qy] = P(gx + 1.62, gy + 0.5);
      ctx.fillStyle = C.woodD;
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(1.1, 1.8 * z);
      roundRect(ctx, qx - 10 * z, qy - 10 * z, 20 * z, 9 * z, 2 * z);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3a86bb';
      roundRect(ctx, qx - 8 * z, qy - 9 * z, 16 * z, 5 * z, 1.5 * z);
      ctx.fill();
    }

  } else if (b.type === 'store') {
    /*
     * A strongbox at first, a banded chest next, then a stone vault with a
     * wheel door. What it is holding shows: coins on the lid early, bars
     * stacked behind it once it is worth guarding.
     */
    isoBox(
      d, gx + 0.08, gy + 0.08, s - 0.16, s - 0.16, 8 + tier * 2,
      tier >= 2 ? '#7d8994' : '#6b5340',
      tier >= 2 ? '#454e58' : '#4a382b',
      tier >= 2 ? '#59626d' : '#5a4636',
    );

    const boxH = (34 + tier * 4) * g;
    const body = isoBox(
      d, gx + 0.24, gy + 0.24, 1.52, 1.52, boxH,
      tier >= 2 ? '#8d9aa8' : C.wood,
      tier >= 2 ? '#4a545f' : C.woodD,
      tier >= 2 ? '#5f6d7d' : '#734829',
    );
    if (tier <= 1) {
      // A lid, banded across both diagonals: a chest.
      isoRoof(d, gx + 0.24, gy + 0.24, 1.52, 1.52, boxH, boxH + 14, '#a06f3d', '#6b4526');
      ctx.strokeStyle = TIER_TRIM[tier];
      ctx.lineWidth = Math.max(1.8, 3 * z);
      ctx.beginPath(); ctx.moveTo(body.A[0], body.A[1]); ctx.lineTo(body.C[0], body.C[1]); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(body.B[0], body.B[1]); ctx.lineTo(body.D[0], body.D[1]); ctx.stroke();
    } else {
      // A flat stone roof with a hatch, and a wheel door on the front face.
      isoDiamond(d, gx + 0.18, gy + 0.18, 1.64, 1.64, C.stoneL, boxH + 3, C.stoneD);
      const [wx, wy] = P(gx + 1.0, gy + 1.76);
      ctx.fillStyle = '#3f4a56';
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(1.3, 2.1 * z);
      ctx.beginPath(); ctx.arc(wx, wy - boxH * 0.55 * z, 10 * z, 0, 6.29); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = TIER_TRIM[tier];
      ctx.lineWidth = Math.max(1.4, 2.2 * z);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(wx - Math.cos(a) * 9 * z, wy - boxH * 0.55 * z - Math.sin(a) * 9 * z);
        ctx.lineTo(wx + Math.cos(a) * 9 * z, wy - boxH * 0.55 * z + Math.sin(a) * 9 * z);
        ctx.stroke();
      }
    }

    // The hoard: coins on a chest, bars beside a vault.
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.1, 1.8 * z);
    if (tier <= 1) {
      ctx.fillStyle = C.gold;
      ctx.beginPath(); ctx.ellipse(body.cx, body.cy, 6 * z, 6 * z, 0, 0, 6.29); ctx.fill(); ctx.stroke();
    } else {
      const [bx, by] = P(gx + 0.42, gy + 1.62);
      for (let row = 0; row <= 1; row++) {
        for (let i = 0; i <= 1 - row; i++) {
          ctx.fillStyle = row === 0 ? C.goldD : C.gold;
          roundRect(ctx, bx - 10 * z + i * 11 * z + row * 5 * z, by - 6 * z - row * 5 * z, 10 * z, 5 * z, 1.2 * z);
          ctx.fill(); ctx.stroke();
        }
      }
    }

  } else if (b.type === 'barr') {
    /*
     * A longhouse that turns into a garrison: the hall grows a storey, the
     * thatch gives way to boarded gables, and at the top the whole ridge is
     * gilded. A player at level 6 should not be looking at a level-1 hut.
     */
    const hallH = (36 + tier * 9) * g;
    const ridgeH = (64 + tier * 10) * g;
    isoBox(d, gx + 0.08, gy + 0.08, s - 0.16, s - 0.16, 9 + tier * 2, C.dirt, C.dirt2, '#a87a41');
    if (tier >= 2) {
      // A stone footing under the timber once the hall is worth defending.
      isoBox(d, gx + 0.34, gy + 0.34, s - 0.68, s - 0.68, 14 * g, C.stoneL, C.stoneD, C.stone);
    }
    isoBox(
      d, gx + 0.42, gy + 0.42, s - 0.84, s - 0.84, hallH,
      '#a8926f', '#5a3a21', '#8c5f39', undefined, tier >= 2 ? 14 * g : 0,
    );
    const eaves = (tier >= 2 ? 14 * g : 0) + hallH;
    isoRoof(d, gx + 0.3, gy + 0.3, s - 0.6, s - 0.6, eaves, eaves + ridgeH,
      TIER_THATCH[tier], TIER_THATCH_D[tier]);

    const [dx2, dy2] = P(gx + s / 2, gy + s - 0.42);
    ctx.fillStyle = '#3f2d1c';
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.2, 2 * z);
    roundRect(ctx, dx2 - 7 * z, dy2 - 26 * z * g, 14 * z, 22 * z * g, 6 * z);
    ctx.fill(); ctx.stroke();

    ctx.lineCap = 'round';
    // One more spear on the rack each tier: a barracks that has trained more.
    for (let i = 0; i < 3 + tier; i++) {
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
    const wallLab = (34 + tier * 7) * g;
    isoBox(d, gx + 0.06, gy + 0.06, s - 0.12, s - 0.12, 9 + tier * 2, C.stone, C.stoneD, '#77848f');
    isoBox(d, gx + 0.26, gy + 0.26, 1.48, 1.48, wallLab, '#8d84a8', '#4c4560', '#6d6584');
    isoRoof(d, gx + 0.16, gy + 0.16, 1.68, 1.68, wallLab, wallLab + 34 + tier * 10,
      TIER_LAB[tier], TIER_LAB_D[tier]);
    if (tier >= 2) {
      // An observatory turret above the roof, capped with a crystal: the tier
      // where the lab stops being a shed with a pot in it.
      const spire = wallLab + 34 + tier * 10;
      isoBox(
        d, gx + 0.72, gy + 0.72, 0.56, 0.56, 18 + tier * 4,
        '#9d94b8', '#4c4560', '#6d6584', undefined, spire - 12,
      );
      const [sx2, sy2] = P(gx + 1, gy + 1);
      const capY = sy2 - (spire - 12 + 18 + tier * 4) * z;
      ctx.fillStyle = tier >= 3 ? C.gold : '#96f0be';
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(1, 1.7 * z);
      ctx.beginPath();
      ctx.moveTo(sx2, capY - 16 * z);
      ctx.lineTo(sx2 + 6 * z, capY - 5 * z);
      ctx.lineTo(sx2, capY + 3 * z);
      ctx.lineTo(sx2 - 6 * z, capY - 5 * z);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // Crystals stood on the plinth, one a tier: the lab is doing more. Set
    // outside the walls, or they read as floating through the roof.
    for (let i = 0; i < tier; i++) {
      const a = 1.2 + i * 1.7;
      const [kx0, ky0] = P(gx + 1 + Math.cos(a) * 0.86, gy + 1 + Math.sin(a) * 0.86);
      const kx = kx0;
      const ky = ky0 - 9 * z;
      ctx.fillStyle = '#96f0be';
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(1, 1.6 * z);
      ctx.beginPath();
      ctx.moveTo(kx, ky - 16 * z);
      ctx.lineTo(kx + 4 * z, ky - 7 * z);
      ctx.lineTo(kx, ky - 2 * z);
      ctx.lineTo(kx - 4 * z, ky - 7 * z);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    const [px, py] = P(gx + s / 2, gy + s / 2);
    const top = py - wallLab * z;

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
    const mount = 30 * g;
    isoBox(d, gx + 0.42, gy + 0.42, 1.16, 1.16, mount, C.stoneL, C.stoneD, C.stone);
    // Sandbags round the emplacement from tier 1, iron-plated at the top.
    for (let i = 0; i < tier * 2; i++) {
      const a = 0.5 + i * 1.05;
      const [bx, by] = P(gx + 1 + Math.cos(a) * 0.66, gy + 1 + Math.sin(a) * 0.66);
      ctx.fillStyle = tier >= 3 ? '#5f6d7d' : '#9c8a63';
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(1, 1.6 * z);
      roundRect(ctx, bx - 6 * z, by - 8 * z, 12 * z, 7 * z, 3 * z);
      ctx.fill(); ctx.stroke();
    }
    const [px, py] = P(gx + s / 2, gy + s / 2);
    const top = py - mount * z;
    ctx.fillStyle = '#3f4a56';
    ctx.strokeStyle = C.line;
    ctx.beginPath(); ctx.ellipse(px, top + 3 * z, (10 + tier) * z, (7 + tier * 0.6) * z, 0, 0, 6.29);
    ctx.fill(); ctx.stroke();

  } else if (b.type === 'tower') {
    isoBox(d, gx + 0.12, gy + 0.12, s - 0.24, s - 0.24, 11, C.stone, C.stoneD, '#77848f');
    const th = 78 + lv * 3;
    isoBox(d, gx + 0.35, gy + 0.35, 1.3, 1.3, th, C.stoneL, C.stoneD, C.stone);
    isoRoof(d, gx + 0.18, gy + 0.18, 1.64, 1.64, th, th + 36,
      enemy ? '#a03828' : TIER_ROOF[tier], enemy ? '#6d2216' : TIER_ROOF_D[tier]);
    // Arrow slits, one more each tier.
    for (let i = 0; i <= tier; i++) {
      const [sx2, sy2] = P(gx + 1, gy + 1.65);
      ctx.fillStyle = '#1b2432';
      roundRect(ctx, sx2 - 2 * z, sy2 - (th - 12 - i * 15) * z, 4 * z, 9 * z, 1.6 * z);
      ctx.fill();
    }
    const [px, py] = P(gx + s / 2, gy + s / 2);
    const top = py - th * z;
    ctx.fillStyle = '#1b2432';
    roundRect(ctx, px - 2.8 * z, top + 22 * z, 5.6 * z, 13 * z, 2.4 * z);
    ctx.fill();

  } else if (b.type === 'statue') {
    // A memorial figure with both hands on a sword point-down, which is the
    // one pose that reads at a glance from across the base. The first draft
    // held the sword aloft on a thin diagonal arm and came out as a featureless
    // white pillar at every zoom anyone actually plays at.
    const plinth = 14 + lv * 3;
    isoBox(d, gx + 0.06, gy + 0.06, s - 0.12, s - 0.12, plinth, '#b9c3cd', '#6e7a86', '#8e9aa6');
    isoBox(d, gx + 0.42, gy + 0.42, s - 0.84, s - 0.84, plinth + 9, '#cfd8e2', '#7e8a97', '#9fabb8');

    const [px, py] = P(gx + s / 2, gy + s / 2);
    const foot = py - (plinth + 9) * z;
    const gild = lv >= 5;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.4, 2.2 * z);

    // Cloak: wider at the hem than at the shoulders, so the silhouette is not
    // a rectangle.
    ctx.fillStyle = '#dfe6ee';
    ctx.beginPath();
    ctx.moveTo(px - 11 * z, foot);
    ctx.lineTo(px - 7 * z, foot - 34 * z);
    ctx.lineTo(px + 7 * z, foot - 34 * z);
    ctx.lineTo(px + 11 * z, foot);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // Shoulders.
    ctx.fillStyle = '#eef3f8';
    roundRect(ctx, px - 9 * z, foot - 40 * z, 18 * z, 8 * z, 3.5 * z);
    ctx.fill(); ctx.stroke();

    // Head, clear of the shoulders so it is a head and not a rounded corner.
    ctx.beginPath();
    ctx.arc(px, foot - 46 * z, 5.6 * z, 0, 6.29);
    ctx.fill(); ctx.stroke();

    // The sword, point down the middle of the cloak.
    ctx.fillStyle = gild ? '#ffd25c' : '#c2ccd8';
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.2, 1.9 * z);
    ctx.beginPath();
    ctx.moveTo(px - 3 * z, foot - 33 * z);
    ctx.lineTo(px + 3 * z, foot - 33 * z);
    ctx.lineTo(px + 1.6 * z, foot - 3 * z);
    ctx.lineTo(px, foot);
    ctx.lineTo(px - 1.6 * z, foot - 3 * z);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Crossguard and pommel.
    roundRect(ctx, px - 9 * z, foot - 36 * z, 18 * z, 4.5 * z, 2 * z);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, foot - 39 * z, 2.8 * z, 0, 6.29);
    ctx.fill(); ctx.stroke();

  } else if (b.type === 'brazier') {
    isoBox(d, gx + 0.14, gy + 0.14, 0.72, 0.72, 7, '#8e9aa6', '#5c6672', '#76818d');
    const [px, py] = P(gx + 0.5, gy + 0.5);
    const top = py - 7 * z;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.4, 2.2 * z);
    ctx.fillStyle = '#4a5460';
    // Three legs.
    for (const dx of [-7, 0, 7]) {
      ctx.beginPath();
      ctx.moveTo(px + dx * z * 0.7, top);
      ctx.lineTo(px + dx * z, top - 16 * z);
      ctx.stroke();
    }
    // Bowl.
    ctx.fillStyle = '#5b6875';
    ctx.beginPath();
    ctx.ellipse(px, top - 18 * z, 10 * z, 5.5 * z, 0, 0, 6.29);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2b3440';
    ctx.beginPath();
    ctx.ellipse(px, top - 19 * z, 7.5 * z, 3.6 * z, 0, 0, 6.29);
    ctx.fill();

  } else if (b.type === 'standard') {
    isoBox(d, gx + 0.2, gy + 0.2, 0.6, 0.6, 8, '#9aa7b4', '#616c79', '#7d8894');
    const [px, py] = P(gx + 0.5, gy + 0.5);
    const foot = py - 8 * z;
    ctx.strokeStyle = C.woodD;
    ctx.lineWidth = Math.max(1.6, 2.6 * z);
    ctx.beginPath();
    ctx.moveTo(px, foot);
    ctx.lineTo(px, foot - (46 + lv * 3) * z);
    ctx.stroke();
    // Finial.
    ctx.fillStyle = '#ffd25c';
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.1, 1.7 * z);
    ctx.beginPath();
    ctx.ellipse(px, foot - (50 + lv * 3) * z, 3.4 * z, 3.4 * z, 0, 0, 6.29);
    ctx.fill(); ctx.stroke();

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
    drawLevelPip(d, px, py - pipHeightOf(b.type, lv) * z, lv);
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
    // Must track the body's own geometry, or the banner flies detached from
    // the roof it is meant to stand on.
    const tier = tierOf(lv);
    const g = growthOf(lv);
    const wallH = (88 + lv * 3) * g;
    const ridge = tier >= 2
      ? wallH + 12 + (22 + tier * 3) + 18   // the lantern's own peak
      : wallH + 34;
    const [px, py] = P(gx + s / 2, gy + s / 2);
    const top = py - ridge * z;
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
    // Anchored to the chimneys and the furnace mouth the body actually draws:
    // both moved when the forge became a smithy, and smoke rising from where
    // a chimney used to be is worse than no smoke at all.
    const tier = tierOf(lv);
    const g = growthOf(lv);
    const stack = 1 + Math.min(2, tier);
    const chimH = (40 + tier * 6) * g;
    for (let c = 0; c < stack; c++) {
      const off = c * 0.32;
      const [px, py] = P(gx + 0.45 + off, gy + 0.45 + off * 0.2);
      const chimney = py - (chimH - c * 7 * g + 6) * z;
      for (let i = 0; i < 3; i++) {
        const p = (t * 0.55 + i * 0.33 + c * 0.2) % 1;
        ctx.fillStyle = `rgba(190,200,212,${(0.36 * (1 - p)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(px + Math.sin(p * 5 + i + c) * 7 * z, chimney - p * 40 * z, (3 + p * 8) * z, 0, 6.29);
        ctx.fill();
      }
    }
    // The fire in the mouth of the furnace.
    const glow = 0.55 + Math.sin(t * 4.5) * 0.2;
    const [ax, ay] = P(gx + 1.28, gy + 1.02);
    ctx.fillStyle = `rgba(255,140,40,${glow.toFixed(2)})`;
    ctx.beginPath(); ctx.ellipse(ax, ay - 7 * z, 8 * z, 6 * z, 0, 0, 6.29); ctx.fill();
    ctx.fillStyle = `rgba(255,214,110,${(glow * 0.7).toFixed(2)})`;
    ctx.beginPath(); ctx.ellipse(ax, ay - 6 * z, 4.5 * z, 3.2 * z, 0, 0, 6.29); ctx.fill();

  } else if (b.type === 'barr') {
    // Follows the ridge the body draws, which now rises with the tier.
    const tb = tierOf(lv);
    const gb = growthOf(lv);
    const K = P(gx + s / 2, gy + s / 2);
    K[1] -= ((tb >= 2 ? 14 * gb : 0) + (36 + tb * 9) * gb + (64 + tb * 10) * gb) * z;
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
    // Same wall the body draws: a glow floating clear of the crucible is
    // worse than no glow.
    const [px, py] = P(gx + s / 2, gy + s / 2);
    const top = py - (34 + tierOf(lv) * 7) * growthOf(lv) * z;
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

  } else if (b.type === 'brazier') {
    const [px, py] = P(gx + 0.5, gy + 0.5);
    const bowl = py - 26 * z;
    // Three tongues on slightly different clocks, so it flickers rather than
    // pulsing. It is the one thing on a maxed base that moves at night.
    for (let i = 0; i < 3; i++) {
      const p = (t * 1.6 + i * 0.37) % 1;
      const h = (9 + p * 13 + Math.sin(t * 7 + i * 2) * 2) * z;
      ctx.fillStyle = i === 0
        ? `rgba(255,214,110,${(0.85 - p * 0.5).toFixed(2)})`
        : `rgba(255,${(120 + i * 30).toFixed(0)},40,${(0.7 - p * 0.5).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(px - (5 - i) * z, bowl);
      ctx.quadraticCurveTo(px + (i - 1) * 4 * z, bowl - h * 0.6, px, bowl - h);
      ctx.quadraticCurveTo(px + (1 - i) * 4 * z, bowl - h * 0.6, px + (5 - i) * z, bowl);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,170,60,.18)';
    ctx.beginPath(); ctx.ellipse(px, bowl + 2 * z, 16 * z, 8 * z, 0, 0, 6.29); ctx.fill();

  } else if (b.type === 'standard') {
    const [px, py] = P(gx + 0.5, gy + 0.5);
    const top = py - (54 + lv * 3) * z;
    const wave = Math.sin(t * 2.2) * 3 * z;
    ctx.fillStyle = bannerColor(enemy);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.2, 1.9 * z);
    ctx.beginPath();
    ctx.moveTo(px, top);
    ctx.lineTo(px + 20 * z + wave, top + 5 * z);
    ctx.lineTo(px + 14 * z + wave, top + 13 * z);
    ctx.lineTo(px + 20 * z + wave, top + 21 * z);
    ctx.lineTo(px, top + 26 * z);
    ctx.closePath(); ctx.fill(); ctx.stroke();

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
