import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { consumeLoginLink, createLoginLink, issueSession, playerIdFromRequest, requireAuth, revokeSession } from '../lib/auth.js';
import { MailOff, mailIsOff, sendLoginLink } from '../lib/mail.js';
import { createPlayer, loadPlayer } from '../lib/player.js';

/**
 * The access code, if the server has one, must come with anything that
 * creates or reaches a hold. Compared in constant time, and never echoed.
 */
function gateOpen(body: unknown): boolean {
  const expected = env().ACCESS_CODE;
  if (!expected) return true;
  const given = typeof body === 'object' && body !== null && typeof (body as { accessCode?: unknown }).accessCode === 'string'
    ? (body as { accessCode: string }).accessCode.trim()
    : '';
  if (given.length === 0 || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const emailSchema = z.object({ email: z.string().email().max(254) });
const redeemSchema = z.object({ token: z.string().min(10).max(200), name: z.string().min(2).max(24).optional() });

const NAME_RE = /^[A-Za-z0-9 _-]{2,24}$/;

/**
 * Names for guest holds.
 *
 * Deliberately readable rather than random-looking: a player who is going to
 * see this above their base for the next hour should not be called
 * "Player_8f2a91".
 */
const GUEST_PREFIXES = [
  'Ironhold', 'Ashfell', 'Greyward', 'Stonewatch', 'Thornkeep', 'Blackmere',
  'Redfen', 'Coldspire', 'Oakhelm', 'Duskmoor', 'Ravenrest', 'Highbarrow',
];

async function freeGuestName(): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const stem = GUEST_PREFIXES[Math.floor(Math.random() * GUEST_PREFIXES.length)]!;
    const name = `${stem} ${1 + Math.floor(Math.random() * 9999)}`;
    const taken = await prisma.player.findUnique({ where: { name }, select: { id: true } });
    if (!taken) return name;
  }
  // Vanishingly unlikely, but a collision must not cost the player their tap.
  return `Hold ${Date.now().toString(36)}`;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Request a login link.
   *
   * Always answers the same way whether or not the address is known, so this
   * endpoint cannot be used to enumerate who plays.
   */
  /* ------------------------------------------------------------- the door --- */

  /** Whether a code is needed at all, so the client knows to ask for one. */
  app.get('/auth/gate', async (_request, reply) =>
    reply.send({ required: Boolean(env().ACCESS_CODE) }));

  /**
   * Try a code. Answers only yes or no, and slowly: a four-digit code has ten
   * thousand possibilities, and twenty tries in ten minutes from one address
   * is not a search.
   */
  app.post('/auth/gate', {
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!gateOpen(request.body)) return reply.code(403).send({ error: 'badAccessCode' });
    return reply.send({ ok: true });
  });

  app.post('/auth/request', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const parsed = emailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badEmail' });
    if (!gateOpen(request.body)) return reply.code(403).send({ error: 'badAccessCode' });

    const email = parsed.data.email.toLowerCase().trim();
    // Checked before a link is minted, so a server with no mail does not fill
    // its table with tokens nobody can ever receive.
    if (mailIsOff()) return reply.code(503).send({ error: 'mailOff' });
    const { token } = await createLoginLink(email);
    const link = `${env().WEB_ORIGIN}/auth/callback?token=${token}`;

    try {
      await sendLoginLink({ to: email, link, claiming: false });
    } catch (error) {
      if (error instanceof MailOff) return reply.code(503).send({ error: 'mailOff' });
      // Answering ok would send the player to an inbox that stays empty.
      request.log.error({ err: error, email }, 'login link delivery failed');
      return reply.code(502).send({ error: 'mailFailed' });
    }
    return reply.send({ ok: true });
  });

  /** Redeem a login link and receive an httpOnly session cookie. */
  app.post('/auth/redeem', {
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const parsed = redeemSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const link = await consumeLoginLink(parsed.data.token);
    if (!link) return reply.code(401).send({ error: 'linkInvalid' });

    let playerId = link.playerId;
    if (playerId) {
      // A claim link: attach the address to the hold that already exists.
      await prisma.player.updateMany({
        where: { id: playerId, email: null },
        data: { email: link.email, isGuest: false },
      });
    } else {
      const existing = await prisma.player.findUnique({ where: { email: link.email }, select: { id: true } });
      if (existing) {
        playerId = existing.id;
      } else {
        const name = parsed.data.name?.trim();
        if (!name || !NAME_RE.test(name)) return reply.code(400).send({ error: 'nameRequired' });
        const taken = await prisma.player.findUnique({ where: { name }, select: { id: true } });
        if (taken) return reply.code(409).send({ error: 'nameTaken' });
        playerId = await createPlayer(name, link.email);
      }
    }

    await issueSession(reply, playerId);
    return reply.send({ ok: true, playerId });
  });

  /**
   * Start playing immediately.
   *
   * Asking for an email before a player has seen the game is the single
   * biggest drop-off on mobile: it means leaving the app, finding a message,
   * and coming back. A guest gets a real hold on the server straight away and
   * is invited to attach an email later, once they have something worth
   * keeping.
   */
  app.post('/auth/guest', {
    /*
     * Per IP, and deliberately not tighter than this.
     *
     * Mass account creation is the abuse to stop, but a shared connection — a
     * family, a cafe, a campus — can legitimately produce several new players
     * in an hour, and a refused PLAY NOW is the worst possible first
     * impression. Ten is enough to blunt a script without punishing a
     * household.
     */
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const existing = await playerIdFromRequest(request);
    if (existing) return reply.send({ ok: true, playerId: existing });
    if (!gateOpen(request.body)) return reply.code(403).send({ error: 'badAccessCode' });

    const name = await freeGuestName();
    const playerId = await createPlayer(name, undefined, true);
    await issueSession(reply, playerId);
    return reply.send({ ok: true, playerId, name });
  });

  /**
   * Attach an email to the hold the player is already signed in as.
   *
   * The link carries the existing player id, so redeeming it upgrades that
   * account rather than creating a second one and stranding the base they
   * built.
   */
  app.post('/auth/claim', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const parsed = emailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badEmail' });
    const email = parsed.data.email.toLowerCase().trim();

    const taken = await prisma.player.findUnique({ where: { email }, select: { id: true } });
    if (taken && taken.id !== request.playerId) {
      return reply.code(409).send({ error: 'emailTaken' });
    }

    if (mailIsOff()) return reply.code(503).send({ error: 'mailOff' });
    const { token } = await createLoginLink(email, request.playerId!);
    const link = `${env().WEB_ORIGIN}/auth/callback?token=${token}`;

    try {
      await sendLoginLink({ to: email, link, claiming: true });
    } catch (error) {
      if (error instanceof MailOff) return reply.code(503).send({ error: 'mailOff' });
      request.log.error({ err: error, email }, 'claim link delivery failed');
      return reply.code(502).send({ error: 'mailFailed' });
    }
    return reply.send({ ok: true });
  });

  app.post('/auth/logout', async (request, reply) => {
    await revokeSession(request, reply);
    return reply.send({ ok: true });
  });

  /**
   * Rename a hold.
   *
   * A guest is handed a generated name, and being stuck with one you dislike
   * for the life of the account is a small thing that stays annoying. Rate
   * limited because a name is public and visible on the ladder.
   */
  app.post('/account/name', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const parsed = z.object({ name: z.string().min(2).max(24) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badName' });

    const name = parsed.data.name.trim();
    if (!NAME_RE.test(name)) return reply.code(400).send({ error: 'badName' });

    const taken = await prisma.player.findUnique({ where: { name }, select: { id: true } });
    if (taken && taken.id !== request.playerId) return reply.code(409).send({ error: 'nameTaken' });

    await prisma.player.update({ where: { id: request.playerId! }, data: { name } });
    return reply.send({ ok: true, name });
  });

  /**
   * Delete the account and everything in it.
   *
   * Every relation cascades from Player, so the base, troops, queue, sessions
   * and login links all go with it. Raids the player made or took go too, which
   * is the right call: a raid record naming a player who has asked to be
   * forgotten is still a record of them.
   *
   * Requires the player's own name as confirmation, because this is the one
   * button in the game with no undo.
   */
  app.delete('/account', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ confirmName: z.string().min(1).max(24) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const player = await prisma.player.findUnique({
      where: { id: request.playerId! },
      select: { name: true },
    });
    if (!player) return reply.code(404).send({ error: 'noSuchPlayer' });
    if (player.name !== parsed.data.confirmName.trim()) {
      return reply.code(409).send({ error: 'nameMismatch' });
    }

    await prisma.player.delete({ where: { id: request.playerId! } });
    await revokeSession(request, reply);
    return reply.send({ ok: true });
  });

  /** Who am I, plus the settled state of my base. */
  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const player = await loadPlayer(request.playerId!);
    return reply.send(serialise(player));
  });
}

/** BigInt does not survive JSON.stringify, so balances cross the wire as numbers. */
export function serialise(p: Awaited<ReturnType<typeof loadPlayer>>) {
  return {
    id: p.id,
    name: p.name,
    isGuest: p.isGuest,
    gold: Number(p.gold),
    iron: Number(p.iron),
    trophies: p.trophies,
    keepLevel: p.keepLevel,
    shieldUntil: p.shieldUntil?.toISOString() ?? null,
    storageCap: p.storageCap,
    armyCap: p.armyCap,
    armyUsed: p.armyUsed,
    army: p.army,
    buildersFree: p.buildersFree,
    buildersTotal: p.buildersTotal,
    buildings: p.buildings.map((b) => ({
      id: b.id, type: b.type, gx: b.gx, gy: b.gy, level: b.level, stock: b.stock,
      completesAt: b.completesAt?.toISOString() ?? null,
      upgradingTo: b.upgradingTo ?? null,
    })),
    queue: p.queueJobs.map((j) => ({
      id: j.id, type: j.type, finishesAt: j.finishesAt.toISOString(), position: j.position,
    })),
    heroLevel: p.heroLevel,
    heroReadyAt: p.heroReadyAt?.toISOString() ?? null,
    troopLevels: p.troopLevels,
    counters: p.counters,
    claimedQuests: p.claimedQuests,
    serverTime: new Date().toISOString(),
  };
}
