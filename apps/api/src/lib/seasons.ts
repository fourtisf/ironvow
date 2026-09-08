import {
  SEASON_MIN_TROPHIES,
  SEASON_TIERS,
  seasonShards,
  SEASON_RESET_FLOOR,
  SEASON_RESET_KEEP,
  seasonEnd,
  seasonReward,
  tierAt,
  type BuildingType,
} from '@ironvow/config';
import { grant } from '../domain/production.js';
import { prisma, type Tx } from './prisma.js';
import { pushTo } from './push.js';

/**
 * Seasons: the parts that touch the database.
 *
 * The rules are in `packages/config/src/seasons.ts`; this applies them to rows.
 * The invariant everything here exists to protect is that **a season is closed
 * exactly once**: paying the ladder twice is the single worst bug this feature
 * could have, because it is silent, it is a faucet, and by the time anybody
 * notices the gold has been spent.
 */

const SEASON_TX = { maxWait: 15_000, timeout: 120_000 } as const;

export interface SeasonRow {
  id: string;
  index: number;
  startedAt: Date;
  endsAt: Date;
  closedAt: Date | null;
}

/**
 * The season that is running, opening the first one if the table is empty.
 *
 * Called on the read path as well as by the worker, so a deployment where the
 * worker has not come up yet still shows a live season rather than nothing.
 * `index` is unique, so two callers racing to open the same season resolve to
 * one row and the loser re-reads it.
 */
export async function currentSeason(now: Date = new Date()): Promise<SeasonRow> {
  const open = await prisma.season.findFirst({
    where: { closedAt: null },
    orderBy: { index: 'desc' },
  });
  if (open) return open;

  const last = await prisma.season.findFirst({ orderBy: { index: 'desc' } });
  const index = (last?.index ?? 0) + 1;
  // A season that follows another starts when the previous one was scheduled to
  // end, not when this code ran: a worker that was down for a day must not push
  // every future season a day later, permanently.
  const startedAt = last?.endsAt ?? now;
  try {
    return await prisma.season.create({
      data: { index, startedAt, endsAt: seasonEnd(startedAt) },
    });
  } catch {
    // Lost the race on `index`. The winner's row is the answer.
    const won = await prisma.season.findFirst({ where: { closedAt: null }, orderBy: { index: 'desc' } });
    if (won) return won;
    throw new Error('season could not be opened');
  }
}

/**
 * Keep the season peak honest after a trophy change.
 *
 * Returned rather than written, because every caller is already inside the
 * `player.update` that moved the trophies and a second write would be a second
 * row lock for no reason.
 */
export function peakAfter(seasonPeak: number, trophies: number): number {
  return trophies > seasonPeak ? trophies : seasonPeak;
}

export interface SeasonClose {
  seasonId: string;
  index: number;
  paid: number;
  gold: number;
  iron: number;
}

/**
 * Close every season whose clock has run out, and open its successor.
 *
 * One transaction for the whole thing. It is not the cheapest shape — a few
 * thousand player updates go through it — but it is the only one where "paid
 * but not reset" and "reset but not paid" are both unreachable, and this runs
 * once a fortnight rather than once a minute.
 *
 * The claim is `updateMany ... where closedAt is null`. Two workers reaching
 * the same due season set it in one statement each and exactly one reports a
 * count of 1; the other returns without paying anybody.
 */
export async function closeDueSeasons(now: Date = new Date()): Promise<SeasonClose[]> {
  const due = await prisma.season.findMany({
    where: { closedAt: null, endsAt: { lte: now } },
    orderBy: { index: 'asc' },
  });
  const closed: SeasonClose[] = [];
  for (const season of due) {
    const result = await closeOne(season, now);
    if (result) closed.push(result);
  }
  // Whatever happened above, there must be a season running when this returns.
  await currentSeason(now);
  return closed;
}

async function closeOne(season: SeasonRow, now: Date): Promise<SeasonClose | null> {
  const notify: { playerId: string; gold: number; iron: number; tier: string; rank: number }[] = [];

  const summary = await prisma.$transaction(async (tx) => {
    const claim = await tx.season.updateMany({
      where: { id: season.id, closedAt: null },
      data: { closedAt: now },
    });
    // Somebody else is closing it, or already has. Not an error, and not ours.
    if (claim.count === 0) return null;

    const paid = await payLadder(tx, season, notify);

    /*
     * The reset, as one statement.
     *
     * Every player, not only the paid ones: a season that leaves the bottom of
     * the ladder untouched is one where the bottom of the ladder slowly becomes
     * the middle. `seasonPeak` starts the next season at the post-reset total
     * rather than at zero, so the first raid of a season cannot be worth a tier.
     */
    await tx.$executeRaw`
      UPDATE "Player"
      SET "trophies" = CASE
            WHEN "trophies" <= ${SEASON_RESET_FLOOR} THEN GREATEST(0, "trophies")
            ELSE ${SEASON_RESET_FLOOR} + FLOOR(("trophies" - ${SEASON_RESET_FLOOR}) * ${SEASON_RESET_KEEP})
          END
      `;
    await tx.$executeRaw`UPDATE "Player" SET "seasonPeak" = "trophies"`;

    const startedAt = season.endsAt;
    await tx.season.create({
      data: { index: season.index + 1, startedAt, endsAt: seasonEnd(startedAt) },
    });

    return {
      seasonId: season.id,
      index: season.index,
      paid: paid.count,
      gold: paid.gold,
      iron: paid.iron,
    };
  }, SEASON_TX);

  if (!summary) return null;

  // Outside the transaction on purpose: a push that fails must not roll back a
  // payout, and a transaction held open across the network is a lock held
  // across the network.
  for (const n of notify) {
    void pushTo(n.playerId, {
      title: `Season ${season.index} is over`,
      body: `${n.tier}, rank ${n.rank}. ${n.gold} gold and ${n.iron} iron.`,
      tag: 'season',
      url: '/',
    }).catch(() => undefined);
  }
  return summary;
}

/**
 * Pay everyone who reached the first tier, in ladder order.
 *
 * The ordering is the live ladder's — peak descending, then who got there
 * first — so the rank on the receipt is the rank the player was watching.
 */
async function payLadder(
  tx: Tx,
  season: SeasonRow,
  notify: { playerId: string; gold: number; iron: number; tier: string; rank: number }[],
): Promise<{ count: number; gold: number; iron: number }> {
  const winners = await tx.player.findMany({
    where: { seasonPeak: { gte: SEASON_MIN_TROPHIES } },
    orderBy: [{ seasonPeak: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true, seasonPeak: true, gold: true, iron: true,
      buildings: { select: { type: true, level: true } },
    },
  });

  let gold = 0;
  let iron = 0;
  const rows: { seasonId: string; playerId: string; rank: number; trophies: number; tier: string; gold: number; iron: number }[] = [];

  for (let i = 0; i < winners.length; i++) {
    const p = winners[i]!;
    const tier = tierAt(p.seasonPeak);
    if (!tier) continue;
    const reward = seasonReward(p.seasonPeak);

    // Capped like every other payout in the game. A hold that climbed to a tier
    // and never built a Vault to hold the prize is the same trade the rest of
    // the economy already makes.
    const credited = grant(p.gold, p.iron, reward.g, reward.i,
      p.buildings.map((b) => ({ type: b.type as BuildingType, level: b.level })));
    /*
     * Shards, and the reason this second source exists at all.
     *
     * Wars are the main road to a relic, and wars need a clan. A player with
     * no clan must not be locked out of the only progression left after a
     * maxed Keep, so a season close pays some too — deliberately the slower
     * road, since a season is a fortnight and a war is a day, so joining a
     * clan is still plainly the better answer.
     *
     * Uncapped, unlike the purse: storage is a rule about gold and iron.
     */
    const shards = seasonShards(SEASON_TIERS.findIndex((t) => t.id === tier.id));
    await tx.player.update({
      where: { id: p.id },
      data: {
        gold: credited.gold,
        iron: credited.iron,
        ...(shards > 0 ? { shards: { increment: shards } } : {}),
      },
    });

    rows.push({
      seasonId: season.id, playerId: p.id, rank: i + 1,
      trophies: p.seasonPeak, tier: tier.id, gold: reward.g, iron: reward.i,
    });
    gold += reward.g;
    iron += reward.i;
    notify.push({ playerId: p.id, gold: reward.g, iron: reward.i, tier: tier.n, rank: i + 1 });
  }

  if (rows.length > 0) {
    // `skipDuplicates` against the (seasonId, playerId) unique: belt and braces
    // behind the claim, and it makes a manual re-run of a half-finished close
    // survivable rather than an error.
    await tx.seasonResult.createMany({ data: rows, skipDuplicates: true });
  }
  return { count: rows.length, gold, iron };
}

/** Where this player stands in the running season. */
export async function standing(playerId: string, now: Date = new Date()): Promise<{
  season: SeasonRow;
  peak: number;
  trophies: number;
  rank: number;
  contenders: number;
  last: { index: number; rank: number; trophies: number; tier: string; gold: number; iron: number } | null;
}> {
  const season = await currentSeason(now);
  const me = await prisma.player.findUniqueOrThrow({
    where: { id: playerId },
    select: { seasonPeak: true, trophies: true, createdAt: true },
  });
  const ahead = await prisma.player.count({
    where: {
      OR: [
        { seasonPeak: { gt: me.seasonPeak } },
        { seasonPeak: me.seasonPeak, createdAt: { lt: me.createdAt } },
      ],
    },
  });
  const contenders = await prisma.player.count({ where: { seasonPeak: { gte: SEASON_MIN_TROPHIES } } });
  const previous = await prisma.seasonResult.findFirst({
    where: { playerId },
    orderBy: { createdAt: 'desc' },
    select: { rank: true, trophies: true, tier: true, gold: true, iron: true, season: { select: { index: true } } },
  });
  return {
    season,
    peak: me.seasonPeak,
    trophies: me.trophies,
    rank: ahead + 1,
    contenders,
    last: previous
      ? {
          index: previous.season.index, rank: previous.rank, trophies: previous.trophies,
          tier: previous.tier, gold: previous.gold, iron: previous.iron,
        }
      : null,
  };
}
