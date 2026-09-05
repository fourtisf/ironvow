import { ipow } from './math.js';
import type { Cost } from './buildings.js';
import { KEEP_MAX } from './world.js';

/**
 * The hero.
 *
 * Spec S8.2: every troop is disposable, so no unit is ever worth caring about.
 * The hero is the one exception — it persists between raids, levels up, and is
 * lost for a while when it falls. That last part is what gives it weight: a
 * unit you cannot replace by spending gold is a unit you think about.
 *
 * All numbers here are TUNABLE. The build document asks for a hero but does not
 * price one.
 */

export const HERO_MAX_LEVEL = KEEP_MAX;

/** Level 1 statistics. Deliberately strong enough to change a raid on its own. */
export const HERO_BASE = {
  hp: 1400,
  dmg: 55,
  /** Seconds between blows. */
  cd: 0.9,
  /** Cells per second. Slightly slower than a raider, faster than a lancer. */
  spd: 2.0,
  /** Melee, measured from the edge of the target footprint. */
  rng: 1.1,
} as const;

const HP_GROWTH = 1.18;
const DMG_GROWTH = 1.15;

export interface HeroStats {
  hp: number;
  dmg: number;
  cd: number;
  spd: number;
  rng: number;
}

export function heroStats(level: number): HeroStats {
  const lv = Math.max(1, Math.min(level, HERO_MAX_LEVEL));
  return {
    hp: Math.round(HERO_BASE.hp * ipow(HP_GROWTH, lv - 1)),
    dmg: Math.round(HERO_BASE.dmg * ipow(DMG_GROWTH, lv - 1)),
    cd: HERO_BASE.cd,
    spd: HERO_BASE.spd,
    rng: HERO_BASE.rng,
  };
}

/** Cost of taking the hero from `level` to `level + 1`. */
export function heroUpgradeCost(level: number): Cost {
  return {
    g: Math.round(800 * ipow(1.9, level - 1)),
    i: Math.round(300 * ipow(1.9, level - 1)),
  };
}

/**
 * How long the hero is away after falling.
 *
 * Scales with level so a stronger hero is a bigger loss, which is what keeps
 * the decision to commit it a real one rather than a reflex.
 */
export function heroRespawnMinutes(level: number): number {
  return 10 + level * 5;
}

/**
 * The hero is unlocked once the Keep can support it.
 *
 * Not from level 1: a brand-new player has enough to learn without a unique
 * unit and a respawn timer on top of it.
 */
export const HERO_UNLOCK_KEEP_LEVEL = 3;

export function heroUnlocked(keepLevel: number): boolean {
  return keepLevel >= HERO_UNLOCK_KEEP_LEVEL;
}

/** The hero is the one unit that costs no warband room. */
export const HERO_SLOTS = 0;

/** Name shown in the tray and the inspector. */
export const HERO_NAME = 'Vowkeeper';
