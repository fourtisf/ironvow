import type { FastifyInstance } from 'fastify';
import {
  DAY, NIGHT, NIGHT_START_GOLD, NIGHT_START_IRON, TROOP_ORDER, WORLDS,
  nightUnlocked, type World,
} from '@ironvow/config';
import { requireAuth } from '../lib/auth.js';
import { COMMAND_TX, prisma } from '../lib/prisma.js';
import { lockPlayer, settleAndLoad } from '../lib/player.js';
import { startingNight } from '../domain/nightbase.js';
import { serialise } from './auth.js';

/**
 * Crossing between the two bases.
 *
 * There is no "current world" stored anywhere — every command says which base
 * it means, so switching is not a state change on the server at all. What this
 * route is actually for is the one thing that *is*: the first crossing, which
 * lays the night base down.
 */
export async function worldRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /** Which worlds this player may stand in, and how each of them is doing. */
  app.get('/worlds', async (request, reply) => {
    const player = await prisma.player.findUniqueOrThrow({
      where: { id: request.playerId! },
      select: { keepLevel: true, trophies: true, nightTrophies: true, nightStartedAt: true },
    });
    return reply.send({
      worlds: WORLDS.map((world) => ({
        world,
        // The day world is always open; the night one waits for a Town Hall.
        open: world === DAY || nightUnlocked(player.keepLevel),
        started: world === DAY || player.nightStartedAt !== null,
        trophies: world === DAY ? player.trophies : player.nightTrophies,
      })),
      nightUnlocksAt: 4,
    });
  });

  /**
   * Go to a base, laying it out if this is the first time.
   *
   * Idempotent on purpose: crossing over twice must not build a second opening
   * base on top of the first. `nightStartedAt` is the flag, written in the same
   * transaction as the buildings, so two taps in the same second cannot both
   * see null and both lay a base — the row is locked first.
   */
  app.post('/world', async (request, reply) => {
    const wanted = (request.body as { world?: unknown } | undefined)?.world;
    const world: World = wanted === NIGHT ? NIGHT : DAY;

    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const row = await tx.player.findUniqueOrThrow({
        where: { id: request.playerId! },
        select: { keepLevel: true, nightStartedAt: true },
      });

      if (world === NIGHT) {
        if (!nightUnlocked(row.keepLevel)) return { ok: false as const, error: 'nightLocked' as const };

        if (row.nightStartedAt === null) {
          await tx.building.createMany({
            data: startingNight().map((b) => ({
              playerId: request.playerId!, world: NIGHT, ...b, level: 1,
            })),
          });
          // A roster row per troop, the same as a new hold gets, so training
          // there upserts against something rather than creating rows lazily.
          await tx.troop.createMany({
            data: TROOP_ORDER.map((type) => ({
              playerId: request.playerId!, world: NIGHT, type, count: 0,
            })),
          });
          await tx.player.update({
            where: { id: request.playerId! },
            data: {
              nightStartedAt: new Date(),
              nightGold: BigInt(NIGHT_START_GOLD),
              nightIron: BigInt(NIGHT_START_IRON),
              // The night world's production clock starts when the world does,
              // not at sign-up: otherwise a hold raised months ago would arrive
              // to mines that had been running the whole time.
              nightTickAt: new Date(),
            },
          });
        }
      }

      return {
        ok: true as const,
        world,
        player: await settleAndLoad(tx, request.playerId!, new Date(), world),
      };
    }, COMMAND_TX);

    if (!result.ok) return reply.code(409).send({ error: result.error });
    return reply.send({ world: result.world, player: serialise(result.player) });
  });
}
