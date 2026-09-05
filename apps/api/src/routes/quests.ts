import { QUESTS, isQuestComplete, questById, questProgress, type QuestSubject } from '@ironvow/config';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { grant } from '../domain/production.js';
import { requireAuth } from '../lib/auth.js';
import { lockPlayer, settleAndLoad, type LoadedPlayer } from '../lib/player.js';
import { COMMAND_TX, prisma } from '../lib/prisma.js';
import { serialise } from './auth.js';

/**
 * War Orders.
 *
 * Progress is never sent by the client. Every metric is recomputed here from
 * the player's real state, and a reward is paid at most once because the claim
 * appends to `claimedQuests` inside the same transaction that grants it.
 */

const claimSchema = z.object({ questId: z.string().min(1).max(16) });

export function subjectOf(player: LoadedPlayer): QuestSubject {
  return {
    counters: player.counters,
    buildings: player.buildings.map((b) => ({ type: b.type, level: b.level })),
    trophies: player.trophies,
  };
}

export async function questRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /** The full order list with live progress, so the client draws real bars. */
  app.get('/quests', async (request, reply) => {
    const player = await prisma.$transaction((tx) => settleAndLoad(tx, request.playerId!));
    const subject = subjectOf(player);
    return reply.send({
      quests: QUESTS.map((q) => ({
        id: q.id,
        name: q.n,
        detail: q.d,
        goal: q.goal,
        reward: q.reward,
        progress: Math.min(q.goal, Math.max(0, questProgress(q, subject))),
        claimed: player.claimedQuests.includes(q.id),
      })),
    });
  });

  app.post('/quests/claim', async (request, reply) => {
    const parsed = claimSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const quest = questById(parsed.data.questId);
    if (!quest) return reply.code(404).send({ error: 'noSuchQuest' });

    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const player = await settleAndLoad(tx, request.playerId!);

      if (player.claimedQuests.includes(quest.id)) {
        return { ok: false as const, error: 'alreadyClaimed' as const };
      }
      if (!isQuestComplete(quest, subjectOf(player))) {
        return { ok: false as const, error: 'notComplete' as const };
      }

      const credited = grant(
        player.gold, player.iron, quest.reward.g, quest.reward.i,
        player.buildings.map((b) => ({ type: b.type, level: b.level })),
      );
      await tx.player.update({
        where: { id: player.id },
        data: {
          gold: credited.gold,
          iron: credited.iron,
          // Appending inside the locked transaction is what makes a
          // double-tapped CLAIM pay out exactly once.
          claimedQuests: { push: quest.id },
        },
      });

      return {
        ok: true as const,
        reward: quest.reward,
        player: await settleAndLoad(tx, player.id),
      };
    }, COMMAND_TX);

    if (!result.ok) return reply.code(409).send({ error: result.error });
    return reply.send({ reward: result.reward, player: serialise(result.player) });
  });
}
