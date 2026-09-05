/**
 * mulberry32, ported unchanged from the prototype.
 *
 * The whole simulation draws from this and nothing else. Math.random never
 * appears in @ironvow/sim: the seed lives on the Raid row, so a raid replayed
 * a year later rolls exactly the same numbers.
 */
export type Rng = () => number;

export function mulberry(seed: number): Rng {
  let a = seed | 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeds are stored as BigInt in Postgres; the PRNG only ever sees 32 bits. */
export function seedToInt32(seed: bigint | number): number {
  return Number(BigInt.asIntN(32, BigInt(seed)));
}

/** A fresh raid seed. Server-side only — never on the deterministic path. */
export function randomSeed(): number {
  return (Math.random() * 0x1_0000_0000) | 0;
}
