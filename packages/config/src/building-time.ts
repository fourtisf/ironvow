import { costOf, type BuildingType } from './buildings.js';

/**
 * Build timers and builders.
 *
 * Spec S8.4 flags this as a monetisation decision as much as a design one, and
 * ALFA's answer was: free, no in-app purchases. That answer sets every number
 * here. In a game that sells speed-ups, long timers are the engine; in a game
 * that sells nothing, a long timer is pure friction with nobody benefiting.
 * So these are short — a rhythm that gives you a reason to come back this
 * evening, not a wall that makes you come back tomorrow.
 *
 * All TUNABLE.
 */

/** Builders, free, from the first minute. Never purchasable. */
export const BUILDERS = 3;

/** Nothing takes less than this once it has a timer at all. */
export const MIN_BUILD_SECONDS = 5;

/**
 * Ceiling on any single job.
 *
 * Ten minutes is the longest thing in the game — a Keep from 8 to 9. Everything
 * else lands well under it.
 */
export const MAX_BUILD_SECONDS = 600;

/** Scales the cost-derived curve. Raising this lengthens every timer at once. */
const TIME_PER_ROOT_COST = 1.2;

/**
 * How long a job takes.
 *
 * Derived from what it costs rather than from a table, because cost already
 * encodes how significant a thing is, and a second table would drift from the
 * first. The square root keeps the curve gentle: a job that costs a hundred
 * times more takes ten times longer, not a hundred.
 *
 * Iron is weighted double because it is the scarcer resource.
 */
export function buildSeconds(type: BuildingType, level: number, owned: number): number {
  // Ramparts go up as fast as you can lay them. A run of twenty walls is one
  // decision made twenty times, and putting five seconds between each would
  // turn the prototype's best interaction into a chore.
  if (type === 'wall') return 0;

  const cost = costOf(type, level, owned);
  const weighted = cost.g + cost.i * 2;
  const seconds = Math.round(Math.sqrt(weighted) * TIME_PER_ROOT_COST);
  return Math.max(MIN_BUILD_SECONDS, Math.min(MAX_BUILD_SECONDS, seconds));
}

/**
 * Gold to finish a job immediately.
 *
 * There is no premium currency to spend here and there never will be, so this
 * is priced as a convenience rather than a toll: a player sitting on gold they
 * cannot spend anyway can skip a wait. That a wealthy player skips most timers
 * is fine — the timer exists to pace a player who is still growing.
 */
export function finishNowCost(remainingSeconds: number): number {
  return Math.max(10, Math.ceil(Math.max(0, remainingSeconds) * 3));
}

/** A building mid-construction or mid-upgrade. */
export interface TimedBuilding {
  type: BuildingType;
  level: number;
  /** Null when idle. */
  completesAt: Date | null;
  /** The level it becomes. Null while a brand-new building is still going up. */
  upgradingTo: number | null;
}

/**
 * A building that is still going up, as opposed to one being upgraded.
 *
 * The distinction matters everywhere: a half-built cannon does not shoot and a
 * half-built mine does not produce, but a cannon being *upgraded* keeps working
 * at its current level throughout. Taking a defence offline for the duration of
 * its own upgrade would make upgrading defences a bad idea, which is the
 * opposite of what the progression wants.
 */
export function isUnderConstruction(b: TimedBuilding): boolean {
  return b.completesAt !== null && b.upgradingTo === null;
}

export function isBusy(b: TimedBuilding): boolean {
  return b.completesAt !== null;
}

/** Builders currently occupied. */
export function buildersInUse(buildings: readonly TimedBuilding[]): number {
  let n = 0;
  for (const b of buildings) if (isBusy(b)) n++;
  return n;
}

export function buildersFree(buildings: readonly TimedBuilding[]): number {
  return Math.max(0, BUILDERS - buildersInUse(buildings));
}

/** A building still going up produces nothing and fires nothing. */
export function isOperational(b: TimedBuilding): boolean {
  return !isUnderConstruction(b);
}


