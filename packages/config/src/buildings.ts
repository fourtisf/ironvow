import { KEEP_MAX } from './world.js';
import { ipow } from './math.js';

export const BUILDING_TYPES = [
  'keep', 'mine', 'forge', 'store', 'barr', 'camp', 'lab', 'cannon', 'tower', 'wall',
  'statue', 'brazier', 'standard',
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

/**
 * `vanity` is the odd one out and deliberately so: it costs, it occupies a
 * cell, and it does nothing. See VANITY_NOTE below.
 */
export type BuildingCategory = 'core' | 'eco' | 'mil' | 'def' | 'vanity';

export interface Cost {
  g: number;
  i: number;
}

export interface BuildingDef {
  /** Display name. */
  n: string;
  /** Footprint, in cells, square. */
  s: number;
  cat: BuildingCategory;
  /** Level 1 hit points. */
  hp: number;
  /** hp = hp * hpG^(level-1) */
  hpG: number;
  /** Cost of the first one of this type; scaled by 1.55^owned. */
  base: Cost;
  /** Level 1 -> 2 upgrade cost; scaled by upG^(level-1). */
  up: Cost;
  upG: number;
  /**
   * How steeply the price of the *next* one of these rises with how many you
   * already own. See NEW_BUILDING_GROWTH for why ramparts differ.
   */
  countG: number;
  blurb: string;
}

/**
 * Default growth for a new building of a type you already own some of.
 *
 * Spec S6: `newBuildingCost = firstCost x 1.55^owned`.
 */
export const NEW_BUILDING_GROWTH = 1.55;

/**
 * Ramparts grow far more gently, and this is a deliberate departure from S6.
 *
 * BALANCE CHANGE — NEEDS SIGN-OFF.
 *
 * Applying 1.55^owned to ramparts contradicts the count table in the same
 * section. The table permits 320 of them at Keep 9. The most gold a player can
 * ever hold is 91,900 (Keep 9 with six level-9 Vaults). Under 1.55 the
 * eighteenth rampart costs 103,226 — more than anyone can hold at any point in
 * the game — so seventeen is the real ceiling, forever, against a table
 * promising 320.
 *
 * It also breaks a War Order: q8 asks for eight ramparts, which costs 3,525
 * cumulative against a Keep 1 storage cap of 2,500.
 *
 * That formula is plainly meant for buildings you own three to twelve of, and
 * ramparts landed under it because one function priced everything. 1.012 puts
 * a full 320-rampart wall at about 222,000 gold — roughly six per cent of the
 * cost of every other building taken to level 9 — which is a defensive layer
 * you lay down across the whole game rather than one you finish or cannot
 * start. Ramparts also block pathing (S4), so they have to be layable in bulk
 * for that mechanic to exist at all.
 *
 * Change this one number to retune it; nothing else needs to move.
 */
export const RAMPART_COUNT_GROWTH = 1.012;

export const TYPES: Record<BuildingType, BuildingDef> = {
  keep:   { n: 'Keep',        s: 3, cat: 'core', hp: 1500, hpG: 1.32, base: { g: 0,   i: 0   }, up: { g: 900, i: 260 }, upG: 2.05, countG: NEW_BUILDING_GROWTH, blurb: 'The heart of the hold. Raise it to unlock everything else.' },
  mine:   { n: 'Gold Mine',   s: 2, cat: 'eco',  hp: 420,  hpG: 1.24, base: { g: 150, i: 0   }, up: { g: 260, i: 40  }, upG: 1.85, countG: NEW_BUILDING_GROWTH, blurb: 'Digs gold around the clock. Tap the pouch to collect.' },
  forge:  { n: 'Iron Forge',  s: 2, cat: 'eco',  hp: 460,  hpG: 1.24, base: { g: 400, i: 0   }, up: { g: 520, i: 90  }, upG: 1.85, countG: NEW_BUILDING_GROWTH, blurb: 'Smelts iron for archers and rams. Tap the ingot to collect.' },
  store:  { n: 'Vault',       s: 2, cat: 'eco',  hp: 700,  hpG: 1.28, base: { g: 320, i: 0   }, up: { g: 480, i: 120 }, upG: 1.90, countG: NEW_BUILDING_GROWTH, blurb: 'Raises how much gold and iron you can hold at once.' },
  barr:   { n: 'Barracks',    s: 3, cat: 'mil',  hp: 640,  hpG: 1.26, base: { g: 280, i: 60  }, up: { g: 440, i: 140 }, upG: 1.90, countG: NEW_BUILDING_GROWTH, blurb: 'Trains troops, and its level is what unlocks new ones.' },
  /*
   * The Muster Field. See CAMP_NOTE below.
   *
   * Four cells square, which is large for what it costs, and deliberately: it
   * is the only building whose point is the ground it occupies. The warband
   * stands on it.
   */
  camp:   { n: 'Muster Field', s: 4, cat: 'mil',  hp: 700,  hpG: 1.24, base: { g: 300, i: 60  }, up: { g: 400, i: 120 }, upG: 1.88, countG: NEW_BUILDING_GROWTH, blurb: 'Ground for your warband to stand on. More fields, more troops.' },
  // TUNABLE. Spec S8.3 asks for a lab but does not price one.
  lab:    { n: 'War Lab',     s: 2, cat: 'mil',  hp: 520,  hpG: 1.26, base: { g: 600, i: 200 }, up: { g: 700, i: 400 }, upG: 1.95, countG: NEW_BUILDING_GROWTH, blurb: 'Makes your troops stronger, not just more numerous.' },
  cannon: { n: 'Cannon',      s: 2, cat: 'def',  hp: 560,  hpG: 1.30, base: { g: 220, i: 80  }, up: { g: 340, i: 180 }, upG: 1.92, countG: NEW_BUILDING_GROWTH, blurb: 'Slow, heavy shots. Wrecks anything that walks into range.' },
  tower:  { n: 'Arrow Tower', s: 2, cat: 'def',  hp: 400,  hpG: 1.27, base: { g: 180, i: 120 }, up: { g: 280, i: 220 }, upG: 1.92, countG: NEW_BUILDING_GROWTH, blurb: 'Fast arrows with long reach. Melts light troops.' },
  wall:   { n: 'Rampart',     s: 1, cat: 'def',  hp: 340,  hpG: 1.35, base: { g: 60,  i: 20  }, up: { g: 90,  i: 60  }, upG: 1.70, countG: RAMPART_COUNT_GROWTH, blurb: 'Blocks the path. Enemies must stop and break it.' },

  /*
   * VANITY_NOTE — TUNABLE, and not in the build document.
   *
   * Added because a maxed hold has nowhere to put its gold. Every other sink
   * in the game closes: mines cap, vaults cap, ramparts cap, and the only
   * thing left is "finish now" on timers a rich player was never waiting for
   * anyway. Resources that accumulate with nothing to buy make collecting —
   * the interaction a player performs more than any other — feel pointless.
   *
   * These cost gold only, and a lot of it, rising steeply with how many you
   * own and again with each level. They carry no loot, mount no defence, and
   * are left out of raid snapshots entirely, so nobody is ever rewarded for
   * attacking one and nobody is ever punished for owning one. They are there
   * to be looked at, which for a game with no purchases is the honest version
   * of something to spend on.
   */
  statue:   { n: 'Vow Statue', s: 2, cat: 'vanity', hp: 900, hpG: 1.2, base: { g: 24000, i: 0 }, up: { g: 18000, i: 0 }, upG: 1.90, countG: 1.90, blurb: 'Stone kept for its own sake. Costs a fortune, does nothing.' },
  brazier:  { n: 'Brazier',    s: 1, cat: 'vanity', hp: 260, hpG: 1.2, base: { g: 4200,  i: 0 }, up: { g: 3200,  i: 0 }, upG: 1.75, countG: 1.55, blurb: 'A fire that burns all night. Purely so the hold looks lived in.' },
  standard: { n: 'Standard',   s: 1, cat: 'vanity', hp: 220, hpG: 1.2, base: { g: 7500,  i: 0 }, up: { g: 5600,  i: 0 }, upG: 1.80, countG: 1.62, blurb: 'Your colours on a pole. Raiders will not care. You might.' },
};

/*
 * CAMP_NOTE — the Muster Field, and why warband room moved off the Barracks.
 *
 * ALFA: "lapanganya harus di beli dan awal pemain udh dpt 2 maximal 10 bisa
 * beli setiap beli harga naik dan bisa di upgrade juga ke level 10 tambah
 * besar dan tambah beda designya"
 *
 * The warband already stood on a field in front of the Barracks, but the field
 * was scenery: it appeared because troops existed, it could not be bought,
 * moved, upgraded or destroyed, and it cost nothing. Scenery is the one thing a
 * base builder cannot afford to make of the army, because room for troops is
 * one of the two things a player is actually saving up for.
 *
 * So the field is a building now. It is bought, priced off how many you own
 * like everything else; it is placed and moved where you want it; it is
 * upgraded; and it is what carries warband capacity. The Barracks keeps what it
 * was always better at — training, and gating which troops exist at all.
 *
 * Two of them are given to a new hold outright. That is not generosity, it is
 * the same number of slots the opening Barracks used to hand over: without it
 * a new player would open the game with a warband of nothing and a tutorial
 * telling them to train five Raiders. STARTING_CAMPS is that promise, and the
 * assertion under it is what stops the cap table from quietly breaking it.
 *
 * The ceiling is ten, at Keep 9, and each one upgrades along with the Keep like
 * everything else in the hold. Levels stop at KEEP_MAX because nothing may ever
 * exceed the Keep — a field that could outrank it would be the only thing in
 * the game that does.
 */

/** Fields a new hold is given, and the most any hold may ever own. */
export const STARTING_CAMPS = 2;
export const MAX_CAMPS = 10;

/** True for something bought to be looked at. */
export function isVanity(type: BuildingType): boolean {
  return TYPES[type].cat === 'vanity';
}

/**
 * How many of each type a player may own, indexed by Keep level 1..9.
 * Index 0 is unused and held at 0 so an out-of-range read cannot grant a build.
 */
export const CAP: Record<Exclude<BuildingType, 'keep'>, readonly number[]> = {
  mine:   [0,  3,  4,  5,  6,   7,   8,   9,  10,  12],
  forge:  [0,  1,  2,  3,  4,   5,   6,   7,   8,   9],
  store:  [0,  1,  2,  2,  3,   3,   4,   4,   5,   6],
  barr:   [0,  1,  1,  2,  2,   3,   3,   4,   4,   5],
  // Two to start with and ten at the end; see STARTING_CAMPS.
  camp:   [0,  2,  3,  4,  5,   6,   7,   8,   9,  10],
  // One lab, ever, from Keep 3. Its level is what gates troop levels.
  lab:    [0,  0,  0,  1,  1,   1,   1,   1,   1,   1],
  cannon: [0,  2,  3,  4,  5,   6,   8,   9,  10,  12],
  tower:  [0,  0,  2,  3,  4,   5,   6,   8,   9,  11],
  wall:   [0, 20, 40, 65, 95, 130, 170, 215, 265, 320],
  // Vanity opens at Keep 3, by which point a player has somewhere to put it
  // and something to spare. The counts rise slowly: the sink is meant to be
  // the price and the levels, not a field full of statues.
  statue:   [0, 0, 0, 1, 1, 2, 2, 3, 3, 4],
  brazier:  [0, 0, 0, 2, 3, 4, 5, 6, 8, 10],
  standard: [0, 0, 0, 2, 2, 3, 4, 5, 6, 8],
};

/** How many of `type` a Keep of `keepLevel` permits. The Keep itself is always 1. */
export function capOf(type: BuildingType, keepLevel: number): number {
  if (type === 'keep') return 1;
  const row = CAP[type];
  return row[Math.min(Math.max(keepLevel, 0), KEEP_MAX)] ?? 0;
}

/** hp = round(baseHp * hpGrowth^(level-1)) */
export function hpOf(type: BuildingType, level: number): number {
  const d = TYPES[type];
  return Math.round(d.hp * ipow(d.hpG, level - 1));
}

/**
 * Cost of a build or an upgrade.
 *
 * `level === 0` means "buy a new one", priced off how many you already own.
 * Any other level is the cost to take that building from `level` to `level + 1`.
 */
export function costOf(type: BuildingType, level: number, owned: number): Cost {
  const d = TYPES[type];
  if (level === 0) {
    return {
      g: Math.round(d.base.g * ipow(d.countG, owned)),
      i: Math.round(d.base.i * ipow(d.countG, owned)),
    };
  }
  return {
    g: Math.round(d.up.g * ipow(d.upG, level - 1)),
    i: Math.round(d.up.i * ipow(d.upG, level - 1)),
  };
}

/** Defensive fire. Range in cells, cooldown in seconds. */
export const DEF_STAT: Partial<Record<BuildingType, (lv: number) => { rng: number; dmg: number; cd: number }>> = {
  cannon: (lv) => ({ rng: 4.4, dmg: 30 + lv * 11, cd: 1.05 }),
  tower:  (lv) => ({ rng: 6.2, dmg: 11 + lv * 4.4, cd: 0.42 }),
};

export function isDefensive(type: BuildingType): boolean {
  return TYPES[type].cat === 'def';
}

/*
 * The opening promise, checked at module load.
 *
 * A new hold is handed STARTING_CAMPS fields, and the cap table is what says
 * whether it is allowed to keep them. If someone lowers the Keep 1 row the
 * game would ship holds that are over their own limit from the first frame —
 * which reads, downstream, as a build button that never enables.
 */
{
  const atKeepOne = CAP.camp[1] ?? 0;
  if (atKeepOne < STARTING_CAMPS) {
    throw new Error(
      `A new hold is given ${STARTING_CAMPS} Muster Fields but CAP.camp allows `
      + `only ${atKeepOne} at Keep 1. Raise the cap row or lower STARTING_CAMPS.`,
    );
  }
  const atKeepMax = CAP.camp[KEEP_MAX] ?? 0;
  if (atKeepMax !== MAX_CAMPS) {
    throw new Error(
      `MAX_CAMPS is ${MAX_CAMPS} but CAP.camp tops out at ${atKeepMax}. `
      + 'They are the same promise written twice; make them agree.',
    );
  }
}
