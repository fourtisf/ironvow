import {
  TROOP,
  donationReward,
  garrisonRoomFor,
  isTroopType,
  parseGarrison,
  CHAT_HISTORY,
  CHAT_RATE_LIMIT,
  CHAT_RATE_WINDOW_MS,
  CLAN_BADGES,
  CLAN_CREATE_COST,
  CLAN_CREATE_KEEP_LEVEL,
  CLAN_DESC_MAX,
  CLAN_MAX_MEMBERS,
  CLAN_NAME_MAX,
  CLAN_TAG_MAX,
  cleanClanName,
  cleanMessage,
  cleanTag,
  clanTrophies,
  isClanRole,
  isJoinPolicy,
  outranks,
  validClanName,
  validTag,
  type ClanRole,
  type JoinPolicy,
  DAY,
} from '@ironvow/config';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { lockPlayer, settleAndLoad } from '../lib/player.js';
import { COMMAND_TX, prisma, type Tx } from '../lib/prisma.js';
import { serialise } from './auth.js';

/**
 * Clans and clan chat.
 *
 * Two rules run through all of it.
 *
 * One: a player is in at most one clan, and that is enforced by a unique index
 * on `ClanMember.playerId` rather than by a check anyone can forget. Two race
 * conditions that would each produce a double membership both end as a
 * constraint violation instead.
 *
 * Two: every permission is decided from the row in the database, never from
 * anything the client says about itself. The client is told its role only so
 * it can hide buttons that would be refused anyway.
 */

const createSchema = z.object({
  name: z.string().min(1).max(CLAN_NAME_MAX * 2),
  tag: z.string().min(1).max(CLAN_TAG_MAX * 2),
  description: z.string().max(CLAN_DESC_MAX * 2).optional(),
  joinPolicy: z.string().max(16).optional(),
  minTrophies: z.number().int().min(0).max(10_000).optional(),
  badge: z.number().int().min(0).max(CLAN_BADGES - 1).optional(),
});

const idSchema = z.object({ clanId: z.string().min(1).max(40) });
const playerSchema = z.object({ playerId: z.string().min(1).max(40) });
const donateSchema = z.object({
  playerId: z.string().min(1).max(40),
  type: z.string().min(1).max(20),
  count: z.number().int().min(1).max(20),
});
const roleSchema = z.object({ playerId: z.string().min(1).max(40), role: z.string().max(16) });
const decideSchema = z.object({ playerId: z.string().min(1).max(40), accept: z.boolean() });
const messageSchema = z.object({ body: z.string().min(1).max(2000) });
const messageIdSchema = z.object({ messageId: z.string().min(1).max(40) });
const settingsSchema = z.object({
  description: z.string().max(CLAN_DESC_MAX * 2).optional(),
  joinPolicy: z.string().max(16).optional(),
  minTrophies: z.number().int().min(0).max(10_000).optional(),
  badge: z.number().int().min(0).max(CLAN_BADGES - 1).optional(),
});

/** A member row plus the player fields the list actually shows. */
const MEMBER_SELECT = {
  role: true,
  joinedAt: true,
  player: { select: { id: true, name: true, trophies: true, keepLevel: true } },
} as const;

type MemberRow = {
  role: string;
  joinedAt: Date;
  player: { id: string; name: string; trophies: number; keepLevel: number };
};

function memberView(m: MemberRow) {
  return {
    id: m.player.id,
    name: m.player.name,
    trophies: m.player.trophies,
    keepLevel: m.player.keepLevel,
    role: m.role as ClanRole,
    joinedAt: m.joinedAt.toISOString(),
  };
}

/** Sorted by rank, then by trophies — the order a member list is read in. */
function sortMembers(members: MemberRow[]): MemberRow[] {
  const rank: Record<string, number> = { leader: 0, elder: 1, member: 2 };
  return [...members].sort(
    (a, b) => (rank[a.role]! - rank[b.role]!) || (b.player.trophies - a.player.trophies),
  );
}

/** The caller's seat, or null. One query, used by everything below. */
async function seatOf(tx: Tx, playerId: string) {
  return tx.clanMember.findUnique({
    where: { playerId },
    select: { clanId: true, role: true },
  });
}

function refuse(reply: FastifyReply, error: string, code = 409): FastifyReply {
  return reply.code(code).send({ error });
}

export async function clanRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /* ------------------------------------------------------------- my clan --- */

  /**
   * Everything the clan screen needs in one call.
   *
   * Pending applications are included only for an elder or the leader, because
   * a member has no button that could act on them and no business seeing who
   * has been turned down.
   */
  app.get('/clan', async (request, reply) => {
    const seat = await seatOf(prisma, request.playerId!);
    if (!seat) return reply.send({ clan: null, role: null });

    const clan = await prisma.clan.findUnique({
      where: { id: seat.clanId },
      include: { members: { select: MEMBER_SELECT } },
    });
    if (!clan) return reply.send({ clan: null, role: null });

    const role = seat.role as ClanRole;
    const canModerate = role === 'leader' || role === 'elder';
    const requests = canModerate
      ? await prisma.clanRequest.findMany({
        where: { clanId: clan.id },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: {
          createdAt: true,
          player: { select: { id: true, name: true, trophies: true, keepLevel: true } },
        },
      })
      : [];

    return reply.send({
      role,
      clan: {
        id: clan.id,
        name: clan.name,
        tag: clan.tag,
        description: clan.description,
        joinPolicy: clan.joinPolicy as JoinPolicy,
        minTrophies: clan.minTrophies,
        badge: clan.badge,
        memberCount: clan.members.length,
        maxMembers: CLAN_MAX_MEMBERS,
        trophies: clanTrophies(clan.members.map((m) => ({ trophies: m.player.trophies }))),
        members: sortMembers(clan.members).map(memberView),
      },
      requests: requests.map((r) => ({
        id: r.player.id,
        name: r.player.name,
        trophies: r.player.trophies,
        keepLevel: r.player.keepLevel,
        at: r.createdAt.toISOString(),
      })),
    });
  });

  /* --------------------------------------------------------------- find --- */

  /** Search, or the strongest clans when there is nothing to search for. */
  app.get('/clans', async (request, reply) => {
    const q = cleanClanName(String((request.query as { q?: string } | undefined)?.q ?? ''));
    const clans = await prisma.clan.findMany({
      where: q.length > 0
        ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { tag: { contains: cleanTag(q) } }] }
        : {},
      include: { members: { select: { player: { select: { trophies: true } } } } },
      take: 60,
    });

    const rows = clans
      .map((c) => ({
        id: c.id,
        name: c.name,
        tag: c.tag,
        description: c.description,
        joinPolicy: c.joinPolicy as JoinPolicy,
        minTrophies: c.minTrophies,
        badge: c.badge,
        memberCount: c.members.length,
        maxMembers: CLAN_MAX_MEMBERS,
        trophies: clanTrophies(c.members.map((m) => ({ trophies: m.player.trophies }))),
      }))
      // Strongest first. A clan with room is not promoted over a stronger one:
      // the list says how full each is and lets the player decide.
      .sort((a, b) => b.trophies - a.trophies)
      .slice(0, 30);

    return reply.send({ clans: rows });
  });

  /** The clan ladder, which is the only shared scoreboard in the game. */
  app.get('/leaderboard/clans', async (request, reply) => {
    const clans = await prisma.clan.findMany({
      include: { members: { select: { playerId: true, player: { select: { trophies: true } } } } },
      take: 500,
    });
    const rows = clans
      .map((c) => ({
        id: c.id,
        name: c.name,
        tag: c.tag,
        badge: c.badge,
        memberCount: c.members.length,
        trophies: clanTrophies(c.members.map((m) => ({ trophies: m.player.trophies }))),
        isMine: c.members.some((m) => m.playerId === request.playerId),
      }))
      .sort((a, b) => b.trophies - a.trophies)
      .slice(0, 50)
      .map((c, i) => ({ ...c, rank: i + 1 }));

    return reply.send({ top: rows });
  });

  /* ------------------------------------------------------------- create --- */

  app.post('/clans', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const name = cleanClanName(parsed.data.name);
    const tag = cleanTag(parsed.data.tag);
    if (!validClanName(name)) return refuse(reply, 'badName', 400);
    if (!validTag(tag)) return refuse(reply, 'badTag', 400);

    const policy = parsed.data.joinPolicy ?? 'open';
    if (!isJoinPolicy(policy)) return refuse(reply, 'badPolicy', 400);

    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const player = await settleAndLoad(tx, request.playerId!);

      if (await seatOf(tx, player.id)) return { ok: false as const, error: 'alreadyInClan' };
      if (player.keepLevel < CLAN_CREATE_KEEP_LEVEL) {
        return { ok: false as const, error: 'keepTooLow' };
      }
      // Re-derived here, never taken from the client — the same rule as every
      // other cost in the game.
      if (player.gold < BigInt(CLAN_CREATE_COST.g)) {
        return { ok: false as const, error: 'cannotAfford' };
      }
      if (await tx.clan.findFirst({ where: { OR: [{ name }, { tag }] }, select: { id: true } })) {
        return { ok: false as const, error: 'nameTaken' };
      }

      const clan = await tx.clan.create({
        data: {
          name,
          tag,
          description: (parsed.data.description ?? '').replace(/\s+/g, ' ').trim().slice(0, CLAN_DESC_MAX),
          joinPolicy: policy,
          minTrophies: parsed.data.minTrophies ?? 0,
          badge: parsed.data.badge ?? 0,
          members: { create: { playerId: player.id, role: 'leader' } },
        },
        select: { id: true },
      });
      await tx.player.update({
        where: { id: player.id },
        data: { gold: { decrement: BigInt(CLAN_CREATE_COST.g) } },
      });
      await tx.clanMessage.create({
        data: {
          clanId: clan.id, playerId: null, authorName: player.name,
          kind: 'system', body: `${player.name} founded the clan.`,
        },
      });

      return { ok: true as const, clanId: clan.id, player: await settleAndLoad(tx, player.id) };
    }, COMMAND_TX);

    if (!result.ok) return refuse(reply, result.error);
    return reply.send({ clanId: result.clanId, player: serialise(result.player) });
  });

  /* --------------------------------------------------------------- join --- */

  app.post('/clan/join', async (request, reply) => {
    const parsed = idSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const result = await prisma.$transaction(async (tx) => {
      const player = await tx.player.findUnique({
        where: { id: request.playerId! },
        select: { id: true, name: true, trophies: true },
      });
      if (!player) return { ok: false as const, error: 'noSuchPlayer' };
      if (await seatOf(tx, player.id)) return { ok: false as const, error: 'alreadyInClan' };

      const clan = await tx.clan.findUnique({
        where: { id: parsed.data.clanId },
        include: { members: { select: { playerId: true } } },
      });
      if (!clan) return { ok: false as const, error: 'noSuchClan' };
      if (clan.joinPolicy === 'closed') return { ok: false as const, error: 'closed' };
      if (clan.members.length >= CLAN_MAX_MEMBERS) return { ok: false as const, error: 'clanFull' };
      // The trophy floor is checked here and nowhere else, so a client that
      // simply posts the id gets the same answer as one that read the list.
      if (player.trophies < clan.minTrophies) return { ok: false as const, error: 'trophiesTooLow' };

      if (clan.joinPolicy === 'request') {
        await tx.clanRequest.upsert({
          where: { clanId_playerId: { clanId: clan.id, playerId: player.id } },
          create: { clanId: clan.id, playerId: player.id },
          update: {},
        });
        return { ok: true as const, state: 'requested' as const };
      }

      await tx.clanMember.create({ data: { clanId: clan.id, playerId: player.id, role: 'member' } });
      await tx.clanRequest.deleteMany({ where: { playerId: player.id } });
      await tx.clanMessage.create({
        data: {
          clanId: clan.id, playerId: null, authorName: player.name,
          kind: 'system', body: `${player.name} joined.`,
        },
      });
      return { ok: true as const, state: 'joined' as const };
    }, COMMAND_TX);

    if (!result.ok) return refuse(reply, result.error);
    return reply.send({ state: result.state });
  });

  /**
   * Leave.
   *
   * A leader may not simply walk out of a clan that still has people in it:
   * that would leave a room nobody can moderate. Hand the crown over first, or
   * be the last one out and take the clan with you.
   */
  app.post('/clan/leave', async (request, reply) => {
    const result = await prisma.$transaction(async (tx) => {
      const seat = await seatOf(tx, request.playerId!);
      if (!seat) return { ok: false as const, error: 'notInClan' };

      const members = await tx.clanMember.count({ where: { clanId: seat.clanId } });
      if (seat.role === 'leader' && members > 1) {
        return { ok: false as const, error: 'passLeadershipFirst' };
      }

      const player = await tx.player.findUniqueOrThrow({
        where: { id: request.playerId! }, select: { name: true },
      });
      await tx.clanMember.delete({ where: { playerId: request.playerId! } });

      if (members <= 1) {
        // The last one out closes the clan. An empty clan on the find list is
        // a dead end for whoever taps it.
        await tx.clan.delete({ where: { id: seat.clanId } });
      } else {
        await tx.clanMessage.create({
          data: {
            clanId: seat.clanId, playerId: null, authorName: player.name,
            kind: 'system', body: `${player.name} left.`,
          },
        });
      }
      return { ok: true as const };
    }, COMMAND_TX);

    if (!result.ok) return refuse(reply, result.error);
    return reply.send({ ok: true });
  });

  /* ------------------------------------------------------- moderation --- */

  app.post('/clan/kick', async (request, reply) => {
    const parsed = playerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const result = await prisma.$transaction(async (tx) => {
      const me = await seatOf(tx, request.playerId!);
      if (!me) return { ok: false as const, error: 'notInClan' };
      if (me.role === 'member') return { ok: false as const, error: 'notAllowed' };
      if (parsed.data.playerId === request.playerId) return { ok: false as const, error: 'notAllowed' };

      const them = await tx.clanMember.findUnique({
        where: { playerId: parsed.data.playerId },
        select: { clanId: true, role: true, player: { select: { name: true } } },
      });
      if (!them || them.clanId !== me.clanId) return { ok: false as const, error: 'notInYourClan' };
      // An elder cannot remove another elder. Rank has to be strict, or two
      // elders can spend an afternoon removing each other.
      if (!outranks(me.role as ClanRole, them.role as ClanRole)) {
        return { ok: false as const, error: 'notAllowed' };
      }

      await tx.clanMember.delete({ where: { playerId: parsed.data.playerId } });
      await tx.clanMessage.create({
        data: {
          clanId: me.clanId, playerId: null, authorName: them.player.name,
          kind: 'system', body: `${them.player.name} was removed.`,
        },
      });
      return { ok: true as const };
    }, COMMAND_TX);

    if (!result.ok) return refuse(reply, result.error);
    return reply.send({ ok: true });
  });

  /**
   * Give troops to a clanmate.
   *
   * The only thing in the game one player can do *for* another — everything
   * else is taken from somebody — and the reason a clan is worth being in
   * between wars. What is given comes out of the giver's own warband and
   * stands in the receiver's hold until somebody raids it.
   *
   * Refused for anyone outside your own clan, including yourself: a hold that
   * can garrison itself is a hold with a second warband, which is a balance
   * change nobody asked for.
   */
  app.post('/clan/donate', async (request, reply) => {
    const parsed = donateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    if (!isTroopType(parsed.data.type)) return refuse(reply, 'badTroop', 400);
    const type = parsed.data.type;

    const result = await prisma.$transaction(async (tx) => {
      const me = await seatOf(tx, request.playerId!);
      if (!me) return { ok: false as const, error: 'notInClan' };
      if (parsed.data.playerId === request.playerId) return { ok: false as const, error: 'notAllowed' };

      const them = await tx.clanMember.findUnique({
        where: { playerId: parsed.data.playerId },
        select: { clanId: true, player: { select: { id: true, name: true, keepLevel: true, garrison: true } } },
      });
      if (!them || them.clanId !== me.clanId) return { ok: false as const, error: 'notInYourClan' };

      // Locked in the same order every command in this codebase locks, or two
      // donations crossing between the same pair would deadlock.
      const pair = [request.playerId!, them.player.id].sort();
      await lockPlayer(tx, pair[0]!);
      await lockPlayer(tx, pair[1]!);

      const giver = await tx.player.findUniqueOrThrow({
        where: { id: request.playerId! }, select: { name: true },
      });
      const mine = await tx.troop.findUnique({
        // Clan troops are given from, and to, the day base: the garrison
        // defends a hold, and a clan has one hold per member.
        where: { playerId_world_type: { playerId: request.playerId!, world: DAY, type } },
        select: { count: true },
      });
      const have = mine?.count ?? 0;
      if (have < parsed.data.count) return { ok: false as const, error: 'notEnoughTroops' };

      const garrison = parseGarrison(them.player.garrison);
      const room = garrisonRoomFor(garrison, them.player.keepLevel, type);
      if (room <= 0) return { ok: false as const, error: 'garrisonFull' };
      // Clamped rather than refused: asking for five when four fit should give
      // four, not an error message about arithmetic.
      const count = Math.min(parsed.data.count, room);

      await tx.troop.update({
        where: { playerId_world_type: { playerId: request.playerId!, world: DAY, type } },
        data: { count: have - count },
      });
      garrison[type] = (garrison[type] ?? 0) + count;
      await tx.player.update({
        where: { id: them.player.id },
        data: { garrison: garrison as unknown as object },
      });
      // Paid in gold, and slightly more than the troop cost, so that giving one
      // away is never worse than keeping it. A donation economy where being
      // generous costs you is one nobody uses.
      const reward = donationReward(type, count);
      await tx.player.update({
        where: { id: request.playerId! },
        data: { gold: { increment: BigInt(reward) } },
      });

      await tx.clanMessage.create({
        data: {
          clanId: me.clanId, playerId: null, authorName: giver.name, kind: 'system',
          body: `${giver.name} sent ${count} ${TROOP[type].n}${count > 1 ? 's' : ''} to ${them.player.name}.`,
        },
      });
      return { ok: true as const, count, reward };
    }, COMMAND_TX);

    if (!result.ok) return refuse(reply, result.error);
    return reply.send({ ok: true, count: result.count, reward: result.reward });
  });

  /**
   * Promote or demote.
   *
   * Only the leader, and handing over `leader` hands over the clan: the old
   * leader becomes an elder in the same transaction, so there is never a
   * moment with two leaders or none.
   */
  app.post('/clan/role', async (request, reply) => {
    const parsed = roleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    if (!isClanRole(parsed.data.role)) return refuse(reply, 'badRole', 400);
    const role = parsed.data.role;

    const result = await prisma.$transaction(async (tx) => {
      const me = await seatOf(tx, request.playerId!);
      if (!me) return { ok: false as const, error: 'notInClan' };
      if (me.role !== 'leader') return { ok: false as const, error: 'notAllowed' };
      if (parsed.data.playerId === request.playerId) return { ok: false as const, error: 'notAllowed' };

      const them = await tx.clanMember.findUnique({
        where: { playerId: parsed.data.playerId },
        select: { clanId: true, player: { select: { name: true } } },
      });
      if (!them || them.clanId !== me.clanId) return { ok: false as const, error: 'notInYourClan' };

      await tx.clanMember.update({ where: { playerId: parsed.data.playerId }, data: { role } });
      if (role === 'leader') {
        await tx.clanMember.update({ where: { playerId: request.playerId! }, data: { role: 'elder' } });
      }
      await tx.clanMessage.create({
        data: {
          clanId: me.clanId, playerId: null, authorName: them.player.name,
          kind: 'system', body: `${them.player.name} is now ${role === 'leader' ? 'the leader' : `a${role === 'elder' ? 'n elder' : ' member'}`}.`,
        },
      });
      return { ok: true as const };
    }, COMMAND_TX);

    if (!result.ok) return refuse(reply, result.error);
    return reply.send({ ok: true });
  });

  app.post('/clan/requests/decide', async (request, reply) => {
    const parsed = decideSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const result = await prisma.$transaction(async (tx) => {
      const me = await seatOf(tx, request.playerId!);
      if (!me) return { ok: false as const, error: 'notInClan' };
      if (me.role === 'member') return { ok: false as const, error: 'notAllowed' };

      const ask = await tx.clanRequest.findUnique({
        where: { clanId_playerId: { clanId: me.clanId, playerId: parsed.data.playerId } },
        select: { player: { select: { id: true, name: true, trophies: true } } },
      });
      if (!ask) return { ok: false as const, error: 'noSuchRequest' };

      await tx.clanRequest.delete({
        where: { clanId_playerId: { clanId: me.clanId, playerId: parsed.data.playerId } },
      });
      if (!parsed.data.accept) return { ok: true as const, accepted: false };

      // Everything is re-checked at the moment of acceptance: the applicant may
      // have joined elsewhere, and the clan may have filled up, since they
      // asked.
      if (await seatOf(tx, ask.player.id)) return { ok: false as const, error: 'alreadyInClan' };
      const count = await tx.clanMember.count({ where: { clanId: me.clanId } });
      if (count >= CLAN_MAX_MEMBERS) return { ok: false as const, error: 'clanFull' };

      await tx.clanMember.create({ data: { clanId: me.clanId, playerId: ask.player.id, role: 'member' } });
      await tx.clanMessage.create({
        data: {
          clanId: me.clanId, playerId: null, authorName: ask.player.name,
          kind: 'system', body: `${ask.player.name} joined.`,
        },
      });
      return { ok: true as const, accepted: true };
    }, COMMAND_TX);

    if (!result.ok) return refuse(reply, result.error);
    return reply.send({ accepted: result.accepted });
  });

  app.post('/clan/settings', async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    if (parsed.data.joinPolicy !== undefined && !isJoinPolicy(parsed.data.joinPolicy)) {
      return refuse(reply, 'badPolicy', 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const me = await seatOf(tx, request.playerId!);
      if (!me) return { ok: false as const, error: 'notInClan' };
      if (me.role === 'member') return { ok: false as const, error: 'notAllowed' };

      await tx.clan.update({
        where: { id: me.clanId },
        data: {
          ...(parsed.data.description !== undefined
            ? { description: parsed.data.description.replace(/\s+/g, ' ').trim().slice(0, CLAN_DESC_MAX) }
            : {}),
          ...(parsed.data.joinPolicy !== undefined ? { joinPolicy: parsed.data.joinPolicy } : {}),
          ...(parsed.data.minTrophies !== undefined ? { minTrophies: parsed.data.minTrophies } : {}),
          ...(parsed.data.badge !== undefined ? { badge: parsed.data.badge } : {}),
        },
      });
      return { ok: true as const };
    }, COMMAND_TX);

    if (!result.ok) return refuse(reply, result.error);
    return reply.send({ ok: true });
  });

  /* --------------------------------------------------------------- chat --- */

  /**
   * The room.
   *
   * `after` is a message id, so a client that is up to date asks for nothing
   * and gets nothing back. Polling is deliberate: this is a handful of lines a
   * few times a minute, and a socket per player would be a second piece of
   * infrastructure to run for a feature that does not need one.
   */
  app.get('/clan/messages', async (request, reply) => {
    const seat = await seatOf(prisma, request.playerId!);
    if (!seat) return refuse(reply, 'notInClan');

    const after = String((request.query as { after?: string } | undefined)?.after ?? '');
    const anchor = after
      ? await prisma.clanMessage.findUnique({ where: { id: after }, select: { createdAt: true, clanId: true } })
      : null;

    const messages = await prisma.clanMessage.findMany({
      where: {
        clanId: seat.clanId,
        ...(anchor && anchor.clanId === seat.clanId ? { createdAt: { gt: anchor.createdAt } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: CHAT_HISTORY,
      select: { id: true, playerId: true, authorName: true, body: true, kind: true, createdAt: true },
    });

    return reply.send({
      messages: messages.reverse().map((m) => ({
        id: m.id,
        authorId: m.playerId,
        author: m.authorName,
        body: m.body,
        kind: m.kind,
        at: m.createdAt.toISOString(),
        mine: m.playerId === request.playerId,
      })),
    });
  });

  app.post('/clan/messages', async (request, reply) => {
    const parsed = messageSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const body = cleanMessage(parsed.data.body);
    if (body.length === 0) return refuse(reply, 'emptyMessage', 400);

    const seat = await seatOf(prisma, request.playerId!);
    if (!seat) return refuse(reply, 'notInClan');

    // Per-player, in the database rather than in memory, so it survives a
    // restart and holds across however many API processes are running. The
    // global rate limiter in app.ts is far too loose to stop a flood of chat.
    const since = new Date(Date.now() - CHAT_RATE_WINDOW_MS);
    const recent = await prisma.clanMessage.count({
      where: { playerId: request.playerId!, createdAt: { gte: since } },
    });
    if (recent >= CHAT_RATE_LIMIT) return refuse(reply, 'tooFast', 429);

    const player = await prisma.player.findUniqueOrThrow({
      where: { id: request.playerId! }, select: { name: true },
    });
    const message = await prisma.clanMessage.create({
      data: { clanId: seat.clanId, playerId: request.playerId!, authorName: player.name, body },
      select: { id: true, createdAt: true },
    });

    // Trim the room. A clan that has been talking for a year should not make
    // every new member download a year of it.
    const cutoff = await prisma.clanMessage.findMany({
      where: { clanId: seat.clanId },
      orderBy: { createdAt: 'desc' },
      skip: CHAT_HISTORY,
      take: 1,
      select: { createdAt: true },
    });
    if (cutoff.length > 0) {
      await prisma.clanMessage.deleteMany({
        where: { clanId: seat.clanId, createdAt: { lt: cutoff[0]!.createdAt } },
      });
    }

    return reply.send({
      message: {
        id: message.id,
        authorId: request.playerId,
        author: player.name,
        body,
        kind: 'chat',
        at: message.createdAt.toISOString(),
        mine: true,
      },
    });
  });

  /** Delete a line. Its author always may; an elder or the leader may too. */
  app.post('/clan/messages/delete', async (request, reply) => {
    const parsed = messageIdSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const seat = await seatOf(prisma, request.playerId!);
    if (!seat) return refuse(reply, 'notInClan');

    const message = await prisma.clanMessage.findUnique({
      where: { id: parsed.data.messageId },
      select: { clanId: true, playerId: true },
    });
    if (!message || message.clanId !== seat.clanId) return refuse(reply, 'noSuchMessage', 404);

    const mine = message.playerId === request.playerId;
    const canModerate = seat.role === 'leader' || seat.role === 'elder';
    if (!mine && !canModerate) return refuse(reply, 'notAllowed');

    await prisma.clanMessage.delete({ where: { id: parsed.data.messageId } });
    return reply.send({ ok: true });
  });
}
