import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { consumeLoginLink, createLoginLink, issueSession, playerIdFromRequest, requireAuth, revokeSession } from '../lib/auth.js';
import { createPlayer, loadPlayer } from '../lib/player.js';

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
  app.post('/auth/request', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const parsed = emailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badEmail' });

    const email = parsed.data.email.toLowerCase().trim();
    const { token } = await createLoginLink(email);

    if (env().MAIL_TRANSPORT === 'console') {
      request.log.info({ email, link: `${env().WEB_ORIGIN}/auth/callback?token=${token}` }, 'login link issued');
    } else {
      // A real transport goes here. Until one is wired, production refuses to
      // boot with MAIL_TRANSPORT=console rather than silently dropping mail.
      request.log.warn({ email }, 'smtp transport not configured');
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
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const existing = await playerIdFromRequest(request);
    if (existing) return reply.send({ ok: true, playerId: existing });

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

    const { token } = await createLoginLink(email, request.playerId!);
    if (env().MAIL_TRANSPORT === 'console') {
      request.log.info({ email, link: `${env().WEB_ORIGIN}/auth/callback?token=${token}` }, 'claim link issued');
    }
    return reply.send({ ok: true });
  });

  app.post('/auth/logout', async (request, reply) => {
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
    buildings: p.buildings.map((b) => ({
      id: b.id, type: b.type, gx: b.gx, gy: b.gy, level: b.level, stock: b.stock,
    })),
    queue: p.queueJobs.map((j) => ({
      id: j.id, type: j.type, finishesAt: j.finishesAt.toISOString(), position: j.position,
    })),
    counters: p.counters,
    claimedQuests: p.claimedQuests,
    serverTime: new Date().toISOString(),
  };
}
