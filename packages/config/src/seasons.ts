/**
 * Seasons.
 *
 * The ladder had a top but no end. A number that only ever goes up stops being
 * a competition after the first month, because the people who started first are
 * permanently ahead of the people who play better. A season is the fix: the
 * board is paid out and pulled back to a floor on a fixed clock, so climbing is
 * something you do repeatedly rather than once.
 *
 * Three decisions, all TUNABLE, all here so the worker that closes a season and
 * the banner that counts down to it cannot disagree:
 *
 * - **You are paid on the highest you reached, not where you finished.** Paying
 *   on the final number makes the last night of a season the only one that
 *   matters and rewards sitting on a total rather than pushing it. Paying on the
 *   peak means a bad evening costs nothing that was already earned, which is the
 *   behaviour worth encouraging.
 * - **The reset keeps the floor and half of everything above it.** A full wipe
 *   throws away the season's work; no wipe is not a season. Half is the standard
 *   compromise and it lands a top player back among people they have to beat
 *   again without dropping them among beginners.
 * - **Nothing is paid below the first tier.** A season reward every account
 *   collects for existing is a faucet, not a prize.
 */

/** How long a season runs. */
export const SEASON_DAYS = 14;
export const SEASON_MS = SEASON_DAYS * 24 * 60 * 60 * 1000;

/**
 * Trophies nobody drops below at a reset, and the fraction of the excess above
 * it that survives.
 */
export const SEASON_RESET_FLOOR = 200;
export const SEASON_RESET_KEEP = 0.5;

export interface SeasonTier {
  /** Stable id, stored on the result row. Never renamed once a season has shipped. */
  id: string;
  /** What the player is shown. */
  n: string;
  /** Peak trophies needed to reach it. */
  at: number;
  /** Paid once, at the close, to everyone who reached it. */
  reward: { g: number; i: number };
}

/**
 * The bands, ascending. `at` is the peak needed; the reward is the whole
 * payout for that band, not an increment on the one below, so a player is paid
 * exactly one of these.
 */
export const SEASON_TIERS: readonly SeasonTier[] = [
  { id: 'stone',  n: 'Stone',   at: 200,  reward: { g: 2_000,  i: 700 } },
  { id: 'iron',   n: 'Iron',    at: 500,  reward: { g: 5_000,  i: 1_800 } },
  { id: 'bronze', n: 'Bronze',  at: 900,  reward: { g: 10_000, i: 3_600 } },
  { id: 'silver', n: 'Silver',  at: 1_400, reward: { g: 18_000, i: 6_500 } },
  { id: 'gold',   n: 'Gold',    at: 2_000, reward: { g: 30_000, i: 11_000 } },
  { id: 'ember',  n: 'Crystal', at: 2_800, reward: { g: 48_000, i: 17_000 } },
  { id: 'iron_crown', n: 'Champion', at: 3_800, reward: { g: 75_000, i: 27_000 } },
];

/** The lowest peak that is paid anything at all. */
export const SEASON_MIN_TROPHIES = SEASON_TIERS[0]!.at;

/**
 * The band a peak falls in, or null below the first one.
 *
 * Walks down rather than up so that adding a tier above the last cannot change
 * what an existing peak resolves to.
 */
export function tierAt(peak: number): SeasonTier | null {
  for (let i = SEASON_TIERS.length - 1; i >= 0; i--) {
    const t = SEASON_TIERS[i]!;
    if (peak >= t.at) return t;
  }
  return null;
}

/** The next band up, or null at the top. What the banner counts towards. */
export function nextTier(peak: number): SeasonTier | null {
  for (const t of SEASON_TIERS) if (peak < t.at) return t;
  return null;
}

/** What reaching this peak pays at the close. Zero below the first tier. */
export function seasonReward(peak: number): { g: number; i: number } {
  return tierAt(peak)?.reward ?? { g: 0, i: 0 };
}

/**
 * Where a total lands after the close.
 *
 * Floored, so it is an integer on the way to the database, and never below the
 * floor even for a player who spent the season under it.
 */
export function seasonReset(trophies: number): number {
  if (trophies <= SEASON_RESET_FLOOR) return Math.max(0, Math.min(trophies, SEASON_RESET_FLOOR));
  return SEASON_RESET_FLOOR + Math.floor((trophies - SEASON_RESET_FLOOR) * SEASON_RESET_KEEP);
}

/**
 * When the season that starts at `startedAt` ends.
 *
 * Kept as a function rather than inlined arithmetic because the next season
 * starts from the previous one's *scheduled* end, not from when the worker
 * happened to notice — otherwise a worker that was down for an hour moves every
 * future season an hour later, permanently.
 */
export function seasonEnd(startedAt: Date): Date {
  return new Date(startedAt.getTime() + SEASON_MS);
}

/** Milliseconds left, floored at zero. */
export function seasonLeft(endsAt: Date, now: Date): number {
  return Math.max(0, endsAt.getTime() - now.getTime());
}
