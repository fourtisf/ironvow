import type { FastifyInstance } from 'fastify';
import { cardOf, findShared, replayOf } from '../domain/share.js';
import { prisma } from '../lib/prisma.js';

/**
 * Watching a fight, without an account.
 *
 * These two routes live in their own plugin for one reason: `raidRoutes`
 * installs `requireAuth` as a plugin-wide preHandler, so a route registered
 * beside the rest of raiding is authenticated whatever its own options say —
 * and answering 401 is precisely the thing this feature exists to stop doing.
 * A separate plugin is the difference between a link that opens and a link
 * that asks a stranger to sign up.
 */
export async function shareRoutes(app: FastifyInstance): Promise<void> {
  /**
   * The headline of a shared fight. No account needed.
   *
   * Split from the replay itself because the link preview and the page's first
   * paint want a sentence, not a megabyte of snapshot.
   */
  app.get<{ Params: { id: string } }>('/share/:id/card', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const raid = await findShared(request.params.id);
    if (!raid) return reply.code(404).send({ error: 'noSuchReplay' });
    const attacker = await prisma.player.findUnique({
      where: { id: raid.attackerId }, select: { name: true },
    });
    return reply.send(cardOf(raid, attacker?.name ?? 'Unknown'));
  });

  /**
   * A shared fight, in full, to anybody with the link.
   *
   * No `preHandler: requireAuth`, on purpose and as the whole point: a replay
   * that opens a sign-up form is a link nobody clicks twice.
   */
  app.get<{ Params: { id: string } }>('/share/:id', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const raid = await findShared(request.params.id);
    if (!raid) return reply.code(404).send({ error: 'noSuchReplay' });
    const attacker = await prisma.player.findUnique({
      where: { id: raid.attackerId }, select: { name: true },
    });
    return reply.send(replayOf(raid, attacker?.name ?? 'Unknown'));
  });
}
