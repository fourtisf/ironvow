import { TROOP, type TroopType } from '@ironvow/config';
import type { DeployableType } from '@ironvow/types';
import { isoX, isoY, w2s } from './camera';
import type { Draw } from './primitives';
import { C } from './palette';
import { drawHpBar, roundRect, shade } from './primitives';
import { blitUnitPart } from './sprites';

/**
 * Troop art and battle effects.
 *
 * Split the way the buildings are, and for the same reason. The kit a troop
 * wears — plate, pauldrons, helm, cloak, shield — does not change between
 * frames, and since the War Lab started tiering it, it is the expensive half:
 * measured at 28 units on a 4x-throttled CPU, drawing it live cost 83 ms a
 * frame against 50 ms without it. So it is rasterised once per (type, level,
 * livery, facing, scale) and blitted, and only the legs, the weapon and the
 * hit bar are still real path work.
 *
 * The parts that move are drawn between the cached ones — cloak, legs, kit,
 * weapon — which is why the kit is two sprites rather than one.
 *
 * `flash` is decayed by the caller in one place for every entity. Prototype
 * bug #4 came from decaying it inside a loop that only visited defensive
 * structures, which left damaged mines washed out for the rest of the battle.
 */

export interface DrawableUnit {
  type: DeployableType;
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
  /**
   * War Lab level for this troop, or the hero's rank. Drives the tier.
   *
   * Cosmetic only — the strength it stands for was applied by the simulation
   * when the raid opened, from the levels the server froze onto it. This is
   * the client reading the same number so a player can see what they bought.
   */
  level?: number;
}

/* ------------------------------------------------------------- tiers --- */

/**
 * Four looks across a troop's War Lab levels, on the same thresholds the
 * buildings use.
 *
 * A troop upgrade used to be a number in a sheet and a slightly longer health
 * bar: nothing on the field changed, so the most expensive thing in the game
 * was also the most invisible. Now the kit changes — leather, then banded
 * steel, then plate with a plume and a cloak, then gilded — and every level in
 * between adds a little size, so even an upgrade inside a tier shows.
 */
export function tierOfTroop(level: number): 0 | 1 | 2 | 3 {
  if (level >= 8) return 3;
  if (level >= 6) return 2;
  if (level >= 3) return 1;
  return 0;
}

/** 2.2% a level: a level-9 troop stands about a fifth taller than a level-1. */
export function growOf(level: number): number {
  return 1 + (level - 1) * 0.022;
}

/** Leather, steel, dark plate, gilded. */
const TIER_PLATE = ['#b9a184', '#c2ccd6', '#a6b3c0', '#e8c86a'] as const;
const TIER_PLATE_D = ['#8a6f52', '#8e9aa6', '#66727f', '#a8802c'] as const;
/** Edging: buckles, brow bands, shield rims. */
const TIER_EDGE = ['#6b4526', '#9aa7b4', '#cfdae6', '#ffd25c'] as const;

/* --------------------------------------------------------------- kit --- */

/**
 * Everything the painters need, worked out once.
 *
 * The painters draw around the origin at a given scale so the same code serves
 * the live path and the sprite rasteriser; `S` is filled in per call because
 * a sprite is measured at scale 1 and rasterised at another.
 */
interface Kit {
  type: DeployableType;
  hero: boolean;
  tier: 0 | 1 | 2 | 3;
  f: 1 | -1;
  team: string;
  teamL: string;
  plate: string;
  plateD: string;
  trim: string;
  col: string;
  col2: string;
  /** Tints everything white while the unit is flashing from a hit. */
  P: (col: string) => string;
  /** False when the unit is too small on screen for the kit to read. */
  detail: boolean;
}

const Yof = (S: number, v: number): number => -v * S;

/* ------------------------------------------------------------ pieces --- */

/** A cloak from tier 2, behind everything: the tier that changes the outline. */
function paintCloak(ctx: CanvasRenderingContext2D, K: Kit, S: number): void {
  const { f, P } = K;
  const Y = (v: number): number => Yof(S, v);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.line;
  ctx.lineWidth = Math.max(1.4, 2.1 * S);
  ctx.fillStyle = P(K.tier >= 3 ? '#c9924f' : shade(K.team, -0.1));
  ctx.beginPath();
  ctx.moveTo(-5 * S * f, Y(27));
  ctx.quadraticCurveTo(-13 * S * f, Y(18), -10 * S * f, Y(6));
  ctx.lineTo(-3 * S * f, Y(8));
  ctx.quadraticCurveTo(-4 * S * f, Y(19), -1 * S * f, Y(27));
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

/** Legs, which walk, and the greaves a troop is issued at tier 1. */
function paintLegs(ctx: CanvasRenderingContext2D, K: Kit, S: number, walk: number): void {
  const { f, P, detail, tier } = K;
  const Y = (v: number): number => Yof(S, v);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.line;
  ctx.lineWidth = Math.max(1.4, 2.1 * S);
  [walk, -walk].forEach((w, i) => {
    ctx.save();
    ctx.translate((i ? 3 : -3) * S, Y(9));
    ctx.rotate(w * 0.42 * f);
    ctx.fillStyle = P('#4a5462');
    roundRect(ctx, -2.4 * S, 0, 4.8 * S, 10 * S, 2.2 * S);
    ctx.fill(); ctx.stroke();
    if (detail && tier >= 1) {
      ctx.fillStyle = P(K.plate);
      roundRect(ctx, -2.6 * S, 4.5 * S, 5.2 * S, 4.5 * S, 1.6 * S);
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  });
}

/**
 * The kit: everything from the belt to the plume, plus whatever is carried in
 * the off hand. None of it moves, so all of it is cached.
 */
function paintKit(ctx: CanvasRenderingContext2D, K: Kit, S: number): void {
  const { f, P, detail, tier, hero, plate, plateD, trim, team, teamL } = K;
  const Y = (v: number): number => Yof(S, v);
  const LW = Math.max(1.4, 2.1 * S);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.line;
  ctx.lineWidth = LW;

  // tunic
  ctx.fillStyle = P(K.col2);
  roundRect(ctx, -7 * S, Y(23), 14 * S, 15 * S, 4.5 * S); ctx.fill(); ctx.stroke();
  if (detail && tier >= 1) {
    // A breastplate over the tunic, and a gorget above it from tier 2.
    ctx.fillStyle = P(plate);
    roundRect(ctx, -5.8 * S, Y(22.5), 11.6 * S, 9.5 * S, 3.4 * S); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = P(shade(plate, 0.45));
    ctx.lineWidth = Math.max(1, 1.3 * S);
    ctx.beginPath();
    ctx.moveTo(-3.4 * S, Y(21.5)); ctx.lineTo(-3.4 * S, Y(15.5));
    ctx.moveTo(3.4 * S, Y(21.5)); ctx.lineTo(3.4 * S, Y(15.5));
    ctx.stroke();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = LW;
    if (tier >= 2) {
      ctx.fillStyle = P(plateD);
      roundRect(ctx, -5 * S, Y(24.5), 10 * S, 3.4 * S, 1.6 * S); ctx.fill(); ctx.stroke();
    }
  }

  // team sash
  ctx.fillStyle = P(team);
  roundRect(ctx, -7 * S, Y(18), 14 * S, 4.5 * S, 2 * S); ctx.fill(); ctx.stroke();
  if (detail && tier >= 3) {
    // A gold buckle: the one piece of the kit a veteran did not get issued.
    ctx.fillStyle = P(C.gold);
    roundRect(ctx, -2.2 * S, Y(18.4), 4.4 * S, 3.6 * S, 1.2 * S); ctx.fill(); ctx.stroke();
  }

  // pauldrons: one at first, both once there is plate to hang them from
  ctx.fillStyle = P(tier >= 1 ? plate : K.col);
  ctx.beginPath(); ctx.ellipse(-7.5 * S * f, Y(22), 4.2 * S, 3.4 * S, 0, 0, 6.29);
  ctx.fill(); ctx.stroke();
  if (detail && tier >= 2) {
    ctx.beginPath(); ctx.ellipse(7.5 * S * f, Y(22), 3.8 * S, 3.1 * S, 0, 0, 6.29);
    ctx.fill(); ctx.stroke();
  }
  if (detail && tier >= 1) {
    // The light catching the top of the shoulder.
    ctx.strokeStyle = P(shade(plate, 0.5));
    ctx.lineWidth = Math.max(1, 1.4 * S);
    ctx.beginPath();
    ctx.ellipse(-7.5 * S * f, Y(22.6), 3 * S, 2.2 * S, 0, Math.PI * 1.1, Math.PI * 1.95);
    ctx.stroke();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = LW;
  }

  // head and helm
  ctx.fillStyle = P('#e6bd93');
  ctx.beginPath(); ctx.arc(0, Y(28.5), 5.4 * S, 0, 6.29); ctx.fill(); ctx.stroke();
  const helm = hero ? '#e8b23c'
    : tier >= 1 ? plate
    : K.type === 'archer' ? '#3f7a44'
    // A hood rather than a helm: nothing that climbs a wall wears steel.
    : K.type === 'scaler' ? '#6d4a8f'
    : '#9aa7b4';
  ctx.fillStyle = P(helm);
  ctx.beginPath(); ctx.arc(0, Y(29.5), 5.8 * S, Math.PI * 1.03, Math.PI * 2.02); ctx.fill(); ctx.stroke();
  if (detail && tier >= 1 && !hero) {
    // A brow band, and a nasal bar from tier 2: the helm gets closed as the
    // troop gets promoted.
    ctx.fillStyle = P(trim);
    roundRect(ctx, -6 * S, Y(29.6), 12 * S, 2.4 * S, 1 * S); ctx.fill(); ctx.stroke();
    if (tier >= 2) {
      roundRect(ctx, -1.1 * S, Y(29.6), 2.2 * S, 5 * S, 0.8 * S); ctx.fill(); ctx.stroke();
    }
  }
  if (detail && tier >= 2 && !hero) {
    // A plume, swept back off the helm.
    ctx.fillStyle = P(tier >= 3 ? '#ffd25c' : teamL);
    ctx.lineWidth = Math.max(1.1, 1.5 * S);
    ctx.beginPath();
    ctx.moveTo(-2.2 * S, Y(33));
    ctx.quadraticCurveTo(-1 * S * f, Y(43), 8 * S * f, Y(41));
    ctx.quadraticCurveTo(1 * S * f, Y(39), 2.2 * S, Y(33));
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = LW;
  }
  if (hero) {
    // A crown rather than a plume, so the hero reads as the hero even at the
    // zoom where every other unit is a smudge.
    ctx.fillStyle = P('#ffd25c');
    ctx.beginPath();
    ctx.moveTo(-6 * S, Y(34));
    ctx.lineTo(-6 * S, Y(39));
    ctx.lineTo(-3 * S, Y(36.5));
    ctx.lineTo(0, Y(40));
    ctx.lineTo(3 * S, Y(36.5));
    ctx.lineTo(6 * S, Y(39));
    ctx.lineTo(6 * S, Y(34));
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  if (K.type === 'lancer' && tier < 2) {
    ctx.fillStyle = P(team);
    roundRect(ctx, -1.6 * S, Y(38), 3.2 * S, 6 * S, 1.4 * S); ctx.fill(); ctx.stroke();
  }

  // What the off hand carries. Drawn under the weapon rather than over it, so
  // the swing always reads.
  if (K.type === 'raider') {
    const shieldW = (4.6 + tier * 0.5) * S;
    const shieldH = (6 + tier * 0.7) * S;
    ctx.fillStyle = P(team);
    ctx.beginPath(); ctx.ellipse(-8 * S * f, Y(18), shieldW, shieldH, 0, 0, 6.29);
    ctx.fill(); ctx.stroke();
    if (detail && tier >= 1) {
      ctx.strokeStyle = P(trim);
      ctx.lineWidth = Math.max(1.2, 1.7 * S);
      ctx.beginPath();
      ctx.ellipse(-8 * S * f, Y(18), shieldW - 1.2 * S, shieldH - 1.2 * S, 0, 0, 6.29);
      ctx.stroke();
      ctx.fillStyle = P(tier >= 3 ? C.gold : plate);
      ctx.beginPath(); ctx.arc(-8 * S * f, Y(18), 1.8 * S, 0, 6.29); ctx.fill();
      ctx.strokeStyle = C.line;
      ctx.lineWidth = LW;
    }
  } else if (K.type === 'archer' && detail && tier >= 1) {
    // A quiver, once there is something worth carrying spares of.
    ctx.save();
    ctx.translate(-7 * S * f, Y(23));
    ctx.rotate(0.35 * f);
    ctx.fillStyle = P(C.woodD);
    roundRect(ctx, -2.4 * S, -6 * S, 4.8 * S, 12 * S, 2 * S); ctx.fill(); ctx.stroke();
    ctx.fillStyle = P('#f2e4c4');
    for (let i = 0; i < 1 + tier; i++) {
      roundRect(ctx, (-2 + i * 1.5) * S, -9 * S, 1.2 * S, 4 * S, 0.6 * S); ctx.fill();
    }
    ctx.restore();
  } else if (K.type === 'scaler') {
    // A coil of rope at the hip, so it reads as a climber standing still too.
    ctx.fillStyle = P('#d8c9a8');
    ctx.beginPath();
    ctx.ellipse(-8 * S * f, Y(17), (4.4 + tier * 0.4) * S, (3 + tier * 0.3) * S, 0, 0, 6.29);
    ctx.fill(); ctx.stroke();
  } else if (K.type === 'lancer' || hero) {
    const shx = -12 * S * f;
    const shw = (8 + tier) * S;
    const shh = (16 + tier) * S;
    ctx.fillStyle = P(team);
    roundRect(ctx, shx, Y(25), shw, shh, 3 * S); ctx.fill(); ctx.stroke();
    if (detail && tier >= 1) {
      ctx.strokeStyle = P(trim);
      ctx.lineWidth = Math.max(1.2, 1.7 * S);
      roundRect(ctx, shx + 1.6 * S, Y(25) + 1.6 * S, shw - 3.2 * S, shh - 3.2 * S, 2.2 * S);
      ctx.stroke();
      if (tier >= 2) {
        ctx.fillStyle = P(tier >= 3 ? C.gold : plate);
        ctx.beginPath();
        ctx.arc(shx + shw / 2, Y(25) + shh / 2, 2.2 * S, 0, 6.29);
        ctx.fill(); ctx.stroke();
      }
      ctx.strokeStyle = C.line;
      ctx.lineWidth = LW;
    }
  }
}

/** The weapon, which swings, and is therefore the only thing drawn live. */
function paintWeapon(ctx: CanvasRenderingContext2D, K: Kit, S: number, sw: number): void {
  const { f, P, detail, tier, hero } = K;
  const Y = (v: number): number => Yof(S, v);
  const LW = Math.max(1.4, 2.1 * S);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.line;
  ctx.lineWidth = LW;

  if (K.type === 'raider') {
    // A blade that grows a fuller and then gilds.
    ctx.save();
    ctx.translate(7 * S * f, Y(20));
    ctx.rotate((-0.7 + sw * 1.5) * f);
    ctx.fillStyle = P(tier >= 3 ? '#ffe08a' : '#cfdae6');
    const blade = (17 + tier * 2) * S;
    roundRect(ctx, 0, -(1.8 + tier * 0.25) * S, blade, (3.6 + tier * 0.5) * S, 1.6 * S);
    ctx.fill(); ctx.stroke();
    if (detail && tier >= 1) {
      ctx.strokeStyle = P(shade('#cfdae6', -0.3));
      ctx.lineWidth = Math.max(1, 1.2 * S);
      ctx.beginPath(); ctx.moveTo(2 * S, 0); ctx.lineTo(blade - 2 * S, 0); ctx.stroke();
      ctx.strokeStyle = C.line;
      ctx.lineWidth = LW;
    }
    ctx.fillStyle = P(tier >= 3 ? C.gold : tier >= 1 ? K.trim : C.woodD);
    roundRect(ctx, -4.5 * S, -(2.4 + tier * 0.4) * S, 5 * S, (4.8 + tier * 0.8) * S, 2 * S);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  } else if (K.type === 'archer') {
    const bow = (8 + tier * 1.1) * S;
    ctx.strokeStyle = P(tier >= 3 ? C.gold : tier >= 2 ? K.plate : C.woodD);
    ctx.lineWidth = Math.max(1.6, (2.2 + tier * 0.3) * S);
    ctx.beginPath(); ctx.arc(6 * S * f, Y(21), bow, -1.1, 1.1); ctx.stroke();
    ctx.strokeStyle = P('#f2e4c4');
    ctx.lineWidth = Math.max(1, 1.2 * S);
    ctx.beginPath();
    ctx.moveTo(6 * S * f + bow * Math.cos(-1.1) * f, Y(21) + bow * Math.sin(-1.1));
    ctx.lineTo((3 - sw * 3) * S * f, Y(21));
    ctx.lineTo(6 * S * f + bow * Math.cos(1.1) * f, Y(21) + bow * Math.sin(1.1));
    ctx.stroke();
  } else if (K.type === 'scaler') {
    // A grapnel on a line, swung overhead. It is the silhouette that has to
    // say "this one does not care about your wall" from across the field.
    ctx.save();
    ctx.translate(5 * S * f, Y(26));
    ctx.rotate((-0.4 + sw * 2.4) * f);
    ctx.strokeStyle = P('#d8c9a8');
    ctx.lineWidth = Math.max(1.2, 1.7 * S);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(7 * S, -9 * S, 14 * S, -4 * S);
    ctx.stroke();
    ctx.strokeStyle = P(tier >= 3 ? C.gold : '#cfdae6');
    ctx.lineWidth = Math.max(1.6, (2.4 + tier * 0.3) * S);
    ctx.beginPath();
    ctx.moveTo(14 * S, -8 * S); ctx.lineTo(14 * S, -2 * S);
    ctx.moveTo(10.5 * S, -5 * S); ctx.lineTo(17.5 * S, -5 * S);
    if (detail && tier >= 2) {
      // A third and fourth prong: a grapnel that bites.
      ctx.moveTo(12 * S, -8.5 * S); ctx.lineTo(16 * S, -1.5 * S);
      ctx.moveTo(16 * S, -8.5 * S); ctx.lineTo(12 * S, -1.5 * S);
    }
    ctx.stroke();
    ctx.restore();
  } else {
    // Lancer and hero both swing a polearm. It lengthens, gains a pennon,
    // and gilds.
    ctx.save();
    ctx.translate(6 * S * f, Y(21));
    ctx.rotate((-1.35 + sw * 0.9) * f);
    ctx.strokeStyle = P(C.woodD);
    ctx.lineWidth = Math.max(1.6, 2.4 * S);
    const haft = (22 + tier * 2) * S;
    ctx.beginPath(); ctx.moveTo(0, 8 * S); ctx.lineTo(0, -haft); ctx.stroke();
    if (detail && tier >= 2) {
      ctx.fillStyle = P(tier >= 3 ? C.gold : K.team);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(1.2, 1.7 * S);
      ctx.beginPath();
      ctx.moveTo(0, -haft + 4 * S);
      ctx.lineTo(9 * S, -haft + 7 * S);
      ctx.lineTo(0, -haft + 11 * S);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = P(tier >= 3 ? '#ffe08a' : '#cfdae6');
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(1.2, 1.7 * S);
    const head = (8 + tier * 1.6) * S;
    ctx.beginPath();
    ctx.moveTo(0, -haft - head);
    ctx.lineTo((4 + tier * 0.5) * S, -haft);
    ctx.lineTo(-(4 + tier * 0.5) * S, -haft);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    void hero;
  }
}

/**
 * A siege engine that is plainly a bigger engine each tier: a heavier head,
 * iron banding down the beam, a roof over the crew, and a gilded cap at the
 * top. Nothing on it moves, so the whole thing is one sprite.
 */
function paintRam(ctx: CanvasRenderingContext2D, K: Kit, S: number): void {
  const { f, P, detail, tier, team } = K;
  const Y = (v: number): number => Yof(S, v);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.line;
  ctx.lineWidth = Math.max(1.4, 2.1 * S);

  if (detail && tier >= 2) {
    /*
     * A hide roof on four posts, standing clear above the crew's heads. The
     * first attempt put it at the height they were already occupying and the
     * whole engine came out as a bus.
     */
    ctx.fillStyle = P(C.woodD);
    for (const o of [-15, 15]) {
      roundRect(ctx, o * S - 1.4 * S, Y(35), 2.8 * S, 12 * S, 1.2 * S);
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = P(tier >= 3 ? '#c9924f' : '#8a6f52');
    ctx.beginPath();
    ctx.moveTo(-19 * S, Y(35));
    ctx.lineTo(0, Y(41));
    ctx.lineTo(19 * S, Y(35));
    ctx.lineTo(17 * S, Y(33));
    ctx.lineTo(0, Y(38.5));
    ctx.lineTo(-17 * S, Y(33));
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = P('#7a4f28');
  roundRect(ctx, -15 * S, Y(15), 30 * S, 9 * S, 3 * S); ctx.fill(); ctx.stroke();
  ctx.fillStyle = P(C.wood);
  roundRect(ctx, -17 * S, Y(11), 34 * S, 8 * S, 3.5 * S); ctx.fill(); ctx.stroke();
  if (detail && tier >= 1) {
    // Iron bands along the beam, one more each tier.
    ctx.fillStyle = P(K.plate);
    for (let i = 0; i <= tier; i++) {
      const o = -12 + i * (24 / Math.max(1, tier));
      roundRect(ctx, o * S, Y(11.5), 2.6 * S, 9 * S, 1 * S); ctx.fill(); ctx.stroke();
    }
  }
  // The head: heavier and better shod every tier.
  ctx.fillStyle = P(tier >= 3 ? C.gold : tier >= 1 ? K.plate : '#3f4a56');
  ctx.beginPath(); ctx.arc(17 * S * f, Y(15), (4 + tier * 0.9) * S, 0, 6.29);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2b3440';
  for (const o of tier >= 1 ? [-13, -4.5, 4.5, 13] : [-8, 8]) {
    ctx.beginPath(); ctx.arc(o * S, Y(2.5), 3.6 * S, 0, 6.29); ctx.fill(); ctx.stroke();
  }
  // Crew: two at first, three once the engine is worth the extra hands.
  for (const o of tier >= 2 ? [-12, -1.5, 9] : [-9, 7]) {
    ctx.fillStyle = P(team);
    roundRect(ctx, o * S, Y(24), 6.5 * S, 9 * S, 2.5 * S); ctx.fill(); ctx.stroke();
    ctx.fillStyle = P('#e0b88f');
    ctx.beginPath(); ctx.arc((o + 3.2) * S, Y(27), 3.6 * S, 0, 6.29); ctx.fill(); ctx.stroke();
  }
}

/* -------------------------------------------------------------- draw --- */

export function drawUnit(d: Draw, u: DrawableUnit): void {
  paint(d, u, true);
}

/**
 * The same unit with nothing cached.
 *
 * This is the path a flashing unit already takes, and it is the one the tests
 * can reach: the sprite cache needs a canvas to rasterise into, and the render
 * tests run without a DOM. Since both paths call the same painters, asserting
 * the clock-independence of this one asserts it for the cached one too — which
 * is the invariant that matters, because a painter that read the clock would
 * bake one frame into every troop of its kind.
 */
export function drawUnitUncached(d: Draw, u: DrawableUnit): void {
  paint(d, u, false);
}

function paint(d: Draw, u: DrawableUnit, useCache: boolean): void {
  const { ctx, cam, vp, t } = d;
  const z = cam.z;
  const hero = u.type === 'hero';
  // The hero borrows the lancer's silhouette and then departs from it: larger,
  // gold-liveried, crowned. It has to be findable at a glance in a crowd of
  // twenty identical raiders, because deciding where it is standing is the
  // whole point of having one.
  const def = hero ? TROOP.lancer : TROOP[u.type as TroopType];
  const lv = Math.max(1, Math.min(9, Math.round(u.level ?? 1)));
  const tier = tierOfTroop(lv);
  const [sx, sy] = w2s(cam, vp, isoX(u.x, u.y), isoY(u.x, u.y));
  const S = (u.type === 'ram' ? 1.5 : hero ? 1.35 : 1) * 2.0 * z * growOf(lv);
  const team = hero ? '#e8b23c' : u.mine ? '#3f7fd6' : '#c2412d';
  const teamL = hero ? '#ffd97a' : u.mine ? '#6ba4f0' : '#e0684f';
  const walk = u.moving ? Math.sin(t * 11 + u.born * 7) : 0;
  const bob = u.moving ? Math.abs(Math.sin(t * 11 + u.born * 7)) * 1.1 * S : 0;
  const flashing = u.flash > 0;

  /*
   * `detail` switches the kit off once a unit is under about eleven screen
   * pixels tall, which is the point at which a pauldron is one pixel and
   * costs a path anyway.
   */
  const K: Kit = {
    type: u.type,
    hero,
    tier,
    f: u.face,
    team,
    teamL,
    plate: TIER_PLATE[tier],
    plateD: TIER_PLATE_D[tier],
    trim: TIER_EDGE[tier],
    col: def.col,
    col2: def.col2,
    P: flashing ? (): string => '#ffd8c2' : (c: string): string => c,
    detail: S > 1.15,
  };

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = 'rgba(20,40,18,.3)';
  ctx.beginPath(); ctx.ellipse(sx, sy + 1.5 * z, 8.5 * S, 4 * S, 0, 0, 6.29); ctx.fill();
  ctx.strokeStyle = teamL;
  ctx.lineWidth = Math.max(1.5, 1.5 * S);
  ctx.beginPath(); ctx.ellipse(sx, sy + 1.5 * z, 8 * S, 3.6 * S, 0, 0, 6.29); ctx.stroke();

  const ay = sy - bob;
  /*
   * A flashing unit is drawn live.
   *
   * The flash repaints every colour, so caching it would double the number of
   * sprites for a state that lasts a fifth of a second — and only a handful of
   * units are ever taking a hit at once, so paying full price for those is
   * cheaper than holding a second bitmap for every troop in the game.
   */
  const cached = useCache && !flashing;
  /*
   * `detail` belongs in the key.
   *
   * The bounds of a shape are measured once, at scale 1, and reused for every
   * scale after — so a troop first seen zoomed out, without its plume or its
   * cloak, would hand those measurements to the same troop seen close up and
   * clip the kit off at the edge of the bitmap.
   */
  const shape = (part: string): string =>
    `u|${u.type}|${lv}|${u.mine ? 1 : 0}|${u.face}|${K.detail ? 1 : 0}|${part}`;
  const live = (paint: (c: CanvasRenderingContext2D, s: number) => void): void => {
    ctx.save();
    ctx.translate(sx, ay);
    paint(ctx, S);
    ctx.restore();
  };

  if (u.type === 'ram') {
    if (cached) blitUnitPart(d, shape('ram'), S, sx, ay, (c, s) => paintRam(c, K, s));
    else live((c, s) => paintRam(c, K, s));
  } else {
    if (K.detail && tier >= 2) {
      if (cached) blitUnitPart(d, shape('cloak'), S, sx, ay, (c, s) => paintCloak(c, K, s));
      else live((c, s) => paintCloak(c, K, s));
    }
    live((c, s) => paintLegs(c, K, s, walk));
    if (cached) blitUnitPart(d, shape('kit'), S, sx, ay, (c, s) => paintKit(c, K, s));
    else live((c, s) => paintKit(c, K, s));
    live((c, s) => paintWeapon(c, K, s, u.swing));
  }

  if (u.hp < u.maxHp) {
    drawHpBar(
      d, sx, sy - (u.type === 'ram' ? 34 : hero ? 44 : 41) * S - bob,
      (hero ? 40 : 30) * z, u.hp / u.maxHp,
    );
  }
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
