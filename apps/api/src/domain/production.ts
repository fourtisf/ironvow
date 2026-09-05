import {
  OFFLINE_CAP_SECONDS,
  PRODUCES,
  PROD,
  stockCapOf,
  storageCapOf,
  type BuildingType,
} from '@ironvow/config';

/**
 * Lazy production.
 *
 * There is no tick loop. Every read or write that touches a player first
 * settles what its producers earned since `lastTickAt`, then moves the
 * watermark. That keeps a base with no players online costing nothing, and it
 * means a player cannot manufacture time by holding a request open.
 */

export interface ProducerRow {
  id: string;
  type: BuildingType;
  level: number;
  stock: number;
}

export interface AccrualInput {
  lastTickAt: Date;
  now: Date;
  buildings: readonly ProducerRow[];
}

export interface AccrualResult {
  /** Only the producers whose stock actually moved, so the write stays small. */
  updated: { id: string; stock: number }[];
  /** Seconds actually paid out, after the offline cap. */
  elapsedSeconds: number;
  nextTickAt: Date;
}

/**
 * Settle production up to `now`.
 *
 * The elapsed window is clamped to four hours, matching the prototype's
 * offline rule, and to zero if a clock skew ever hands us a negative interval.
 * Each producer fills to its own twelve-minute buffer and stops; a player who
 * does not come back does not accumulate forever.
 */
export function accrueProduction({ lastTickAt, now, buildings }: AccrualInput): AccrualResult {
  const rawSeconds = (now.getTime() - lastTickAt.getTime()) / 1000;
  const elapsedSeconds = Math.max(0, Math.min(rawSeconds, OFFLINE_CAP_SECONDS));
  const minutes = elapsedSeconds / 60;

  const updated: { id: string; stock: number }[] = [];
  if (minutes > 0) {
    for (const b of buildings) {
      const rate = PROD[b.type];
      if (!rate) continue;
      const cap = stockCapOf(b.type, b.level);
      const next = Math.min(cap, b.stock + rate(b.level) * minutes);
      if (next !== b.stock) updated.push({ id: b.id, stock: next });
    }
  }

  return { updated, elapsedSeconds, nextTickAt: now };
}

export interface CollectInput {
  gold: bigint;
  iron: bigint;
  buildings: readonly ProducerRow[];
  /** Collect one producer, or every producer when omitted. */
  buildingId?: string;
}

export interface CollectResult {
  gold: bigint;
  iron: bigint;
  /** Producers to zero out. */
  cleared: string[];
  /** What actually reached the purse, after the storage clamp. */
  collected: { gold: number; iron: number };
  /** What the storage clamp threw away. Surfaced so the client can warn. */
  wasted: { gold: number; iron: number };
}

/**
 * Move stock into the purse, clamped to storage capacity.
 *
 * Prototype bug #1 lived here: when the purse already sits at capacity the
 * collection is discarded, and if that happens on a player's very first
 * collection the game looks broken. Starting resources are asserted below
 * capacity in @ironvow/config, and the overflow is reported rather than
 * dropped silently.
 */
export function collectStock({ gold, iron, buildings, buildingId }: CollectInput): CollectResult {
  const cap = BigInt(storageCapOf(buildings.map((b) => ({ type: b.type, level: b.level }))));
  let g = gold;
  let i = iron;
  const cleared: string[] = [];
  const collected = { gold: 0, iron: 0 };
  const wasted = { gold: 0, iron: 0 };

  for (const b of buildings) {
    if (buildingId && b.id !== buildingId) continue;
    const resource = PRODUCES[b.type];
    if (!resource) continue;
    const amount = BigInt(Math.floor(b.stock));
    if (amount < 1n) continue;

    if (resource === 'gold') {
      const room = cap > g ? cap - g : 0n;
      const taken = amount < room ? amount : room;
      g += taken;
      collected.gold += Number(taken);
      wasted.gold += Number(amount - taken);
    } else {
      const room = cap > i ? cap - i : 0n;
      const taken = amount < room ? amount : room;
      i += taken;
      collected.iron += Number(taken);
      wasted.iron += Number(amount - taken);
    }
    cleared.push(b.id);
  }

  return { gold: g, iron: i, cleared, collected, wasted };
}

export interface GrantResult {
  gold: bigint;
  iron: bigint;
  /**
   * What the storage clamp threw away.
   *
   * Reported rather than swallowed. Prototype bug #1 was a collection silently
   * discarded against a full purse, and a refund or a quest reward vanishing
   * the same way is the same bug wearing a different hat — the player is owed
   * the news that their Vaults are the reason.
   */
  wasted: { gold: number; iron: number };
}

/** Credit a reward, clamped to storage. Never lets a balance exceed capacity. */
export function grant(
  gold: bigint,
  iron: bigint,
  addGold: number,
  addIron: number,
  buildings: readonly { type: BuildingType; level: number }[],
): GrantResult {
  const cap = BigInt(storageCapOf(buildings));
  const g = gold + BigInt(Math.max(0, Math.floor(addGold)));
  const i = iron + BigInt(Math.max(0, Math.floor(addIron)));
  const clampedG = g > cap ? cap : g;
  const clampedI = i > cap ? cap : i;
  return {
    gold: clampedG,
    iron: clampedI,
    wasted: { gold: Number(g - clampedG), iron: Number(i - clampedI) },
  };
}
