import { KEEP_MAX } from './world.js';
import { ipow } from './math.js';

export const BUILDING_TYPES = [
  'keep', 'mine', 'forge', 'store', 'barr', 'cannon', 'tower', 'wall',
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export type BuildingCategory = 'core' | 'eco' | 'mil' | 'def';

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
  blurb: string;
}

export const TYPES: Record<BuildingType, BuildingDef> = {
  keep:   { n: 'Keep',        s: 3, cat: 'core', hp: 1500, hpG: 1.32, base: { g: 0,   i: 0   }, up: { g: 900, i: 260 }, upG: 2.05, blurb: 'The heart of the hold. Raise it to unlock everything else.' },
  mine:   { n: 'Gold Mine',   s: 2, cat: 'eco',  hp: 420,  hpG: 1.24, base: { g: 150, i: 0   }, up: { g: 260, i: 40  }, upG: 1.85, blurb: 'Digs gold around the clock. Tap the pouch to collect.' },
  forge:  { n: 'Iron Forge',  s: 2, cat: 'eco',  hp: 460,  hpG: 1.24, base: { g: 400, i: 0   }, up: { g: 520, i: 90  }, upG: 1.85, blurb: 'Smelts iron for archers and rams. Tap the ingot to collect.' },
  store:  { n: 'Vault',       s: 2, cat: 'eco',  hp: 700,  hpG: 1.28, base: { g: 320, i: 0   }, up: { g: 480, i: 120 }, upG: 1.90, blurb: 'Raises how much gold and iron you can hold at once.' },
  barr:   { n: 'Barracks',    s: 3, cat: 'mil',  hp: 640,  hpG: 1.26, base: { g: 280, i: 60  }, up: { g: 440, i: 140 }, upG: 1.90, blurb: 'Trains troops and adds room in your warband.' },
  cannon: { n: 'Cannon',      s: 2, cat: 'def',  hp: 560,  hpG: 1.30, base: { g: 220, i: 80  }, up: { g: 340, i: 180 }, upG: 1.92, blurb: 'Slow, heavy shots. Wrecks anything that walks into range.' },
  tower:  { n: 'Arrow Tower', s: 2, cat: 'def',  hp: 400,  hpG: 1.27, base: { g: 180, i: 120 }, up: { g: 280, i: 220 }, upG: 1.92, blurb: 'Fast arrows with long reach. Melts light troops.' },
  wall:   { n: 'Rampart',     s: 1, cat: 'def',  hp: 340,  hpG: 1.35, base: { g: 60,  i: 20  }, up: { g: 90,  i: 60  }, upG: 1.70, blurb: 'Blocks the path. Enemies must stop and break it.' },
};

/**
 * How many of each type a player may own, indexed by Keep level 1..9.
 * Index 0 is unused and held at 0 so an out-of-range read cannot grant a build.
 */
export const CAP: Record<Exclude<BuildingType, 'keep'>, readonly number[]> = {
  mine:   [0,  3,  4,  5,  6,   7,   8,   9,  10,  12],
  forge:  [0,  1,  2,  3,  4,   5,   6,   7,   8,   9],
  store:  [0,  1,  2,  2,  3,   3,   4,   4,   5,   6],
  barr:   [0,  1,  1,  2,  2,   3,   3,   4,   4,   5],
  cannon: [0,  2,  3,  4,  5,   6,   8,   9,  10,  12],
  tower:  [0,  0,  2,  3,  4,   5,   6,   8,   9,  11],
  wall:   [0, 20, 40, 65, 95, 130, 170, 215, 265, 320],
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
      g: Math.round(d.base.g * ipow(1.55, owned)),
      i: Math.round(d.base.i * ipow(1.55, owned)),
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
