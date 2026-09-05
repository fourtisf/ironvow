import { BUILDING_TYPES, TROOP_TYPES, type BuildingType, type TroopType } from '@ironvow/config';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ERROR_MESSAGE, planBuild, planMove, planTrain, planUpgrade, type Verdict } from '../domain/commands.js';
import { collectStock } from '../domain/production.js';
import { nextFinishAt, nextPosition } from '../domain/queue.js';
import { requireAuth } from '../lib/auth.js';
import { lockPlayer, settleAndLoad } from '../lib/player.js';
import { COMMAND_TX, prisma } from '../lib/prisma.js';
import { serialise } from './auth.js';

/**
 * Base mutations.
 *
 * Every route here follows the same shape: open a transaction, take the
 * player's row lock, settle production, re-derive the cost from
 * @ironvow/config, and only then write. The request body carries intent and
 * nothing else — there is no field in any of these schemas that names a price,
 * a resource total or an outcome.
 */

const buildSchema = z.object({
  type: z.enum(BUILDING_TYPES),
  gx: z.number().int(),
  gy: z.number().int(),
});
const idSchema = z.object({ buildingId: z.string().min(1).max(40) });
const moveSchema = idSchema.extend({ gx: z.number().int(), gy: z.number().int() });
const collectSchema = z.object({ buildingId: z.string().min(1).max(40).optional() });
const trainSchema = z.object({ type: z.enum(TROOP_TYPES), count: z.number().int().min(1).max(50).default(1) });

function refuse<T>(reply: FastifyReply, verdict: Extract<Verdict<T>, { ok: false }>) {
  return reply.code(409).send({ error: verdict.error, message: ERROR_MESSAGE[verdict.error] });
}

export async function baseRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /** Buy and place a new building. */
  app.post('/build', async (request, reply) => {
    const parsed = buildSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    const { type, gx, gy } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const player = await settleAndLoad(tx, request.playerId!);

      const plan = planBuild(player, type as BuildingType, gx, gy);
      if (!plan.ok) return plan;

      await tx.player.update({
        where: { id: player.id },
        data: {
          gold: { decrement: BigInt(plan.value.cost.g) },
          iron: { decrement: BigInt(plan.value.cost.i) },
        },
      });
      const created = await tx.building.create({
        data: { playerId: player.id, type, gx, gy, level: 1 },
        select: { id: true },
      });
      return {
        ok: true as const,
        value: { buildingId: created.id, cost: plan.value.cost },
        player: await settleAndLoad(tx, player.id),
      };
    }, COMMAND_TX);

    if (!result.ok) return refuse(reply, result);
    return reply.send({ ...result.value, player: serialise(result.player) });
  });

  /** Raise a building one level. Nothing may exceed the Keep. */
  app.post('/upgrade', async (request, reply) => {
    const parsed = idSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const player = await settleAndLoad(tx, request.playerId!);

      const plan = planUpgrade(player, parsed.data.buildingId);
      if (!plan.ok) return plan;

      await tx.player.update({
        where: { id: player.id },
        data: {
          gold: { decrement: BigInt(plan.value.cost.g) },
          iron: { decrement: BigInt(plan.value.cost.i) },
          ...(plan.value.type === 'keep' ? { keepLevel: plan.value.toLevel } : {}),
        },
      });
      await tx.building.update({
        where: { id: plan.value.buildingId },
        data: { level: plan.value.toLevel },
      });
      return { ok: true as const, value: plan.value, player: await settleAndLoad(tx, player.id) };
    }, COMMAND_TX);

    if (!result.ok) return refuse(reply, result);
    return reply.send({ ...result.value, player: serialise(result.player) });
  });

  /**
   * Relocate a building. Free, and validated against the same rules as a build.
   *
   * This is a single UPDATE of gx and gy. The building is never lifted out of
   * the set it is checked against, which is what makes prototype bugs #2 and
   * #3 — the lost building and the duplicated row — unreachable by
   * construction rather than by careful handling.
   */
  app.post('/move', async (request, reply) => {
    const parsed = moveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const player = await settleAndLoad(tx, request.playerId!);

      const plan = planMove(player, parsed.data.buildingId, parsed.data.gx, parsed.data.gy);
      if (!plan.ok) return plan;

      await tx.building.update({
        where: { id: plan.value.buildingId },
        data: { gx: plan.value.gx, gy: plan.value.gy },
      });
      return { ok: true as const, value: plan.value, player: await settleAndLoad(tx, player.id) };
    }, COMMAND_TX);

    if (!result.ok) return refuse(reply, result);
    return reply.send({ ...result.value, player: serialise(result.player) });
  });

  /** Bank a producer's stock, or every producer's at once. */
  app.post('/collect', async (request, reply) => {
    const parsed = collectSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const outcome = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const player = await settleAndLoad(tx, request.playerId!);

      const collected = collectStock({
        gold: player.gold,
        iron: player.iron,
        buildings: player.buildings,
        buildingId: parsed.data.buildingId,
      });
      if (collected.cleared.length === 0) {
        return { collected: { gold: 0, iron: 0 }, wasted: { gold: 0, iron: 0 }, player };
      }

      await tx.player.update({
        where: { id: player.id },
        data: {
          gold: collected.gold,
          iron: collected.iron,
          // One per producer emptied, matching how the prototype counted taps.
          collected: { increment: collected.cleared.length },
        },
      });
      await tx.building.updateMany({
        where: { id: { in: collected.cleared }, playerId: player.id },
        data: { stock: 0 },
      });
      return {
        collected: collected.collected,
        wasted: collected.wasted,
        player: await settleAndLoad(tx, player.id),
      };
    }, COMMAND_TX);

    const { player, ...rest } = outcome;
    return reply.send({ ...rest, player: serialise(player) });
  });

  /** Queue troops. Sequential, with absolute finish times. */
  app.post('/train', async (request, reply) => {
    const parsed = trainSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    const { type, count } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      let player = await settleAndLoad(tx, request.playerId!);

      let queued = 0;
      let spentG = 0n;
      let spentI = 0n;
      const pending = [...player.queueJobs];

      // Each unit is validated on its own, so a batch that runs out of gold or
      // warband room part-way queues what it could afford and stops.
      for (let n = 0; n < count; n++) {
        const plan = planTrain(player, type as TroopType);
        if (!plan.ok) {
          if (queued === 0) return plan;
          break;
        }
        const finishesAt = nextFinishAt(pending, type as TroopType, new Date());
        const job = await tx.trainJob.create({
          data: { playerId: player.id, type, finishesAt, position: nextPosition(pending) },
          select: { id: true, position: true },
        });
        pending.push({ id: job.id, type: type as TroopType, finishesAt, position: job.position });

        spentG += BigInt(plan.value.cost.g);
        spentI += BigInt(plan.value.cost.i);
        queued++;
        player = {
          ...player,
          gold: player.gold - BigInt(plan.value.cost.g),
          iron: player.iron - BigInt(plan.value.cost.i),
          queue: [...player.queue, type as TroopType],
          queueJobs: pending,
        };
      }

      await tx.player.update({
        where: { id: player.id },
        data: { gold: { decrement: spentG }, iron: { decrement: spentI } },
      });
      return {
        ok: true as const,
        value: { queued, type },
        player: await settleAndLoad(tx, player.id),
      };
    }, COMMAND_TX);

    if (!result.ok) return refuse(reply, result);
    return reply.send({ ...result.value, player: serialise(result.player) });
  });
}
