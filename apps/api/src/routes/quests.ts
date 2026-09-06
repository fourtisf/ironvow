import {
  DAILY_COUNT,
  QUESTS,
  dailyOrderById,
  dailyOrdersFor,
  dailyProgress,
  dailyRewardOf,
  dayIndexOf,
  isDailyComplete,
  isQuestComplete,
  msUntilNextDay,
  questById,
  questProgress,
  type QuestSubject,
} from '@ironvow/config';
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
const dailyClaimSchema = z.object({ orderId: z.string().min(1).max(24) });

/** Today's orders as the client draws them. Progress is never sent by the client. */
function dailyView(player: LoadedPlayer, now: Date) {
  const orders = dailyOrdersFor(dayIndexOf(now), player.id);
  return {
    count: DAILY_COUNT,
    streak: player.streakDays,
    resetsInMs: msUntilNextDay(now),
    orders: orders.map((o) => ({
      id: o.id,
      name: o.n,
      detail: o.d,
      goal: o.goal,
      // Derived here, not stored, because it depends on the Keep and the
      // streak: the same order is worth more to a bigger hold and to somebody
      // who has been turning up.
      reward: dailyRewardOf(o, player.keepLevel, player.streakDays),
      progress: Math.min(o.goal, Math.max(0, dailyProgress(o, player.daily))),
      claimed: player.dailyClaimed.includes(o.id),
    })),
  };
}

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

  /**
   * Today's three, with live progress.
   *
   * Which three is derived from the player's id and the day number, so this
   * route reads no row that a midnight job had to write — there is no midnight
   * job. The first settle after midnight zeroes the counters, and that settle
   * happens because the player turned up.
   */
  app.get('/quests/daily', async (request, reply) => {
    const now = new Date();
    const player = await prisma.$transaction((tx) => settleAndLoad(tx, request.playerId!, now));
    return reply.send(dailyView(player, now));
  });

  app.post('/quests/daily/claim', async (request, reply) => {
    const parsed = dailyClaimSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const order = dailyOrderById(parsed.data.orderId);
    if (!order) return reply.code(404).send({ error: 'noSuchOrder' });

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const player = await settleAndLoad(tx, request.playerId!, now);

      // Not just "does this order exist" — is it one of the three this player
      // was actually given today. Otherwise the whole pool is claimable every
      // day by anyone who knows the ids.
      const mine = dailyOrdersFor(dayIndexOf(now), player.id);
      if (!mine.some((o) => o.id === order.id)) {
        return { ok: false as const, error: 'notToday' as const };
      }
      if (player.dailyClaimed.includes(order.id)) {
        return { ok: false as const, error: 'alreadyClaimed' as const };
      }
      if (!isDailyComplete(order, player.daily)) {
        return { ok: false as const, error: 'notComplete' as const };
      }

      const reward = dailyRewardOf(order, player.keepLevel, player.streakDays);
      const credited = grant(
        player.gold, player.iron, reward.g, reward.i,
        player.buildings.map((b) => ({ type: b.type, level: b.level })),
      );
      await tx.player.update({
        where: { id: player.id },
        data: {
          gold: credited.gold,
          iron: credited.iron,
          dailyClaimed: { push: order.id },
        },
      });

      return {
        ok: true as const,
        reward,
        wasted: credited.wasted,
        player: await settleAndLoad(tx, player.id, now),
      };
    }, COMMAND_TX);

    if (!result.ok) return reply.code(409).send({ error: result.error });
    return reply.send({
      reward: result.reward,
      wasted: result.wasted,
      daily: dailyView(result.player, now),
      player: serialise(result.player),
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
        // A reward lost to a full Vault is worth telling the player about.
        wasted: credited.wasted,
        player: await settleAndLoad(tx, player.id),
      };
    }, COMMAND_TX);

    if (!result.ok) return reply.code(409).send({ error: result.error });
    return reply.send({
      reward: result.reward,
      wasted: result.wasted,
      player: serialise(result.player),
    });
  });
}
