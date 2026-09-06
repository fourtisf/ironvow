import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { safeEqual } from '../lib/auth.js';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';

/**
 * Operations.
 *
 * The Divergence table has existed since the raid route was written, and until
 * now nothing could read it. That is a smoke detector with no alarm: spec S4.6
 * says a spike in divergences means a determinism bug rather than a cheat, and
 * a bug in the shared simulation is the one failure that silently invalidates
 * every battle in the game.
 *
 * Guarded by a bearer token, not a session. An unauthenticated feed would tell
 * an attacker exactly how close their forged client is to matching the server.
 */

const windowSchema = z.object({
  hours: z.coerce.number().int().min(1).max(720).default(24),
});

function authorise(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected = env().OPS_TOKEN;
  // No token configured means the endpoints are off, not open.
  if (!expected) {
    void reply.code(404).send({ error: 'notFound' });
    return false;
  }
  const header = request.headers.authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided || !safeEqual(provided, expected)) {
    void reply.code(401).send({ error: 'notAuthorised' });
    return false;
  }
  return true;
}

export async function opsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Divergence health.
   *
   * The number that matters is the rate, not the count: a hundred divergences
   * against a million raids is noise, and ten against twenty is an emergency.
   */
  app.get('/ops/divergence', async (request, reply) => {
    if (!authorise(request, reply)) return reply;

    const parsed = windowSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    const since = new Date(Date.now() - parsed.data.hours * 3_600_000);

    const [divergences, raids, recent, byAgent] = await Promise.all([
      prisma.divergence.count({ where: { createdAt: { gte: since } } }),
      prisma.raid.count({ where: { status: 'resolved', resolvedAt: { gte: since } } }),
      prisma.divergence.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      prisma.divergence.groupBy({
        by: ['userAgent'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { userAgent: 'desc' } },
        take: 10,
      }),
    ]);

    const rate = raids > 0 ? divergences / raids : 0;

    return reply.send({
      windowHours: parsed.data.hours,
      raidsResolved: raids,
      divergences,
      rate: Number(rate.toFixed(5)),
      /*
       * A judgement, not a measurement, and deliberately conservative.
       *
       * Divergence should be effectively zero: the client and the server run
       * the same code on the same inputs. Anything above one in a thousand is
       * worth looking at, and one in a hundred means the shared simulation is
       * broken rather than that a hundredth of players are cheating.
       */
      verdict: raids < 50 ? 'tooFewRaidsToJudge'
        : rate >= 0.01 ? 'likelyDeterminismBug'
        : rate >= 0.001 ? 'investigate'
        : 'healthy',
      /** Clients grouped by user agent: one engine standing out points at maths. */
      byUserAgent: byAgent.map((g) => ({ userAgent: g.userAgent, count: g._count._all })),
      recent: recent.map((d) => ({
        raidId: d.raidId,
        playerId: d.playerId,
        clientChecksum: d.clientChecksum,
        serverChecksum: d.serverChecksum,
        clientStars: d.clientStars,
        serverStars: d.serverStars,
        userAgent: d.userAgent,
        at: d.createdAt.toISOString(),
      })),
    });
  });

  /** What players wrote in REPORT A PROBLEM, newest first. */
  app.get('/ops/feedback', async (request, reply) => {
    if (!authorise(request, reply)) return;
    const rows = await prisma.feedback.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const names = new Map<string, string>();
    for (const id of new Set(rows.map((r) => r.playerId).filter((x): x is string => x !== null))) {
      const p = await prisma.player.findUnique({ where: { id }, select: { name: true } });
      if (p) names.set(id, p.name);
    }
    return reply.send({
      feedback: rows.map((r) => ({
        id: r.id, at: r.createdAt.toISOString(), player: r.playerId ? names.get(r.playerId) ?? r.playerId : null,
        body: r.body, userAgent: r.userAgent,
      })),
    });
  });

  /** Rough shape of the game, for a glance at whether anything is stuck. */
  app.get('/ops/health', async (request, reply) => {
    if (!authorise(request, reply)) return reply;
    const dayAgo = new Date(Date.now() - 86_400_000);

    const [players, activeToday, openRaids, staleRaids, buildJobs] = await Promise.all([
      prisma.player.count(),
      prisma.player.count({ where: { lastTickAt: { gte: dayAgo } } }),
      prisma.raid.count({ where: { status: 'open' } }),
      // Open raids past their expiry mean the maintenance worker is not running.
      prisma.raid.count({ where: { status: 'open', expiresAt: { lt: new Date() } } }),
      prisma.building.count({ where: { completesAt: { not: null } } }),
    ]);

    return reply.send({
      players,
      activeToday,
      openRaids,
      staleRaids,
      buildJobs,
      workerHealthy: staleRaids === 0,
      at: new Date().toISOString(),
    });
  });
}
