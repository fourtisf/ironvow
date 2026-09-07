import { TROOP, TROOP_ORDER, type TroopType } from './troops.js';
import { KEEP_MAX } from './world.js';

/**
 * The garrison: troops your clan gives you, standing in your hold.
 *
 * A clan without this is a chat room between wars. It is the strongest social
 * hook the genre has, and for one reason: it is the only thing in the game one
 * player can do *for* another. Everything else — trophies, loot, stars — is
 * taken from somebody.
 *
 * The shape of it here:
 *
 *  - Donated troops **defend**. They spawn when your hold is raided and they
 *    fight for you while you are asleep, which is exactly when a clan is worth
 *    having.
 *  - They are **spent** doing it. A garrison that survives is a garrison
 *    nobody ever asks for again, and the asking is the point.
 *  - The **donor is paid**. Not much, and in gold, so giving is never a net
 *    loss against training the same troop for yourself.
 *
 * All numbers here are TUNABLE.
 */

/**
 * Room in the garrison, in warband slots, by Keep level.
 *
 * Deliberately small next to a warband: this is a handful of troops that turn
 * a raid, not a second army. Ten at Keep 1 is a couple of Raiders and an
 * Archer; forty-two at Keep 9 is a wall a careless attacker walks into.
 */
export function garrisonSlots(keepLevel: number): number {
  const lv = Math.max(1, Math.min(keepLevel, KEEP_MAX));
  return 6 + lv * 4;
}

/**
 * What the donor is paid, per slot given.
 *
 * Set against the cost of training the troop rather than plucked from the air:
 * a Raider costs 45 gold and one slot, so 60 a slot means giving one away is
 * slightly *better* than keeping it. That is the right sign. A donation
 * economy where generosity costs you is a donation economy nobody uses.
 */
export const DONATION_GOLD_PER_SLOT = 60;

export function donationReward(type: TroopType, count: number): number {
  return TROOP[type].sp * count * DONATION_GOLD_PER_SLOT;
}

export type Garrison = Partial<Record<TroopType, number>>;

export function garrisonUsed(garrison: Garrison): number {
  let used = 0;
  for (const t of TROOP_ORDER) used += (garrison[t] ?? 0) * TROOP[t].sp;
  return used;
}

/**
 * How many of `type` will still fit.
 *
 * Returned rather than a boolean because the client needs it to grey a button
 * and the server needs it to clamp a request, and those two must agree.
 */
export function garrisonRoomFor(garrison: Garrison, keepLevel: number, type: TroopType): number {
  const free = garrisonSlots(keepLevel) - garrisonUsed(garrison);
  return Math.max(0, Math.floor(free / TROOP[type].sp));
}

/** A garrison read off the wire, with anything unrecognised dropped. */
export function parseGarrison(value: unknown): Garrison {
  const out: Garrison = {};
  if (typeof value !== 'object' || value === null) return out;
  const row = value as Record<string, unknown>;
  for (const t of TROOP_ORDER) {
    const n = row[t];
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[t] = Math.floor(n);
  }
  return out;
}
