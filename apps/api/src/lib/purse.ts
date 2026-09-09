import { NIGHT, type World } from '@ironvow/config';
import type { Cost } from '@ironvow/config';

/**
 * Which purse a world spends from.
 *
 * The single most dangerous join in the whole two-world feature. Every price
 * check downstream reads `player.gold` — already the right world's, because
 * `settleAndLoad` chose it — and then every *write* has to hit the matching
 * column. Get the read right and the write wrong and a player buys a night
 * Cannon with day gold: the check passes, the money leaves the wrong pocket,
 * and nothing anywhere reports a problem.
 *
 * So the columns are named in exactly one place, and spending and crediting go
 * through it rather than through a literal `gold:` somebody typed.
 */
export function spend(world: World, cost: Cost): Record<string, { decrement: bigint }> {
  return world === NIGHT
    ? { nightGold: { decrement: BigInt(cost.g) }, nightIron: { decrement: BigInt(cost.i) } }
    : { gold: { decrement: BigInt(cost.g) }, iron: { decrement: BigInt(cost.i) } };
}

/** The other direction: a refund, a collection, or a raid's loot. */
export function credit(world: World, gain: Cost): Record<string, { increment: bigint }> {
  return world === NIGHT
    ? { nightGold: { increment: BigInt(gain.g) }, nightIron: { increment: BigInt(gain.i) } }
    : { gold: { increment: BigInt(gain.g) }, iron: { increment: BigInt(gain.i) } };
}

/** An absolute set, for the one caller that clamps to a storage cap. */
export function setPurse(world: World, at: Cost): Record<string, bigint> {
  return world === NIGHT
    ? { nightGold: BigInt(at.g), nightIron: BigInt(at.i) }
    : { gold: BigInt(at.g), iron: BigInt(at.i) };
}

/** The builder crew of a world, for hiring and for counting. */
export function crewField(world: World): 'nightBuilders' | 'builders' {
  return world === NIGHT ? 'nightBuilders' : 'builders';
}

/** The ladder a world's raids move. */
export function trophyField(world: World): 'nightTrophies' | 'trophies' {
  return world === NIGHT ? 'nightTrophies' : 'trophies';
}
