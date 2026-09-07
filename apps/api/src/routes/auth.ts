import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { consumeLoginLink, createLoginLink, issueSession, playerIdFromRequest, requireAuth, revokeSession } from '../lib/auth.js';
import { MailOff, mailIsOff, sendLoginLink } from '../lib/mail.js';
import { createPlayer, loadPlayer } from '../lib/player.js';
import { inviteCodeFor, inviterFor, welcomeBonus } from '../domain/invites.js';
import { looksLikeInvite } from '@ironvow/config';

/**
 * The access code, if the server has one, must come with anything that
 * creates or reaches a hold. Compared in constant time, and never echoed.
 */
function codeIn(body: unknown): string {
  return typeof body === 'object' && body !== null
    && typeof (body as { accessCode?: unknown }).accessCode === 'string'
    ? (body as { accessCode: string }).accessCode.trim()
    : '';
}

function gateOpen(body: unknown): boolean {
  const expected = env().ACCESS_CODE;
  if (!expected) return true;
  const given = codeIn(body);
  if (given.length === 0 || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/**
 * The door takes two kinds of key.
 *
 * The operator's `ACCESS_CODE`, which is one string for everybody, and any
 * player's own invitation code, which is theirs alone. Both open it; only the
 * second one is worth anything to the person who handed it out.
 *
 * Returns the inviter's id when it was an invitation, so the caller can record
 * who brought this player in. `null` for the operator's code — nobody is owed
 * for it — and `false` for a key that fits nothing.
 */
async function openDoor(body: unknown): Promise<{ inviter: string | null } | false> {
  /*
   * An invitation is looked up first, even when there is no operator code and
   * the door is standing open anyway. Otherwise a server with the gate turned
   * off would let everybody in — which is right — and quietly credit nobody
   * for any of them, which is not.
   */
  const given = codeIn(body);
  if (looksLikeInvite(given)) {
    const inviter = await inviterFor(given);
    if (inviter) return { inviter };
  }
  if (gateOpen(body)) return { inviter: null };
  return false;
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
    // An invitation is a key to the same door, so the check has to try both
    // or the card would refuse a code the sign-up would then accept.
    if (!(await openDoor(request.body))) return reply.code(403).send({ error: 'badAccessCode' });
    return reply.send({ ok: true });
  });

  app.post('/auth/request', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const parsed = emailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badEmail' });
    if (!(await openDoor(request.body))) return reply.code(403).send({ error: 'badAccessCode' });

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
    const door = await openDoor(request.body);
    if (!door) return reply.code(403).send({ error: 'badAccessCode' });

    const name = await freeGuestName();
    const playerId = await createPlayer(name, undefined, true);
    if (door.inviter) {
      /*
       * Recorded now, paid later.
       *
       * The inviter is not credited until this hold reaches
       * INVITE_REWARD_KEEP_LEVEL — see settleInvite. What happens here is only
       * the bookkeeping, plus the newcomer's own smaller share for having
       * arrived with a name attached rather than at random.
       */
      await prisma.player.update({
        where: { id: playerId },
        data: {
          invitedById: door.inviter,
          gold: { increment: BigInt(welcomeBonus.g) },
          iron: { increment: BigInt(welcomeBonus.i) },
        },
      });
    }
    await issueSession(reply, playerId);
    return reply.send({ ok: true, playerId, name, invited: door.inviter !== null });
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

  /**
   * This player's own invitation code.
   *
   * Made on first read rather than at sign-up: every hold raised before
   * invitations existed has none, and there is no point writing a string to a
   * table before anybody has asked to see it.
   */
  app.get('/invite', { preHandler: requireAuth }, async (request, reply) => {
    const code = await inviteCodeFor(request.playerId!);
    const invited = await prisma.player.count({ where: { invitedById: request.playerId! } });
    const paid = await prisma.player.count({
      where: { invitedById: request.playerId!, invitePaidAt: { not: null } },
    });
    return reply.send({ code, invited, paid });
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
    garrison: p.garrison,
    garrisonCap: p.garrisonCap,
    pouch: p.pouch,
    heroLevel: p.heroLevel,
    heroReadyAt: p.heroReadyAt?.toISOString() ?? null,
    troopLevels: p.troopLevels,
    counters: p.counters,
    claimedQuests: p.claimedQuests,
    serverTime: new Date().toISOString(),
  };

}