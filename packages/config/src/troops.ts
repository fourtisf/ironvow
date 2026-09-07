import type { Cost } from './buildings.js';

export const TROOP_TYPES = ['raider', 'archer', 'lancer', 'ram', 'scaler'] as const;
export type TroopType = (typeof TROOP_TYPES)[number];

/**
 * Deploy order. The battle simulation iterates troops in this fixed order
 * everywhere it needs one, so no result can depend on object key order.
 */
export const TROOP_ORDER: readonly TroopType[] = TROOP_TYPES;

export type TargetPreference = 'any' | 'def' | 'wall';

export interface TroopDef {
  n: string;
  hp: number;
  dmg: number;
  /** Seconds between attacks. */
  cd: number;
  /** Cells per second. */
  spd: number;
  /** Attack range in cells, measured from the edge of the target footprint. */
  rng: number;
  /** Warband slots consumed. */
  sp: number;
  cost: Cost;
  /** Training time in seconds. */
  tt: number;
  pref: TargetPreference;
  /**
   * Walks over ramparts instead of stopping at them.
   *
   * With four troops a raid had no composition decision: bring a ram, bring
   * whatever else fits. A unit that ignores the wall entirely gives the wall
   * something to be wrong about — you can go over it with something fragile,
   * or through it with something slow, and the defender's layout is what
   * decides which was right.
   */
  climb?: boolean;
  /** Body colours for the procedural renderer. */
  col: string;
  col2: string;
}

export const TROOP: Record<TroopType, TroopDef> = {
  raider: { n: 'Raider', hp: 130, dmg: 16, cd: 0.80, spd: 2.50, rng: 0.85, sp: 1, cost: { g: 45,  i: 0   }, tt: 5,  pref: 'any',  col: '#b4c3d2', col2: '#6b7a89' },
  archer: { n: 'Archer', hp: 95,  dmg: 21, cd: 0.70, spd: 2.10, rng: 3.40, sp: 2, cost: { g: 60,  i: 55  }, tt: 9,  pref: 'any',  col: '#8fd67f', col2: '#4a8a44' },
  lancer: { n: 'Lancer', hp: 380, dmg: 24, cd: 1.05, spd: 1.70, rng: 0.90, sp: 3, cost: { g: 140, i: 20  }, tt: 14, pref: 'def',  col: '#7fa8e0', col2: '#3f6ba8' },
  ram:    { n: 'Ram',    hp: 900, dmg: 70, cd: 1.50, spd: 1.25, rng: 1.15, sp: 6, cost: { g: 120, i: 190 }, tt: 22, pref: 'wall', col: '#c48a4f', col2: '#7a4f28' },
  // TUNABLE. Not in the build document — added because four troops left the
  // warband with nothing to decide. Priced and statted as the ram's opposite:
  // the fastest and most fragile thing in the game, and the only one a rampart
  // does not stop.
  scaler: { n: 'Scaler', hp: 105, dmg: 19, cd: 0.75, spd: 2.90, rng: 0.85, sp: 2, cost: { g: 130, i: 70  }, tt: 12, pref: 'any',  climb: true, col: '#c9a2e0', col2: '#6d4a8f' },
};

/** Barracks level required before a type can be trained. */
export const TROOP_UNLOCK: Record<TroopType, number> = {
  raider: 1, archer: 1, lancer: 2, ram: 3, scaler: 4,
};

/** A ranged unit fires a homing projectile; a melee unit applies damage directly. */
export const RANGED_THRESHOLD = 2;

export function isRanged(type: TroopType): boolean {
  return TROOP[type].rng > RANGED_THRESHOLD;
}

/**
 * Warband capacity contributed by one Muster Field.
 *
 * Two level-1 fields — what a new hold is given — come to sixteen slots, a
 * little over the fourteen the opening Barracks used to hand over, so the
 * tutorial's five Raiders still fit and then some. Ten level-9 fields come to
 * 320, which is where the old ceiling of five level-9 Barracks stood.
 */
export function campSlots(level: number): number {
  return 5 + level * 3;
}

/**
 * What a Barracks used to contribute, kept only for the Inspector's line about
 * an existing one. Capacity comes from the Muster Field now; see CAMP_NOTE.
 */
export function barracksSlots(level: number): number {
  return 8 + level * 6;
}

export function isTroopType(v: string): v is TroopType {
  return (TROOP_TYPES as readonly string[]).includes(v);
}

/** True for a unit ramparts do not stop. */
export function climbs(type: TroopType): boolean {
  return TROOP[type].climb === true;
}
