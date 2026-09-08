import {
  WAR_ATTACKS,
  WAR_CHALLENGE_HOURS,
  WAR_HOURS,
  WAR_MIN_MEMBERS,
  clanScore,
  clanTrophies,
  rosterSize,
  warOutcome,
  warReward,
  warShards,
  type BuildingType,
} from '@ironvow/config';
import type { BaseSnapshot } from '@ironvow/types';
import { grant } from '../domain/production.js';
import { snapshotBase } from '../domain/raid.js';
import { prisma, type Tx } from './prisma.js';
import { pushTo } from './push.js';

/**
 * Clan wars: the parts that touch the database.
 *
 * The rules are in @ironvow/config; this is where they are applied to rows.
 * Everything that changes a war's state — starting it, recording an attack,
 * settling it — is here and nowhere else, so the route, the worker and the
 * tests all go through the same code.
 */

export type WarRow = NonNullable<Awaited<ReturnType<typeof prisma.clanWar.findUnique>>>;

/** A clan's live war: searching, challenged, challenging, or fighting. */
export async function liveWarOf(tx: Tx, clanId: string) {
  return tx.clanWar.findFirst({
    where: {
      state: { in: ['search', 'challenge', 'active'] },
      OR: [{ clanAId: clanId }, { clanBId: clanId }],
    },
    orderBy: { createdAt: 'desc' },
  });
}

/** Only an active war stops a clan from starting another. */
export async function activeWarOf(tx: Tx, clanId: string) {
  return tx.clanWar.findFirst({
    where: { state: 'active', OR: [{ clanAId: clanId }, { clanBId: clanId }] },
  });
}

async function say(tx: Tx, clanId: string, body: string): Promise<void> {
  await tx.clanMessage.create({
    data: { clanId, playerId: null, authorName: 'War', kind: 'system', body },
  });
}

interface RosterSource {
  id: string;
  name: string;
  keepLevel: number;
  trophies: number;
  gold: bigint;
  iron: bigint;
  buildings: {
    id: string; type: string; gx: number; gy: number; level: number;
    completesAt: Date | null; upgradingTo: number | null;
  }[];
}

async function clanPlayers(tx: Tx, clanId: string): Promise<RosterSource[]> {
  const members = await tx.clanMember.findMany({
    where: { clanId },
    select: {
      player: {
        select: {
          id: true, name: true, keepLevel: true, trophies: true, gold: true, iron: true,
          buildings: true,
        },
      },
    },
  });
  return members.map((m) => m.player);
}

/**
 * Begin a war between two clans: freeze the rosters and start the clock.
 *
 * The roster is the strongest N of each clan by trophies, where N is what the
 * smaller clan can field. Each base is snapshotted exactly as a raid would
 * snapshot it — scaffolding left out — and with an empty loot pool, because a
 * war attack takes nothing.
 */
export async function startWar(tx: Tx, warId: string, clanAId: string, clanBId: string, now: Date): Promise<void> {
  const [a, b] = await Promise.all([clanPlayers(tx, clanAId), clanPlayers(tx, clanBId)]);
  const size = rosterSize(a.length, b.length);
  const pick = (list: RosterSource[]): RosterSource[] =>
    [...list].sort((x, y) => y.trophies - x.trophies).slice(0, size);

  const freeze = (p: RosterSource): BaseSnapshot => {
    const snap = snapshotBase({
      id: p.id, name: p.name, keepLevel: p.keepLevel, gold: p.gold, iron: p.iron,
      buildings: p.buildings
        .filter((x) => !(x.completesAt !== null && x.upgradingTo === null))
        .map((x) => ({ id: x.id, type: x.type as BuildingType, gx: x.gx, gy: x.gy, level: x.level })),
    });
    return { ...snap, pool: { g: 0, i: 0 } };
  };

  const rows = [...pick(a).map((p) => ({ clanId: clanAId, p })), ...pick(b).map((p) => ({ clanId: clanBId, p }))];
  await tx.warMember.createMany({
    data: rows.map(({ clanId, p }) => ({
      warId, clanId, playerId: p.id, name: p.name, keepLevel: p.keepLevel,
      snapshot: freeze(p) as unknown as object,
    })),
  });

  const endsAt = new Date(now.getTime() + WAR_HOURS * 3_600_000);
  await tx.clanWar.update({
    where: { id: warId },
    data: { state: 'active', clanBId, size, startsAt: now, endsAt },
  });

  const [clanA, clanB] = await Promise.all([
    tx.clan.findUnique({ where: { id: clanAId }, select: { name: true } }),
    tx.clan.findUnique({ where: { id: clanBId }, select: { name: true } }),
  ]);
  await say(tx, clanAId, `War against ${clanB?.name ?? 'an enemy'} has begun — ${size} a side, ${WAR_HOURS} hours, ${WAR_ATTACKS} attacks each. Open WAR.`);
  await say(tx, clanBId, `War against ${clanA?.name ?? 'an enemy'} has begun — ${size} a side, ${WAR_HOURS} hours, ${WAR_ATTACKS} attacks each. Open WAR.`);

  // Fire-and-forget: a notification that does not arrive changes nothing.
  for (const { clanId, p } of rows) {
    const enemy = clanId === clanAId ? clanB?.name : clanA?.name;
    void pushTo(p.id, {
      title: 'War has begun',
      body: `Your clan is at war with ${enemy ?? 'an enemy'}. You have ${WAR_ATTACKS} attacks.`,
      tag: 'war',
      url: '/',
    }).catch(() => undefined);
  }
}

/**
 * Pair up clans that are searching. Oldest first, so nobody waits forever
 * behind newcomers. Called from the declare route and again by the worker,
 * which is what catches two clans that declared in the same second.
 */
export async function matchSearching(tx: Tx, now: Date): Promise<number> {
  const searching = await tx.clanWar.findMany({
    where: { state: 'search' },
    orderBy: { createdAt: 'asc' },
  });
  let started = 0;
  for (let i = 0; i + 1 < searching.length; i += 2) {
    const x = searching[i]!;
    const y = searching[i + 1]!;
    if (x.clanAId === y.clanAId) continue;
    await tx.clanWar.update({ where: { id: y.id }, data: { state: 'cancelled' } });
    await startWar(tx, x.id, x.clanAId, y.clanAId, now);
    started++;
  }
  return started;
}

/** A challenge nobody answered. */
export async function expireChallenges(tx: Tx, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - WAR_CHALLENGE_HOURS * 3_600_000);
  const r = await tx.clanWar.updateMany({
    where: { state: 'challenge', createdAt: { lte: cutoff } },
    data: { state: 'cancelled' },
  });
  return r.count;
}

/**
 * Write down a settled war attack and refresh both running totals.
 *
 * Called from the raid submit route inside its transaction, after the
 * simulation has been replayed: the stars here are the server's, never the
 * client's.
 */
export async function recordWarAttack(
  tx: Tx,
  args: { warId: string; attackerPlayerId: string; defenderMemberId: string; raidId: string; stars: number; destroyedPct: number },
): Promise<void> {
  const war = await tx.clanWar.findUnique({ where: { id: args.warId } });
  if (!war || war.state !== 'active') return;
  const attacker = await tx.warMember.findUnique({
    where: { warId_playerId: { warId: args.warId, playerId: args.attackerPlayerId } },
  });
  if (!attacker) return;

  await tx.warAttack.create({
    data: {
      warId: args.warId,
      attackerMemberId: attacker.id,
      defenderMemberId: args.defenderMemberId,
      stars: args.stars,
      destroyedPct: args.destroyedPct,
      raidId: args.raidId,
    },
  });

  const defender = await tx.warMember.findUnique({ where: { id: args.defenderMemberId } });
  if (defender && (args.stars > defender.bestStars || (args.stars === defender.bestStars && args.destroyedPct > defender.bestPct))) {
    await tx.warMember.update({
      where: { id: defender.id },
      data: { bestStars: args.stars, bestPct: args.destroyedPct },
    });
  }

  await refreshScores(tx, args.warId);
}

async function refreshScores(tx: Tx, warId: string): Promise<{ starsA: number; pctA: number; starsB: number; pctB: number }> {
  const war = await tx.clanWar.findUnique({ where: { id: warId } });
  if (!war) return { starsA: 0, pctA: 0, starsB: 0, pctB: 0 };
  const members = await tx.warMember.findMany({ where: { warId }, select: { id: true, clanId: true } });
  const clanOf = new Map(members.map((m) => [m.id, m.clanId]));
  const attacks = await tx.warAttack.findMany({ where: { warId } });
  const byA = attacks.filter((x) => clanOf.get(x.attackerMemberId) === war.clanAId);
  const byB = attacks.filter((x) => clanOf.get(x.attackerMemberId) === war.clanBId);
  const a = clanScore(byA);
  const b = clanScore(byB);
  await tx.clanWar.update({
    where: { id: warId },
    data: { starsA: a.stars, pctA: a.pct, starsB: b.stars, pctB: b.pct },
  });
  return { starsA: a.stars, pctA: a.pct, starsB: b.stars, pctB: b.pct };
}

/**
 * Close a war whose clock has run out: decide it, pay everyone, tell both
 * rooms. Idempotent on state, so the worker running twice cannot pay twice.
 */
export async function settleWar(tx: Tx, warId: string, now: Date): Promise<boolean> {
  const war = await tx.clanWar.findUnique({ where: { id: warId } });
  if (!war || war.state !== 'active' || !war.clanBId) return false;

  const score = await refreshScores(tx, warId);
  const outcome = warOutcome(score.starsA, score.pctA, score.starsB, score.pctB);
  await tx.clanWar.update({ where: { id: warId }, data: { state: 'done', outcome } });

  const winner = outcome === 'a' ? war.clanAId : outcome === 'b' ? war.clanBId : null;
  for (const clanId of [war.clanAId, war.clanBId]) {
    const won = winner === clanId;
    await tx.clan.update({
      where: { id: clanId },
      data: outcome === 'draw' ? { warDraws: { increment: 1 } } : won ? { warWins: { increment: 1 } } : { warLosses: { increment: 1 } },
    });
  }

  // Pay per member: their own best stars per base, doubled on the winning side.
  const members = await tx.warMember.findMany({ where: { warId } });
  const attacks = await tx.warAttack.findMany({ where: { warId } });
  for (const m of members) {
    const mine = attacks.filter((x) => x.attackerMemberId === m.id);
    const stars = clanScore(mine).stars;
    const reward = warReward(stars, m.keepLevel, winner === m.clanId);
    if (reward.g === 0 && reward.i === 0) continue;
    const player = await tx.player.findUnique({
      where: { id: m.playerId },
      select: { gold: true, iron: true, buildings: { select: { type: true, level: true } } },
    });
    if (!player) continue;
    const credited = grant(player.gold, player.iron, reward.g, reward.i,
      player.buildings.map((b) => ({ type: b.type as BuildingType, level: b.level })));
    /*
     * Shards, alongside the gold.
     *
     * Uncapped, unlike the purse: storage is a rule about gold and iron, and a
     * player who fought a war and came back to a full Vault must not lose the
     * only currency that buys the progression past a maxed Keep. That is
     * exactly the player relics exist for.
     */
    const shards = warShards(stars, winner === m.clanId);
    await tx.player.update({
      where: { id: m.playerId },
      data: {
        gold: credited.gold,
        iron: credited.iron,
        ...(shards > 0 ? { shards: { increment: shards } } : {}),
      },
    });
    void pushTo(m.playerId, {
      title: winner === m.clanId ? 'Your clan won the war' : outcome === 'draw' ? 'The war was a draw' : 'Your clan lost the war',
      body: `${reward.g} gold and ${shards} shard${shards === 1 ? '' : 's'} for your ${stars} star${stars === 1 ? '' : 's'}.`,
      tag: 'war',
      url: '/',
    }).catch(() => undefined);
  }

  const [clanA, clanB] = await Promise.all([
    tx.clan.findUnique({ where: { id: war.clanAId }, select: { name: true } }),
    tx.clan.findUnique({ where: { id: war.clanBId }, select: { name: true } }),
  ]);
  const line = (us: string, them: string, ours: number, theirs: number, won: boolean | null): string =>
    won === null
      ? `The war against ${them} ended in a draw, ${ours}–${theirs}.`
      : won
        ? `${us} won the war against ${them}, ${ours}–${theirs}.`
        : `${them} won the war, ${theirs}–${ours}. Next time.`;
  await say(tx, war.clanAId, line(clanA?.name ?? 'We', clanB?.name ?? 'the enemy', score.starsA, score.starsB, outcome === 'draw' ? null : outcome === 'a'));
  await say(tx, war.clanBId, line(clanB?.name ?? 'We', clanA?.name ?? 'the enemy', score.starsB, score.starsA, outcome === 'draw' ? null : outcome === 'b'));
  void now;
  return true;
}

/** Wars whose clock has run out. For the worker. */
export async function settleDueWars(now: Date): Promise<number> {
  const due = await prisma.clanWar.findMany({
    where: { state: 'active', endsAt: { lte: now } },
    select: { id: true },
  });
  let n = 0;
  for (const w of due) {
    const ok = await prisma.$transaction((tx) => settleWar(tx, w.id, now));
    if (ok) n++;
  }
  return n;
}

/** Whether a clan is big enough to go to war. */
export async function canDeclare(tx: Tx, clanId: string): Promise<boolean> {
  const n = await tx.clanMember.count({ where: { clanId } });
  return n >= WAR_MIN_MEMBERS;
}

/** Trophies of a clan, for the challenge list. */
export async function trophiesOf(tx: Tx, clanId: string): Promise<number> {
  const members = await tx.clanMember.findMany({ where: { clanId }, select: { player: { select: { trophies: true } } } });
  return clanTrophies(members.map((m) => ({ trophies: m.player.trophies })));
}
