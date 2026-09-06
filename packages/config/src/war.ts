/**
 * Clan wars.
 *
 * The second game mode, and the one reason to be in a clan beyond talking.
 * The decisions, all TUNABLE, all made here so the client and the server
 * cannot disagree about a single one:
 *
 * - A war is one clan against another for WAR_HOURS, no preparation day. The
 *   roster's bases are frozen the moment the war starts, so rebuilding during
 *   the war changes nothing about the fight the other side walks into.
 * - The roster is the strongest WAR_MAX_ROSTER members of each clan by
 *   trophies, and the two rosters are the same size: the smaller clan sets it.
 *   A clan needs WAR_MIN_MEMBERS to declare at all.
 * - Every member on the roster has WAR_ATTACKS attacks, against any enemy base,
 *   the same base twice if they like. A base's score is the best result any
 *   attacker got against it; the clan's score is the sum over enemy bases. More
 *   stars wins; the tie-break is total destruction; then it is a draw.
 * - War attacks take no loot and move no trophies — nobody is robbed for being
 *   on a roster. The reward comes at the end, per star the member earned, and
 *   doubled for the winning side, scaled by the Keep like the daily orders.
 * - Nothing in a war is decided by the client. Attacks go through the same
 *   replayed simulation as raids; the war only reads its stars.
 */

export const WAR_MIN_MEMBERS = 3;
export const WAR_MAX_ROSTER = 10;
export const WAR_HOURS = 24;
export const WAR_ATTACKS = 2;
/** Per star the attacker personally earned (best per base they hit), before scaling. */
export const WAR_REWARD_PER_STAR = { g: 320, i: 110 };
/** The winning side's members get this much more. */
export const WAR_WIN_MULTIPLIER = 2;
/** A challenge nobody answers is dropped after this long. */
export const WAR_CHALLENGE_HOURS = 24;

export type WarState = 'search' | 'challenge' | 'active' | 'done' | 'cancelled';

export type WarOutcome = 'a' | 'b' | 'draw';

/** How many bases each side fields. */
export function rosterSize(membersA: number, membersB: number): number {
  return Math.min(WAR_MAX_ROSTER, membersA, membersB);
}

/** Who won, from the two totals. */
export function warOutcome(starsA: number, pctA: number, starsB: number, pctB: number): WarOutcome {
  if (starsA !== starsB) return starsA > starsB ? 'a' : 'b';
  // Percentages are summed floats from the sim; compare with a tolerance a
  // single building could never fall inside.
  if (Math.abs(pctA - pctB) > 1e-6) return pctA > pctB ? 'a' : 'b';
  return 'draw';
}

/** A member's payout at the end. Integer arithmetic on the way to the DB. */
export function warReward(stars: number, keepLevel: number, won: boolean): { g: number; i: number } {
  const k = Math.max(1, keepLevel);
  const m = won ? WAR_WIN_MULTIPLIER : 1;
  return {
    g: WAR_REWARD_PER_STAR.g * stars * k * m,
    i: WAR_REWARD_PER_STAR.i * stars * k * m,
  };
}

/**
 * Best result per defender, folded into a clan total.
 *
 * Takes every attack the clan made and returns the sum of the best stars and
 * the best destruction against each distinct enemy base. Pure, so the worker
 * that settles a war and the sheet that shows it in progress agree.
 */
export function clanScore(
  attacks: readonly { defenderMemberId: string; stars: number; destroyedPct: number }[],
): { stars: number; pct: number } {
  const best = new Map<string, { stars: number; pct: number }>();
  for (const a of attacks) {
    const cur = best.get(a.defenderMemberId);
    if (!cur || a.stars > cur.stars || (a.stars === cur.stars && a.destroyedPct > cur.pct)) {
      best.set(a.defenderMemberId, { stars: a.stars, pct: a.destroyedPct });
    }
  }
  let stars = 0;
  let pct = 0;
  for (const b of best.values()) { stars += b.stars; pct += b.pct; }
  return { stars, pct };
}

/** What one attacker earned: their own best per base, summed. */
export function attackerStars(
  attacks: readonly { defenderMemberId: string; stars: number; destroyedPct: number }[],
): number {
  return clanScore(attacks).stars;
}
