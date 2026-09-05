/** Raid clock, in seconds. */
export const RAID_SECONDS = 180;
/** Defend clock, in seconds. */
export const DEFEND_SECONDS = 140;

/** The simulation advances in fixed steps of this length. Never varies. */
export const TICK_SECONDS = 1 / 30;
export const TICKS_PER_SECOND = 30;

export const RAID_TICKS = Math.round(RAID_SECONDS * TICKS_PER_SECOND);
export const DEFEND_TICKS = Math.round(DEFEND_SECONDS * TICKS_PER_SECOND);

/** Fraction of a base that must fall for the first star. */
export const ONE_STAR_PCT = 0.5;
/** Destruction counted as total. Matches the prototype's 0.999 guard against float drift. */
export const FULL_PCT = 0.999;

export function starsFor(destroyedPct: number, keepDestroyed: boolean): number {
  let stars = 0;
  if (destroyedPct >= ONE_STAR_PCT) stars++;
  if (keepDestroyed) stars++;
  if (destroyedPct >= FULL_PCT) stars++;
  return stars;
}

/**
 * Single-player loot pool, keyed off the prototype's `stage` counter.
 *
 * Phase 1 raids generated bases and used this. From Phase 2 on, a PvP raid
 * derives its pool from the defender's real stock instead — see
 * `availableLoot` in ./economy. Kept because Phase 1 still ships with it and
 * because the generated-base tests pin these numbers.
 *
 * Math.pow with a fractional exponent is engine-dependent, so this is computed
 * once on the server and frozen into the raid snapshot. It never runs on the
 * deterministic simulation path.
 */
export function stageLoot(stage: number): { g: number; i: number } {
  return {
    g: Math.round(420 + stage * 300 + Math.pow(stage, 1.5) * 40),
    i: Math.round(130 + stage * 110 + Math.pow(stage, 1.4) * 18),
  };
}

/** Trophies for a won raid: scales with the opponent's strength and the stars taken. */
export function trophyWin(stage: number, stars: number): number {
  return (12 + Math.floor(stage * 0.8)) * stars;
}

/** Trophies lost on a failed raid. Returned as a negative number. */
export function trophyLoss(stage: number): number {
  return -(6 + Math.floor(stage * 0.4));
}

/**
 * PvP matchmaking converts a defender's trophies into the `stage`-equivalent
 * the trophy formulas expect, so one set of numbers drives both modes.
 */
export function stageFromTrophies(trophies: number): number {
  return 1 + Math.floor(Math.max(0, trophies) / 120);
}

/** Trophy band for a first matchmaking attempt; widened on each retry. */
export const TROPHY_BAND_START = 150;
export const TROPHY_BAND_STEP = 150;
export const TROPHY_BAND_MAX = 3000;

/** How long a defender is safe after being hit. */
export const SHIELD_HOURS_2_STAR = 12;
export const SHIELD_HOURS_1_STAR = 8;

export function shieldHoursFor(stars: number): number {
  if (stars >= 2) return SHIELD_HOURS_2_STAR;
  if (stars >= 1) return SHIELD_HOURS_1_STAR;
  return 0;
}

/** A player may not be re-raided by the same attacker inside this window. */
export const REVENGE_COOLDOWN_HOURS = 12;

/** An opened raid that receives no commands expires. */
export const RAID_EXPIRY_MINUTES = 5;

/** TUNABLE — gold charged to reroll a scouted opponent (spec S8.1). */
export const SCOUT_REROLL_COST = 50;
