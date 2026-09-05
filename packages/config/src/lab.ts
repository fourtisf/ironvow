import { ipow } from './math.js';
import type { Cost } from './buildings.js';
import { TROOP, type TroopType } from './troops.js';
import { KEEP_MAX } from './world.js';

/**
 * The troop upgrade lab.
 *
 * Spec S8.3: troops never get stronger, only more numerous, so progression
 * flattens hard at high Keep levels — a level 9 player fields the same raider a
 * level 2 player does, just more of them. Per-troop levels fix that.
 *
 * All numbers here are TUNABLE.
 */

export const TROOP_MAX_LEVEL = KEEP_MAX;

/**
 * Damage and hit points a troop level buys.
 *
 * Twelve per cent per level compounds to roughly 2.5x at level 9, which is
 * enough to matter without making an un-upgraded army worthless — a player who
 * skipped the lab should be behind, not locked out.
 */
export const TROOP_POWER_STEP = 0.12;

export function troopPower(level: number): number {
  const lv = Math.max(1, Math.min(level, TROOP_MAX_LEVEL));
  return 1 + (lv - 1) * TROOP_POWER_STEP;
}

/**
 * Cost of taking one troop type from `level` to `level + 1`.
 *
 * Derived from that troop's own training cost, so upgrading a ram costs more
 * than upgrading a raider without a second table to keep in step.
 */
export function troopUpgradeCost(type: TroopType, level: number): Cost {
  const base = TROOP[type].cost;
  const scale = ipow(1.8, level - 1);
  return {
    g: Math.round((base.g * 10 + 200) * scale),
    i: Math.round((base.i * 10 + 120) * scale),
  };
}

/** Seconds a troop upgrade takes. Zero until build timers are approved (S8.4). */
export function troopUpgradeSeconds(_level: number): number {
  return 0;
}

/**
 * A troop may not exceed the Lab's level, and the Lab may not exceed the
 * Keep's. Same gate as every other building, so there is one rule to learn.
 */
export function maxTroopLevel(labLevel: number): number {
  return Math.max(0, Math.min(labLevel, TROOP_MAX_LEVEL));
}
