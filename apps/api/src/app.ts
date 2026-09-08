import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { playerIdFromRequest } from './lib/auth.js';
import { env } from './lib/env.js';
import { PlayerNotFound } from './lib/player.js';
import { authRoutes } from './routes/auth.js';
import { baseRoutes } from './routes/base.js';
import { clanRoutes } from './routes/clans.js';
import { layoutRoutes } from './routes/layouts.js';
import { opsRoutes } from './routes/ops.js';
import { pushRoutes } from './routes/push.js';
import { questRoutes } from './routes/quests.js';
import { raidRoutes } from './routes/raid.js';
import { shareRoutes } from './routes/share.js';
import { upgradeRoutes } from './routes/upgrades.js';
import { warRoutes } from './routes/war.js';
import { feedbackRoutes } from './routes/feedback.js';

export async function buildApp(): Promise<FastifyInstance> {
  const config = env();

  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: true,
    // BigInt balances would otherwise throw inside the serialiser.
    // Routes convert them, but this keeps an oversight from 500ing.
    serializerOpts: { rounding: 'trunc' },
  });

  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  /*
   * Rate limit per player, not per address.
   *
   * Keying on IP looks right until you remember how mobile works: carriers put
   * thousands of subscribers behind a handful of addresses, and an office, a
   * campus or a VPN does the same. A per-IP ceiling of twenty matchmaking calls
   * a minute is then twenty for everyone on that carrier combined — the game
   * would break for whole networks at once, and worst for exactly the phone
   * users it is built for.
   *
   * Falls back to the address for anything unauthenticated, where there is no
   * player to key on yet and IP is the only handle there is.
   */
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.playerId ?? request.ip,
  });

  /*
   * Resolve the player before the rate limiter needs the key.
   *
   * The limiter runs on onRequest, and route auth runs later on preHandler, so
   * without this the key generator would only ever see an address. This is a
   * cheap indexed lookup on a hashed token and it is needed on nearly every
   * request anyway.
   */
  app.addHook('onRequest', async (request) => {
    const playerId = await playerIdFromRequest(request);
    if (playerId) request.playerId = playerId;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof PlayerNotFound) {
      return reply.code(404).send({ error: 'noSuchPlayer' });
    }

    /*
     * Respect a status the framework already decided on.
     *
     * Rate limiting throws with statusCode 429, and swallowing that into a 500
     * tells the client the server is broken when it is working exactly as
     * designed — there is no way to distinguish "slow down" from "something is
     * wrong", so a client cannot back off and a scale test cannot tell the
     * difference either.
     */
    const framework = error as { statusCode?: number; message?: string };
    const status = framework.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      if (status === 429) {
        return reply.code(429).send({ error: 'rateLimited', message: framework.message });
      }
      return reply.code(status).send({ error: 'badRequest' });
    }

    request.log.error({ err: error }, 'unhandled route error');
    // Never leak an internal message: a stack trace is a map of the server.
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/health', async () => ({ ok: true, at: new Date().toISOString() }));

  await app.register(authRoutes);
  await app.register(baseRoutes);
  await app.register(raidRoutes);
  // Its own plugin: raidRoutes authenticates everything inside it.
  await app.register(shareRoutes);
  await app.register(questRoutes);
  await app.register(upgradeRoutes);
  await app.register(opsRoutes);
  await app.register(layoutRoutes);
  await app.register(pushRoutes);
  await app.register(clanRoutes);
  await app.register(warRoutes);
  await app.register(feedbackRoutes);

  return app;
}
