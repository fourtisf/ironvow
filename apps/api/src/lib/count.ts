import { dayIndexOf } from '@ironvow/config';
import { prisma } from './prisma.js';

/**
 * Counting, for the two questions no other row can answer.
 *
 * Almost everything worth knowing after a launch is already in the database.
 * How many signed up is `Player.createdAt`. How many came back is
 * `Player.streakDays`. How far anybody got is `Player.claimedQuests`. None of
 * that needs recording twice, and recording it twice is how two numbers that
 * are meant to agree stop agreeing.
 *
 * What no row anywhere can answer is what happened to the people who never
 * became a player: how many opened the door, and how many the access code
 * turned away. Those two are the difference between "nobody wants this" and
 * "nobody could get in", which are the same graph and opposite problems.
 *
 * No third party, no cookie, no identifier. A name, a day and a number.
 */

export const COUNTERS = ['door', 'door_new', 'gate_ok', 'gate_fail'] as const;
export type CounterName = (typeof COUNTERS)[number];

/** UTC, so a launch watched from two time zones is one day. */
export function dayKeyOf(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Add one.
 *
 * Never awaited by a request handler and never allowed to fail one: a counter
 * that can 500 the door is far worse than a counter that misses a tick. The
 * upsert is the whole of the concurrency story — two arrivals in the same
 * millisecond resolve to one row and two increments.
 */
export function bump(name: CounterName, now = new Date()): void {
  const day = dayKeyOf(now);
  void prisma.counter
    .upsert({
      where: { day_name: { day, name } },
      create: { day, name, count: 1 },
      update: { count: { increment: 1 } },
    })
    .catch(() => undefined);
}

export interface FunnelDay {
  day: string;
  /**
   * Opened the game. Page loads, not people: one visitor who reloads twice is
   * two, and a player who already has a session is one of them.
   */
  door: number;
  /**
   * Of those, the loads with no session cookie — someone who is not already
   * playing. This is the number that belongs next to signups; `door` on its
   * own drifts upward with the returning player base and would make the game
   * look worse at converting the longer it ran.
   */
  doorNew: number;
  /** Got through the access code, or did not. */
  gateOk: number;
  gateFail: number;
  /** Became a player. */
  signups: number;
  /** Of those, how many got as far as each milestone. */
  built: number;
  raided: number;
  won: number;
  /** Came back on a later day at least once. */
  returned: number;
}

/**
 * The funnel, one row per day.
 *
 * Read rather than recorded wherever a column already knows: the milestone
 * columns are counted against the day the player signed up, so a row reads as
 * "of the people who arrived on this day, this many ever got that far" — which
 * is the question being asked, and not the same as "this many did it today".
 */
export async function funnel(days = 14): Promise<FunnelDay[]> {
  const since = new Date(Date.now() - days * 86_400_000);

  const counters = await prisma.counter.findMany({
    where: { day: { gte: dayKeyOf(since) } },
  });

  const players = await prisma.player.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, collected: true, raids: true, wins: true, streakDays: true, dayKey: true },
  });

  const rows = new Map<string, FunnelDay>();
  const row = (day: string): FunnelDay => {
    let r = rows.get(day);
    if (!r) {
      r = { day, door: 0, doorNew: 0, gateOk: 0, gateFail: 0, signups: 0, built: 0, raided: 0, won: 0, returned: 0 };
      rows.set(day, r);
    }
    return r;
  };

  for (const c of counters) {
    const r = row(c.day);
    if (c.name === 'door') r.door = c.count;
    else if (c.name === 'door_new') r.doorNew = c.count;
    else if (c.name === 'gate_ok') r.gateOk = c.count;
    else if (c.name === 'gate_fail') r.gateFail = c.count;
  }

  for (const p of players) {
    const r = row(dayKeyOf(p.createdAt));
    r.signups++;
    if (p.collected > 0) r.built++;
    if (p.raids > 0) r.raided++;
    if (p.wins > 0) r.won++;
    /*
     * "Came back" means a second day, ever — not a streak that is still
     * running. A player who played three days and stopped came back; counting
     * only live streaks would report them as never having returned and make
     * every retention number fall as the week went on.
     *
     * `dayKey` is an integer day index, not a date string — comparing it
     * against a YYYY-MM-DD would be true for every player alive and report a
     * hundred per cent retention forever. Zero is the default a row carries
     * until its first settle, so it means "has not played yet" rather than a
     * day that differs from signup, and must not read as a return.
     */
    if (p.streakDays > 1 || (p.dayKey > 0 && dayIndexOf(p.createdAt) !== p.dayKey)) r.returned++;
  }

  return [...rows.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}
