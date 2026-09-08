import { TYPES, type BuildingType } from './buildings.js';

/**
 * Traps.
 *
 * The only thing on a defending base an attacker cannot see before they commit.
 *
 * Everything else about a hold is public. A raid opens with a scout, the scout
 * shows the whole layout, and from there the attack is a solved problem: the
 * player can see every Cannon's reach and every Mortar's dead zone and pick the
 * side with the least of both. That is fine — it is what makes raiding a
 * planning game rather than a lottery — but it leaves the defender with nothing
 * to decide. Their layout is read before it is played against, so the only thing
 * a good layout can do is be slightly less bad than a poor one.
 *
 * A trap is the defender's half of that. It is not drawn on the attacker's
 * screen until it fires, so where it went is a guess the defender made about
 * where the attacker would walk, and finding out whether the guess was right is
 * the first thing in the game that makes laying out a base interesting.
 *
 * **This is a fairness rule, not a security one, and the difference matters.**
 * The simulation is deterministic and both sides run the same code, so the trap
 * has to be in the snapshot the client is given — a client that fired its traps
 * on a different tick from the server would diverge on the first raid. What is
 * hidden is hidden in the renderer. Somebody reading their own memory could see
 * where the traps are. They still could not forge a result, because the server
 * replays the commands and computes the outcome itself; the anti-cheat property
 * the game actually rests on is untouched. Pretending otherwise in a comment
 * would be worse than the hole.
 */

export const TRAP_TYPES = ['spike', 'snare'] as const;
export type TrapType = (typeof TRAP_TYPES)[number];

export interface TrapSpec {
  /**
   * How close an attacker must come to set it off, in cells from the centre.
   *
   * Deliberately smaller than `blast`. When the two were the same number a trap
   * caught exactly one man: troops deploy a tick apart and arrive strung out in
   * a column, so the front man tripped it and everyone behind him was, by a
   * tenth of a cell, outside the only radius there was. A tight tripwire and a
   * wide blast is how the thing is supposed to work — you step on it, and it
   * hurts the people walking with you.
   */
  r: number;
  /** How far the effect reaches once it goes off. Wider than `r`. */
  blast: number;
  /** Damage to everything of theirs inside `r`. Zero for a trap that does none. */
  dmg: number;
  /** hp = dmg * dmgG^(level-1) */
  dmgG: number;
  /** Seconds the effect lingers. Zero for one that resolves instantly. */
  seconds: number;
  /** What it multiplies a caught unit's speed by while it lingers. 1 is no effect. */
  slow: number;
}

/**
 * TUNABLE, all of it.
 *
 * The two are opposites on purpose, because one trap is a tax and two traps are
 * a decision. A Spike Trap converts a tight group into a dead group. A Snare
 * does no damage at all and instead holds whoever walks into it in front of
 * whatever the defender put there — which is worth nothing on its own and a
 * great deal in front of a Mortar.
 */
export const TRAP: Record<TrapType, TrapSpec> = {
  spike: { r: 1.5, blast: 3.0, dmg: 150, dmgG: 1.26, seconds: 0, slow: 1 },
  snare: { r: 1.7, blast: 3.4, dmg: 0, dmgG: 1, seconds: 4.5, slow: 0.42 },
};

export function isTrap(type: BuildingType): boolean {
  return TYPES[type].cat === 'trap';
}

export function isTrapType(v: string): v is TrapType {
  return (TRAP_TYPES as readonly string[]).includes(v);
}

/** What one of these does at a given level. */
export function trapDamage(type: TrapType, level: number): number {
  const t = TRAP[type];
  return Math.round(t.dmg * Math.pow(t.dmgG, Math.max(0, level - 1)));
}

/**
 * How long a Snare holds, at a given level.
 *
 * The slow itself does not deepen with level — a trap that eventually stops a
 * troop dead is a trap that wins on its own — so what a level buys is time.
 */
export function trapSeconds(type: TrapType, level: number): number {
  const t = TRAP[type];
  return t.seconds === 0 ? 0 : t.seconds + (level - 1) * 0.45;
}
