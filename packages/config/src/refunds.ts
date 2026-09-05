import { costOf, type BuildingType, type Cost } from './buildings.js';

/**
 * Getting your money back.
 *
 * Without these a misplaced building is permanent. Count limits are per Keep
 * level, so a player who puts their one allowed Vault in the wrong place at
 * Keep 1 has spent that slot for good — they can move it, but never be rid of
 * it. A base you cannot fix is worse than a base you built badly.
 *
 * The rates are TUNABLE and deliberately generous: there is nothing to sell a
 * player here, so a punitive refund would only make the game feel mean.
 */

/** Share of what was invested that comes back when a building is torn down. */
export const DEMOLISH_REFUND_RATE = 0.5;

/**
 * Everything a building has cost so far: what it took to put up, plus every
 * upgrade since. Counting only the build cost would make a level 9 Cannon
 * refund the same as a level 1 one.
 */
export function investedIn(type: BuildingType, level: number, ownedBefore: number): Cost {
  const build = costOf(type, 0, Math.max(0, ownedBefore));
  let g = build.g;
  let i = build.i;
  for (let lv = 1; lv < level; lv++) {
    const step = costOf(type, lv, ownedBefore);
    g += step.g;
    i += step.i;
  }
  return { g, i };
}

export function demolishRefund(type: BuildingType, level: number, ownedBefore: number): Cost {
  const spent = investedIn(type, level, ownedBefore);
  return {
    g: Math.floor(spent.g * DEMOLISH_REFUND_RATE),
    i: Math.floor(spent.i * DEMOLISH_REFUND_RATE),
  };
}

/**
 * Cancelling a builder or a training job refunds in full.
 *
 * Nothing has been consumed — the builder simply stops and the troop was never
 * mustered. Charging for a change of mind inside the first few seconds is the
 * kind of small meanness players remember.
 */
export const CANCEL_REFUND_RATE = 1;

export function cancelRefund(cost: Cost): Cost {
  return {
    g: Math.floor(cost.g * CANCEL_REFUND_RATE),
    i: Math.floor(cost.i * CANCEL_REFUND_RATE),
  };
}

/** The Keep is the base. Tearing it down would leave nothing to build on. */
export function canDemolish(type: BuildingType): boolean {
  return type !== 'keep';
}
