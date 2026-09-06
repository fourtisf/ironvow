import {
  RAID_EXPIRY_MINUTES,
  WAR_ATTACKS,
  WAR_MIN_MEMBERS,
  heroUnlocked,
} from '@ironvow/config';
import { randomSeed } from '@ironvow/sim';
import type { BaseSnapshot, BattleArmy, HeroLoadout, TroopLevels } from '@ironvow/types';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { lockPlayer, settleAndLoad } from '../lib/player.js';
import { COMMAND_TX, prisma, type Tx } from '../lib/prisma.js';
import { pushTo } from '../lib/push.js';
import {
  activeWarOf, canDeclare, liveWarOf, matchSearching, startWar, trophiesOf,
} from '../lib/war.js';
import { armyOf } from './raid.js';
import { serialise } from './auth.js';

/**
 * Clan wars, over the wire.
 *
 * Declaring, challenging, answering and attacking. Every permission is read
 * from the caller's seat in the database; nothing here trusts the client
 * about its rank, its clan, or the result of a fight.
 */

const clanIdSchema = z.object({ clanId: z.string().min(1).max(40) });
const warIdSchema = z.object({ warId: z.string().min(1).max(40) });
const respondSchema = z.object({ warId: z.string().min(1).max(40), accept: z.boolean() });
const attackSchema = z.object({ memberId: z.string().min(1).max(40) });

function refuse(reply: FastifyReply, error: string, code = 409): FastifyReply {
  return reply.code(code).send({ error });
}

async function seatOf(tx: Tx, playerId: string) {
  return tx.clanMember.findUnique({ where: { playerId }, select: { clanId: true, role: true } });
}

const canLead = (role: string): boolean => role === 'leader' || role === 'elder';

export async function warRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /** Everything the WAR tab needs. */
  app.get('/war', async (request, reply) => {
    const seat = await seatOf(prisma, request.playerId!);
    if (!seat) return refuse(reply, 'notInClan');
    const now = new Date();

    const clan = await prisma.clan.findUnique({
      where: { id: seat.clanId },
      select: { id: true, name: true, tag: true, badge: true, warWins: true, warLosses: true, warDraws: true },
    });
    if (!clan) return refuse(reply, 'notInClan');

    const live = await liveWarOf(prisma, seat.clanId);
    // The last finished war stays on the tab for a day, so a member who was
    // asleep for the ending still sees how it went.
    const recent = live ? null : await prisma.clanWar.findFirst({
      where: {
        state: 'done',
        OR: [{ clanAId: seat.clanId }, { clanBId: seat.clanId }],
        endsAt: { gte: new Date(now.getTime() - 86_400_000) },
      },
      orderBy: { endsAt: 'desc' },
    });
    const war = live ?? recent;

    // Challenges waiting on this clan's answer.
    const incomingRows = await prisma.clanWar.findMany({
      where: { state: 'challenge', clanBId: seat.clanId },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    const incoming = await Promise.all(incomingRows.map(async (w) => {
      const c = await prisma.clan.findUnique({
        where: { id: w.clanAId },
        select: { id: true, name: true, tag: true, badge: true, _count: { select: { members: true } } },
      });
      return c ? {
        warId: w.id, clanId: c.id, name: c.name, tag: c.tag, badge: c.badge,
        memberCount: c._count.members, trophies: await trophiesOf(prisma, c.id), at: w.createdAt.toISOString(),
      } : null;
    }));

    let view = null;
    if (war) {
      const mineIsA = war.clanAId === seat.clanId;
      const enemyId = mineIsA ? war.clanBId : war.clanAId;
      const enemy = enemyId ? await prisma.clan.findUnique({
        where: { id: enemyId }, select: { id: true, name: true, tag: true, badge: true },
      }) : null;
      const members = await prisma.warMember.findMany({ where: { warId: war.id }, orderBy: { keepLevel: 'desc' } });
      const attacks = await prisma.warAttack.findMany({ where: { warId: war.id } });
      const used = new Map<string, number>();
      for (const a of attacks) used.set(a.attackerMemberId, (used.get(a.attackerMemberId) ?? 0) + 1);
      const me = members.find((m) => m.playerId === request.playerId) ?? null;

      const side = (clanId: string) => members
        .filter((m) => m.clanId === clanId)
        .map((m) => ({
          memberId: m.id, playerId: m.playerId, name: m.name, keepLevel: m.keepLevel,
          bestStars: m.bestStars, bestPct: m.bestPct,
          attacksUsed: used.get(m.id) ?? 0, attacksLeft: Math.max(0, WAR_ATTACKS - (used.get(m.id) ?? 0)),
          isMe: m.playerId === request.playerId,
        }));

      const ourStars = mineIsA ? war.starsA : war.starsB;
      const ourPct = mineIsA ? war.pctA : war.pctB;
      const theirStars = mineIsA ? war.starsB : war.starsA;
      const theirPct = mineIsA ? war.pctB : war.pctA;
      const result = war.outcome === null ? null
        : war.outcome === 'draw' ? 'draw'
          : (war.outcome === 'a') === mineIsA ? 'won' : 'lost';

      view = {
        id: war.id,
        state: war.state as 'search' | 'challenge' | 'active' | 'done',
        /** For a challenge: whether we sent it or are being asked. */
        challenger: war.state === 'challenge' ? (mineIsA ? 'us' : 'them') : null,
        size: war.size,
        startsAt: war.startsAt?.toISOString() ?? null,
        endsAt: war.endsAt?.toISOString() ?? null,
        secondsLeft: war.endsAt ? Math.max(0, Math.floor((war.endsAt.getTime() - now.getTime()) / 1000)) : 0,
        result,
        us: { clanId: clan.id, name: clan.name, tag: clan.tag, badge: clan.badge, stars: ourStars, pct: ourPct, roster: side(clan.id) },
        them: enemy ? { clanId: enemy.id, name: enemy.name, tag: enemy.tag, badge: enemy.badge, stars: theirStars, pct: theirPct, roster: side(enemy.id) } : null,
        onRoster: me !== null,
        myAttacksLeft: me ? Math.max(0, WAR_ATTACKS - (used.get(me.id) ?? 0)) : 0,
        attacksEach: WAR_ATTACKS,
      };
    }

    return reply.send({
      war: view,
      incoming: incoming.filter((x): x is NonNullable<typeof x> => x !== null),
      record: { wins: clan.warWins, losses: clan.warLosses, draws: clan.warDraws },
      canLead: canLead(seat.role),
      bigEnough: await canDeclare(prisma, seat.clanId),
      minMembers: WAR_MIN_MEMBERS,
    });
  });

  /** Look for any clan that is also looking. */
  app.post('/war/search', async (request, reply) => {
    const now = new Date();
    const out = await prisma.$transaction(async (tx) => {
      const seat = await seatOf(tx, request.playerId!);
      if (!seat) return 'notInClan';
      if (!canLead(seat.role)) return 'notAllowed';
      if (!(await canDeclare(tx, seat.clanId))) return 'clanTooSmall';
      if (await liveWarOf(tx, seat.clanId)) return 'alreadyAtWar';
      await tx.clanWar.create({ data: { state: 'search', clanAId: seat.clanId } });
      await matchSearching(tx, now);
      return 'ok';
    }, COMMAND_TX);
    if (out !== 'ok') return refuse(reply, out);
    return reply.send({ ok: true });
  });

  /** Call out one clan in particular. */
  app.post('/war/challenge', async (request, reply) => {
    const parsed = clanIdSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    const out = await prisma.$transaction(async (tx) => {
      const seat = await seatOf(tx, request.playerId!);
      if (!seat) return { error: 'notInClan' };
      if (!canLead(seat.role)) return { error: 'notAllowed' };
      if (seat.clanId === parsed.data.clanId) return { error: 'thatIsUs' };
      if (!(await canDeclare(tx, seat.clanId))) return { error: 'clanTooSmall' };
      if (await liveWarOf(tx, seat.clanId)) return { error: 'alreadyAtWar' };
      const target = await tx.clan.findUnique({ where: { id: parsed.data.clanId }, select: { id: true, name: true } });
      if (!target) return { error: 'noSuchClan' };
      if (!(await canDeclare(tx, target.id))) return { error: 'theyAreTooSmall' };
      if (await activeWarOf(tx, target.id)) return { error: 'theyAreAtWar' };
      const me = await tx.clan.findUnique({ where: { id: seat.clanId }, select: { name: true } });
      const war = await tx.clanWar.create({ data: { state: 'challenge', clanAId: seat.clanId, clanBId: target.id } });
      await tx.clanMessage.create({
        data: {
          clanId: target.id, playerId: null, authorName: 'War', kind: 'system',
          body: `${me?.name ?? 'A clan'} has challenged us to war. The leader and elders can answer in WAR.`,
        },
      });
      const leads = await tx.clanMember.findMany({
        where: { clanId: target.id, role: { in: ['leader', 'elder'] } }, select: { playerId: true },
      });
      return { ok: true, warId: war.id, leads: leads.map((l) => l.playerId), from: me?.name ?? 'A clan' };
    }, COMMAND_TX);
    if ('error' in out) return refuse(reply, out.error!);
    for (const id of out.leads!) {
      void pushTo(id, { title: 'A war challenge', body: `${out.from} has challenged your clan. Answer in WAR.`, tag: 'war', url: '/' }).catch(() => undefined);
    }
    return reply.send({ ok: true, warId: out.warId });
  });

  /** Accept or decline a challenge. */
  app.post('/war/respond', async (request, reply) => {
    const parsed = respondSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    const now = new Date();
    const out = await prisma.$transaction(async (tx) => {
      const seat = await seatOf(tx, request.playerId!);
      if (!seat) return 'notInClan';
      if (!canLead(seat.role)) return 'notAllowed';
      const war = await tx.clanWar.findUnique({ where: { id: parsed.data.warId } });
      if (!war || war.state !== 'challenge' || war.clanBId !== seat.clanId) return 'noSuchChallenge';
      if (!parsed.data.accept) {
        await tx.clanWar.update({ where: { id: war.id }, data: { state: 'cancelled' } });
        const us = await tx.clan.findUnique({ where: { id: seat.clanId }, select: { name: true } });
        await tx.clanMessage.create({
          data: { clanId: war.clanAId, playerId: null, authorName: 'War', kind: 'system', body: `${us?.name ?? 'They'} declined the challenge.` },
        });
        return 'ok';
      }
      if (await activeWarOf(tx, seat.clanId)) return 'alreadyAtWar';
      if (await activeWarOf(tx, war.clanAId)) return 'theyAreAtWar';
      // Any other pending business either side had is superseded by this war.
      await tx.clanWar.updateMany({
        where: { id: { not: war.id }, state: { in: ['search', 'challenge'] }, OR: [{ clanAId: seat.clanId }, { clanAId: war.clanAId }] },
        data: { state: 'cancelled' },
      });
      await startWar(tx, war.id, war.clanAId, seat.clanId, now);
      return 'ok';
    }, COMMAND_TX);
    if (out !== 'ok') return refuse(reply, out);
    return reply.send({ ok: true });
  });

  /** Withdraw a search or an unanswered challenge. */
  app.post('/war/cancel', async (request, reply) => {
    const parsed = warIdSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    const out = await prisma.$transaction(async (tx) => {
      const seat = await seatOf(tx, request.playerId!);
      if (!seat) return 'notInClan';
      if (!canLead(seat.role)) return 'notAllowed';
      const war = await tx.clanWar.findUnique({ where: { id: parsed.data.warId } });
      if (!war || war.clanAId !== seat.clanId || !(war.state === 'search' || war.state === 'challenge')) return 'noSuchWar';
      await tx.clanWar.update({ where: { id: war.id }, data: { state: 'cancelled' } });
      return 'ok';
    }, COMMAND_TX);
    if (out !== 'ok') return refuse(reply, out);
    return reply.send({ ok: true });
  });

  /**
   * Open a war attack: a raid against a frozen roster base.
   *
   * Same shape as /raid/find, so the client fights it with the same code. The
   * attack is not spent until it is submitted; an open one is handed back
   * rather than a second one opened.
   */
  app.post('/war/attack', async (request, reply) => {
    const parsed = attackSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    const now = new Date();
    const out = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const me = await settleAndLoad(tx, request.playerId!, now);
      const seat = await seatOf(tx, me.id);
      if (!seat) return { error: 'notInClan' };
      const target = await tx.warMember.findUnique({ where: { id: parsed.data.memberId } });
      if (!target) return { error: 'noSuchTarget' };
      const war = await tx.clanWar.findUnique({ where: { id: target.warId } });
      if (!war || war.state !== 'active' || !war.endsAt || war.endsAt.getTime() <= now.getTime()) return { error: 'warOver' };
      if (war.clanAId !== seat.clanId && war.clanBId !== seat.clanId) return { error: 'notYourWar' };
      if (target.clanId === seat.clanId) return { error: 'thatIsUs' };
      const mine = await tx.warMember.findUnique({ where: { warId_playerId: { warId: war.id, playerId: me.id } } });
      if (!mine) return { error: 'notOnRoster' };

      await tx.raid.updateMany({
        where: { attackerId: me.id, status: 'open', expiresAt: { lte: now } },
        data: { status: 'expired' },
      });
      const open = await tx.raid.findFirst({ where: { attackerId: me.id, status: 'open' }, orderBy: { createdAt: 'desc' } });
      if (open) {
        if (open.warId === war.id) return { raid: open, player: me, existing: true };
        return { error: 'raidOpen' };
      }
      const used = await tx.warAttack.count({ where: { warId: war.id, attackerMemberId: mine.id } });
      if (used >= WAR_ATTACKS) return { error: 'noAttacksLeft' };

      const raid = await tx.raid.create({
        data: {
          attackerId: me.id,
          defenderId: target.playerId,
          warId: war.id,
          warMemberId: target.id,
          seed: BigInt(randomSeed()),
          snapshot: target.snapshot as object,
          army: armyOf(me.army) as unknown as object,
          hero: { level: me.heroLevel, available: heroUnlocked(me.keepLevel) && me.heroReadyAt === null } satisfies HeroLoadout as unknown as object,
          troopLevels: me.troopLevels as unknown as object,
          expiresAt: new Date(Math.min(now.getTime() + RAID_EXPIRY_MINUTES * 60_000, war.endsAt.getTime())),
        },
      });
      return { raid, player: me, existing: false };
    }, COMMAND_TX);
    if ('error' in out) return refuse(reply, out.error!);
    const raid = out.raid!;
    return reply.send({
      raidId: raid.id,
      seed: Number(raid.seed),
      snapshot: raid.snapshot as unknown as BaseSnapshot,
      army: raid.army as unknown as BattleArmy,
      hero: (raid.hero as unknown as HeroLoadout | null) ?? { level: 1, available: false },
      troopLevels: (raid.troopLevels as unknown as TroopLevels | null) ?? {},
      expiresAt: raid.expiresAt.toISOString(),
      rerollCost: 0,
      isPlayer: true,
      war: true,
      player: serialise(out.player!),
    });
  });

  /** The last ten wars, for the record. */
  app.get('/war/history', async (request, reply) => {
    const seat = await seatOf(prisma, request.playerId!);
    if (!seat) return refuse(reply, 'notInClan');
    const wars = await prisma.clanWar.findMany({
      where: { state: 'done', OR: [{ clanAId: seat.clanId }, { clanBId: seat.clanId }] },
      orderBy: { endsAt: 'desc' },
      take: 10,
    });
    const rows = await Promise.all(wars.map(async (w) => {
      const mineIsA = w.clanAId === seat.clanId;
      const enemyId = mineIsA ? w.clanBId! : w.clanAId;
      const enemy = await prisma.clan.findUnique({ where: { id: enemyId }, select: { name: true, tag: true } });
      return {
        id: w.id,
        enemy: enemy?.name ?? 'a clan that is gone',
        ours: mineIsA ? w.starsA : w.starsB,
        theirs: mineIsA ? w.starsB : w.starsA,
        result: w.outcome === 'draw' ? 'draw' : (w.outcome === 'a') === mineIsA ? 'won' : 'lost',
        endedAt: w.endsAt?.toISOString() ?? null,
      };
    }));
    return reply.send({ wars: rows });
  });
}
