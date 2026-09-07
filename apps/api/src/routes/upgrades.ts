import {
  HERO_MAX_LEVEL,
  MAX_BUILDERS,
  builderCost,
  HERO_NAME,
  HERO_UNLOCK_KEEP_LEVEL,
  TROOP_TYPES,
  heroRespawnMinutes,
  heroStats,
  heroUpgradeCost,
  troopPower,
  troopUpgradeCost,
  type TroopType,
} from '@ironvow/config';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UPGRADE_MESSAGE, labLevelOf, planBuilderHire, planHeroUpgrade, planTroopUpgrade } from '../domain/upgrades.js';
import { requireAuth } from '../lib/auth.js';
import { lockPlayer, settleAndLoad } from '../lib/player.js';
import { COMMAND_TX, prisma } from '../lib/prisma.js';
import { serialise } from './auth.js';

/**
 * The hero and the War Lab.
 *
 * Both are progression that persists between raids, so both are server state
 * and both are gated by the Keep. The client asks to raise one; the server
 * decides what that costs and whether it is allowed.
 */

const troopSchema = z.object({ type: z.enum(TROOP_TYPES) });

export async function upgradeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /** Everything the hero panel and the lab sheet need to draw themselves. */
  app.get('/progression', async (request, reply) => {
    const player = await prisma.$transaction((tx) => settleAndLoad(tx, request.playerId!));
    const labLevel = labLevelOf(player);

    return reply.send({
      hero: {
        name: HERO_NAME,
        level: player.heroLevel,
        maxLevel: HERO_MAX_LEVEL,
        unlockKeepLevel: HERO_UNLOCK_KEEP_LEVEL,
        unlocked: player.keepLevel >= HERO_UNLOCK_KEEP_LEVEL,
        stats: heroStats(player.heroLevel),
        upgradeCost: heroUpgradeCost(player.heroLevel),
        readyAt: player.heroReadyAt?.toISOString() ?? null,
        respawnMinutes: heroRespawnMinutes(player.heroLevel),
      },
      crew: {
        builders: player.builders,
        max: MAX_BUILDERS,
        // Null once the crew is full, which is what the sheet shows instead
        // of a price.
        nextCost: builderCost(player.builders),
      },
      lab: {
        level: labLevel,
        troops: TROOP_TYPES.map((type) => ({
          type,
          level: player.troopLevels[type],
          power: troopPower(player.troopLevels[type]),
          upgradeCost: troopUpgradeCost(type, player.troopLevels[type]),
        })),
      },
    });
  });

  app.post('/hero/upgrade', async (request, reply) => {
    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const player = await settleAndLoad(tx, request.playerId!);

      const plan = planHeroUpgrade(player);
      if (!plan.ok) return plan;

      await tx.player.update({
        where: { id: player.id },
        data: {
          gold: { decrement: BigInt(plan.value.cost.g) },
          iron: { decrement: BigInt(plan.value.cost.i) },
          heroLevel: plan.value.toLevel,
        },
      });
      return { ok: true as const, value: plan.value, player: await settleAndLoad(tx, player.id) };
    }, COMMAND_TX);

    if (!result.ok) {
      return reply.code(409).send({ error: result.error, message: UPGRADE_MESSAGE[result.error] });
    }
    return reply.send({ ...result.value, player: serialise(result.player) });
  });

  /** Hire one more builder. Gold only, capped at the crew size. */
  app.post('/builder/hire', async (request, reply) => {
    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const player = await settleAndLoad(tx, request.playerId!);

      const plan = planBuilderHire(player);
      if (!plan.ok) return plan;

      await tx.player.update({
        where: { id: player.id },
        data: {
          gold: { decrement: BigInt(plan.value.cost.g) },
          builders: plan.value.to,
        },
      });
      return { ok: true as const, value: plan.value, player: await settleAndLoad(tx, player.id) };
    }, COMMAND_TX);

    if (!result.ok) {
      return reply.code(409).send({ error: result.error, message: UPGRADE_MESSAGE[result.error] });
    }
    return reply.send({ ...result.value, player: serialise(result.player) });
  });

  app.post('/troop/upgrade', async (request, reply) => {
    const parsed = troopSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    const type = parsed.data.type as TroopType;

    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const player = await settleAndLoad(tx, request.playerId!);

      const plan = planTroopUpgrade(player, type);
      if (!plan.ok) return plan;

      await tx.player.update({
        where: { id: player.id },
        data: {
          gold: { decrement: BigInt(plan.value.cost.g) },
          iron: { decrement: BigInt(plan.value.cost.i) },
        },
      });
      await tx.troop.upsert({
        where: { playerId_type: { playerId: player.id, type } },
        create: { playerId: player.id, type, count: 0, level: plan.value.toLevel },
        update: { level: plan.value.toLevel },
      });
      return { ok: true as const, value: plan.value, player: await settleAndLoad(tx, player.id) };
    }, COMMAND_TX);

    if (!result.ok) {
      return reply.code(409).send({ error: result.error, message: UPGRADE_MESSAGE[result.error] });
    }
    return reply.send({ ...result.value, player: serialise(result.player) });
  });
}
