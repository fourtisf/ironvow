import {
  ITEM,
  ITEM_TYPES,
  RELIC,
  RELIC_FORGE_COST,
  RELIC_KEEP_LEVEL,
  RELIC_MAX_LEVEL,
  RELIC_SLOTS,
  RELIC_TYPES,
  relicRaiseCost,
  respawnWith,
  HERO_MAX_LEVEL,
  MAX_BUILDERS,
  builderCost,
  HERO_NAME,
  HERO_UNLOCK_KEEP_LEVEL,
  TROOP_TYPES,
  heroStats,
  heroUpgradeCost,
  troopPower,
  troopUpgradeCost,
  type TroopType,
} from '@ironvow/config';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UPGRADE_MESSAGE, labLevelOf, planBuilderHire, planCarry, planHeroUpgrade, planItemBuy, planRelic, planTroopUpgrade } from '../domain/upgrades.js';
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
const itemSchema = z.object({ type: z.enum(ITEM_TYPES), count: z.number().int().min(1).max(9) });
const relicSchema = z.object({ type: z.enum(RELIC_TYPES) });
const carrySchema = z.object({
  slot: z.number().int().min(0).max(RELIC_SLOTS - 1),
  // Null empties the slot, which is a thing a player should be able to do.
  type: z.enum(RELIC_TYPES).nullable().optional(),
});

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
        // Haste included, so the hero panel and the server agree about the
        // one number a player plans around.
        respawnMinutes: respawnWith(player.heroLevel, player.relics, player.carried),
      },
      crew: {
        builders: player.builders,
        max: MAX_BUILDERS,
        // Null once the crew is full, which is what the sheet shows instead
        // of a price.
        nextCost: builderCost(player.builders),
      },
      items: ITEM_TYPES.map((type) => ({
        type,
        n: ITEM[type].n,
        d: ITEM[type].d,
        cost: ITEM[type].cost,
        cap: ITEM[type].cap,
        keep: ITEM[type].keep,
        held: player.pouch[type] ?? 0,
        unlocked: player.keepLevel >= ITEM[type].keep,
      })),
      relics: {
        unlocked: player.keepLevel >= RELIC_KEEP_LEVEL,
        keep: RELIC_KEEP_LEVEL,
        shards: player.shards,
        slots: RELIC_SLOTS,
        carried: player.carried,
        // The respawn as it actually is, Haste included: the number on the
        // hero panel and the number the server uses must be the same one.
        respawnMinutes: respawnWith(player.heroLevel, player.relics, player.carried),
        list: RELIC_TYPES.map((type) => {
          const level = player.relics[type] ?? 0;
          return {
            type,
            n: RELIC[type].n,
            d: RELIC[type].d,
            level,
            max: RELIC_MAX_LEVEL,
            per: RELIC[type].per,
            /** Null once it is at the top, which is what the sheet shows instead of a price. */
            cost: level >= RELIC_MAX_LEVEL
              ? null
              : level === 0 ? RELIC_FORGE_COST : relicRaiseCost(level),
          };
        }),
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

  /**
   * Buy battle items.
   *
   * A gold and iron sink that is spent rather than accumulated, which is what
   * makes it a different sink from the vanity ones: the money leaves the
   * economy every time a raid goes badly enough to need a Warhorn.
   */
  app.post('/item/buy', async (request, reply) => {
    const parsed = itemSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const player = await settleAndLoad(tx, request.playerId!);

      const plan = planItemBuy(player, parsed.data.type, parsed.data.count);
      if (!plan.ok) return plan;

      await tx.player.update({
        where: { id: player.id },
        data: {
          gold: { decrement: BigInt(plan.value.cost.g) },
          iron: { decrement: BigInt(plan.value.cost.i) },
          pouch: plan.value.pouch as unknown as object,
        },
      });
      return { ok: true as const, value: plan.value, player: await settleAndLoad(tx, player.id) };
    }, COMMAND_TX);

    if (!result.ok) {
      return reply.code(409).send({ error: result.error, message: UPGRADE_MESSAGE[result.error] });
    }
    return reply.send({ ...result.value, player: serialise(result.player) });
  });

  /**
   * Forge a relic, or raise one already forged.
   *
   * The one thing in the game gold cannot buy. Shards come from clan wars and,
   * more slowly, from season closes — so the progression that outlasts the Keep
   * is the one that also keeps clans and the ladder busy.
   */
  app.post('/relic/forge', async (request, reply) => {
    const parsed = relicSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const player = await settleAndLoad(tx, request.playerId!);

      const plan = planRelic(player, parsed.data.type);
      if (!plan.ok) return plan;

      const relics = { ...player.relics, [plan.value.type]: plan.value.toLevel };
      await tx.player.update({
        where: { id: player.id },
        data: {
          shards: { decrement: plan.value.shards },
          relics: relics as unknown as object,
        },
      });
      return { ok: true as const, value: plan.value, player: await settleAndLoad(tx, player.id) };
    }, COMMAND_TX);

    if (!result.ok) {
      return reply.code(409).send({ error: result.error, message: UPGRADE_MESSAGE[result.error] });
    }
    return reply.send({ ...result.value, player: serialise(result.player) });
  });

  /** Carry a relic in a slot, or empty the slot. Costs nothing; changes a raid. */
  app.post('/relic/carry', async (request, reply) => {
    const parsed = carrySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const player = await settleAndLoad(tx, request.playerId!);

      const plan = planCarry(player, parsed.data.slot, parsed.data.type ?? null);
      if (!plan.ok) return plan;

      await tx.player.update({
        where: { id: player.id },
        data: { carried: plan.value as unknown as object },
      });
      return { ok: true as const, carried: plan.value, player: await settleAndLoad(tx, player.id) };
    }, COMMAND_TX);

    if (!result.ok) {
      return reply.code(409).send({ error: result.error, message: UPGRADE_MESSAGE[result.error] });
    }
    return reply.send({ carried: result.carried, player: serialise(result.player) });
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
