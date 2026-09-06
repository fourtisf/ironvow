import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

/**
 * REPORT A PROBLEM.
 *
 * A game with no way to say "this is broken" from inside it hears about its
 * bugs from nobody. The report is stored with who sent it and what browser
 * they were in, and read back through the ops endpoint. Nothing is sent
 * anywhere else.
 */

const schema = z.object({ body: z.string().min(1).max(2000) });

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  app.post('/feedback', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    const body = parsed.data.body.replace(/\s+/g, ' ').trim();
    if (body.length === 0) return reply.code(400).send({ error: 'emptyMessage' });
    await prisma.feedback.create({
      data: {
        playerId: request.playerId!,
        body,
        userAgent: String(request.headers['user-agent'] ?? '').slice(0, 200),
      },
    });
    request.log.info({ playerId: request.playerId, body: body.slice(0, 200) }, 'feedback');
    return reply.send({ ok: true });
  });
}
