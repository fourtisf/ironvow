import { keepLevelOf, type OwnedBuilding } from './economy.js';

/**
 * Daily War Orders.
 *
 * Not in the build document. Added because the twelve War Orders in
 * `quests.ts` are one-time: the last one is "win fifteen raids", which a
 * player clears on their second day, and after that opening the game offers
 * nothing that was not there yesterday. A base builder lives on having a
 * reason to come back today specifically.
 *
 * Three orders per player per day, chosen from a pool. The choice is a pure
 * function of the day and the player's id, so the client and the server derive
 * the same three without the server having to write a row when a day turns
 * over — the same trick lazy production uses.
 *
 * All numbers here are TUNABLE.
 */

export type DailyCounter =
  | 'dayCollected'
  | 'dayTrained'
  | 'dayWins'
  | 'dayRaids'
  | 'dayStars'
  | 'dayThreeStars'
  | 'dayLootGold'
  | 'dayUpgrades';

export const DAILY_COUNTERS: readonly DailyCounter[] = [
  'dayCollected', 'dayTrained', 'dayWins', 'dayRaids',
  'dayStars', 'dayThreeStars', 'dayLootGold', 'dayUpgrades',
];

export interface DailyOrder {
  id: string;
  n: string;
  d: string;
  goal: number;
  counter: DailyCounter;
  /**
   * Reward before it is scaled by the Keep.
   *
   * A flat number would be generous at Keep 1 and an insult at Keep 9, and a
   * daily objective that is not worth doing is worse than no objective at all.
   */
  base: { g: number; i: number };
}

/**
 * The pool.
 *
 * Deliberately spread across the whole loop — collect, train, raid, upgrade —
 * so a day's three orders rarely all pull in the same direction, and no single
 * day can be cleared without opening the game at least twice.
 */
export const DAILY_POOL: readonly DailyOrder[] = [
  { id: 'd-collect-8',  n: 'Empty the pouches',   d: 'Collect from your producers 8 times.',   goal: 8,     counter: 'dayCollected',  base: { g: 220, i: 60  } },
  { id: 'd-collect-16', n: 'Working the seam',    d: 'Collect from your producers 16 times.',  goal: 16,    counter: 'dayCollected',  base: { g: 360, i: 110 } },
  { id: 'd-train-12',   n: 'Fill the yard',       d: 'Train 12 troops.',                       goal: 12,    counter: 'dayTrained',    base: { g: 260, i: 90  } },
  { id: 'd-train-30',   n: 'Raise a warband',     d: 'Train 30 troops.',                       goal: 30,    counter: 'dayTrained',    base: { g: 420, i: 160 } },
  { id: 'd-raid-4',     n: 'March out',           d: 'Launch 4 raids.',                        goal: 4,     counter: 'dayRaids',      base: { g: 300, i: 90  } },
  { id: 'd-win-2',      n: 'Two holds broken',    d: 'Win 2 raids.',                           goal: 2,     counter: 'dayWins',       base: { g: 320, i: 110 } },
  { id: 'd-win-5',      n: 'A day of burning',    d: 'Win 5 raids.',                           goal: 5,     counter: 'dayWins',       base: { g: 520, i: 200 } },
  { id: 'd-stars-6',    n: 'Six stars',           d: 'Earn 6 stars across your raids.',        goal: 6,     counter: 'dayStars',      base: { g: 400, i: 150 } },
  { id: 'd-stars-12',   n: 'Twelve stars',        d: 'Earn 12 stars across your raids.',       goal: 12,    counter: 'dayStars',      base: { g: 620, i: 240 } },
  { id: 'd-three-1',    n: 'Nothing left',        d: 'Take a hold apart for all 3 stars.',     goal: 1,     counter: 'dayThreeStars', base: { g: 480, i: 180 } },
  { id: 'd-loot-6k',    n: 'Carts full',          d: 'Carry off 6,000 gold.',                  goal: 6000,  counter: 'dayLootGold',   base: { g: 340, i: 120 } },
  { id: 'd-loot-20k',   n: 'A season of plunder', d: 'Carry off 20,000 gold.',                 goal: 20000, counter: 'dayLootGold',   base: { g: 560, i: 220 } },
  { id: 'd-upgrade-2',  n: 'Keep building',       d: 'Finish 2 upgrades.',                     goal: 2,     counter: 'dayUpgrades',   base: { g: 300, i: 100 } },
  { id: 'd-upgrade-5',  n: 'The masons earn it',  d: 'Finish 5 upgrades.',                     goal: 5,     counter: 'dayUpgrades',   base: { g: 520, i: 190 } },
];

/** How many a player is given each day. */
export const DAILY_COUNT = 3;

export function dailyOrderById(id: string): DailyOrder | undefined {
  return DAILY_POOL.find((o) => o.id === id);
}

/** UTC day number. The reset is at midnight UTC, the same instant for everyone. */
export function dayIndexOf(at: Date): number {
  return Math.floor(at.getTime() / 86_400_000);
}

/** Milliseconds until the next reset, for the countdown in the sheet. */
export function msUntilNextDay(at: Date): number {
  return (dayIndexOf(at) + 1) * 86_400_000 - at.getTime();
}

/* --- deterministic selection ------------------------------------------- */

/** FNV-1a, 32-bit. Integer arithmetic only, so every engine agrees. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function xorshift32(seed: number): () => number {
  let x = seed || 0x9e3779b9;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x >>> 0;
  };
}

/**
 * Today's three orders for one player.
 *
 * Derived rather than stored, so a day turning over costs nothing: no job, no
 * write, no row that can be missing when the player logs in. Two players get
 * different orders on the same day, and one player gets different orders
 * tomorrow, because both go into the seed.
 */
export function dailyOrdersFor(dayIndex: number, playerId: string): DailyOrder[] {
  const next = xorshift32((hashString(playerId) ^ Math.imul(dayIndex, 0x9e3779b1)) >>> 0);
  const bag = DAILY_POOL.slice();
  const out: DailyOrder[] = [];
  for (let i = 0; i < DAILY_COUNT && bag.length > 0; i++) {
    // Partial Fisher-Yates: draw without replacement, so a day never shows the
    // same order twice.
    const k = next() % bag.length;
    out.push(bag[k]!);
    bag.splice(k, 1);
  }
  return out;
}

/* --- rewards ----------------------------------------------------------- */

/**
 * Longest streak that still adds anything.
 *
 * A streak that keeps paying forever turns a habit into an obligation: miss one
 * day after two months and you have lost something real. Capped at eleven days,
 * where the bonus is double and stops, so a missed day costs a fortnight of
 * catching up at worst.
 */
export const STREAK_CAP = 11;

/** Multiplier tenths, so this stays integer arithmetic. */
export function streakTenths(streak: number): number {
  return 10 + Math.max(0, Math.min(streak, STREAK_CAP) - 1);
}

/**
 * What an order actually pays.
 *
 * Scaled by the Keep because a fixed number is either generous at Keep 1 or
 * meaningless at Keep 9, and by the streak because that is what the streak is
 * for. Three orders at Keep 8 come to roughly one mid-game upgrade a day —
 * enough to be worth the trip, not enough to replace raiding.
 */
export function dailyRewardOf(
  order: DailyOrder, keepLevel: number, streak: number,
): { g: number; i: number } {
  const k = Math.max(1, keepLevel);
  const t = streakTenths(streak);
  return {
    g: Math.round((order.base.g * k * t) / 10),
    i: Math.round((order.base.i * k * t) / 10),
  };
}

export function dailyRewardFor(
  order: DailyOrder, buildings: readonly OwnedBuilding[], streak: number,
): { g: number; i: number } {
  return dailyRewardOf(order, keepLevelOf(buildings), streak);
}

/** Everything a daily order is measured against. */
export type DailySubject = Partial<Record<DailyCounter, number>>;

export function dailyProgress(order: DailyOrder, subject: DailySubject): number {
  return subject[order.counter] ?? 0;
}

export function isDailyComplete(order: DailyOrder, subject: DailySubject): boolean {
  return dailyProgress(order, subject) >= order.goal;
}
