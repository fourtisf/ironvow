import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { env } from './lib/env.js';
import { PlayerNotFound } from './lib/player.js';
import { authRoutes } from './routes/auth.js';
import { baseRoutes } from './routes/base.js';
import { opsRoutes } from './routes/ops.js';
import { questRoutes } from './routes/quests.js';
import { raidRoutes } from './routes/raid.js';
import { upgradeRoutes } from './routes/upgrades.js';

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
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof PlayerNotFound) {
      return reply.code(404).send({ error: 'noSuchPlayer' });
    }
    request.log.error({ err: error }, 'unhandled route error');
    // Never leak an internal message: a stack trace is a map of the server.
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/health', async () => ({ ok: true, at: new Date().toISOString() }));

  await app.register(authRoutes);
  await app.register(baseRoutes);
  await app.register(raidRoutes);
  await app.register(questRoutes);
  await app.register(upgradeRoutes);
  await app.register(opsRoutes);

  return app;
}
