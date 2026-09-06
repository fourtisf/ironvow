import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { publicKey, pushAvailable, pushTo } from '../lib/push.js';
import { prisma } from '../lib/prisma.js';

/**
 * Registering a browser for push.
 *
 * The public VAPID key is served rather than baked into the client bundle, so
 * rotating it does not need a redeploy of the web app.
 */

const subscribeSchema = z.object({
  endpoint: z.string().url().max(600),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
});

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  /** Unauthenticated: the public key is public by definition. */
  app.get('/push/key', async (_request, reply) =>
    reply.send({ available: await pushAvailable(), key: await publicKey() }));

  app.post('/push/subscribe', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = subscribeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    if (!(await pushAvailable())) return reply.code(503).send({ error: 'pushUnavailable' });

    const { endpoint, keys } = parsed.data;
    // Endpoints are unique, so the same browser re-subscribing moves the row to
    // whoever is signed in now rather than creating a duplicate.
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { playerId: request.playerId!, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { playerId: request.playerId!, p256dh: keys.p256dh, auth: keys.auth },
    });

    return reply.send({ ok: true });
  });

  app.post('/push/unsubscribe', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ endpoint: z.string().url().max(600) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    await prisma.pushSubscription.deleteMany({
      where: { endpoint: parsed.data.endpoint, playerId: request.playerId! },
    });
    return reply.send({ ok: true });
  });

  /** Send one to yourself, so a player can check it works before relying on it. */
  app.post('/push/test', { preHandler: requireAuth }, async (request, reply) => {
    const sent = await pushTo(request.playerId!, {
      title: 'IRONVOW',
      body: 'Notifications are working. You will hear about finished builds and raids.',
      tag: 'test',
    });
    return reply.send({ ok: true, sent });
  });
}
