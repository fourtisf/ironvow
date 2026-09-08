import type { BuildingType } from '@ironvow/config';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cellsFree, type PlacedBuilding } from '../domain/placement.js';
import { requireAuth } from '../lib/auth.js';
import { lockPlayer, settleAndLoad } from '../lib/player.js';
import { COMMAND_TX, prisma } from '../lib/prisma.js';
import { serialise } from './auth.js';

/**
 * Saved layouts (spec S8.7).
 *
 * Four slots. A defensive layout rings the Keep and the Vaults; a farming one
 * pushes the mines out where they are cheap to give away, so a raider takes
 * resources instead of stars.
 *
 * The other two came later, and both because the game grew a reason for them.
 * A war base is scored on stars alone — no loot moves in a war — so the right
 * shape for one is nothing like a farming base and only a little like a
 * defensive one. And a season is a fortnight of pushing trophies, which wants
 * the layout that loses the fewest of them rather than the one that keeps the
 * most gold. Two slots was the right number for a game with neither.
 *
 * A layout stores positions, not buildings. Applied weeks later it moves the
 * base the player has now rather than resurrecting the one they had then:
 * anything since demolished is skipped, and anything built since simply stays
 * where it is.
 */

const SLOTS = ['defence', 'farming', 'war', 'push'] as const;
type Slot = (typeof SLOTS)[number];

const slotSchema = z.object({ slot: z.enum(SLOTS) });
const saveSchema = slotSchema.extend({ name: z.string().min(1).max(24).optional() });

interface SavedPosition {
  id: string;
  gx: number;
  gy: number;
}

const DEFAULT_NAMES: Record<Slot, string> = {
  defence: 'Defence',
  farming: 'Farming',
  war: 'War',
  push: 'Trophy push',
};

export async function layoutRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/layouts', async (request, reply) => {
    const layouts = await prisma.layout.findMany({
      where: { playerId: request.playerId! },
      orderBy: { slot: 'asc' },
    });
    return reply.send({
      layouts: SLOTS.map((slot) => {
        const saved = layouts.find((l) => l.slot === slot);
        return {
          slot,
          name: saved?.name ?? DEFAULT_NAMES[slot],
          saved: saved !== undefined,
          buildings: saved ? (saved.positions as unknown as SavedPosition[]).length : 0,
          savedAt: saved?.savedAt.toISOString() ?? null,
        };
      }),
    });
  });

  /** Store where everything currently stands. */
  app.post('/layouts/save', async (request, reply) => {
    const parsed = saveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    const slot = parsed.data.slot;

    const player = await prisma.$transaction((tx) => settleAndLoad(tx, request.playerId!));
    const positions: SavedPosition[] = player.buildings.map((b) => ({ id: b.id, gx: b.gx, gy: b.gy }));
    const name = parsed.data.name?.trim() || DEFAULT_NAMES[slot];

    await prisma.layout.upsert({
      where: { playerId_slot: { playerId: player.id, slot } },
      create: { playerId: player.id, slot, name, positions: positions as unknown as object },
      update: { name, positions: positions as unknown as object, savedAt: new Date() },
    });

    return reply.send({ ok: true, slot, name, buildings: positions.length });
  });

  /**
   * Move the base back into a saved arrangement.
   *
   * Every move is validated against the same `cellsFree` a manual one is, and
   * the whole thing is applied in one transaction: a layout that would overlap
   * is rejected outright rather than left half-applied, which would strand the
   * player with a base that is neither arrangement.
   */
  app.post('/layouts/apply', async (request, reply) => {
    const parsed = slotSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const player = await settleAndLoad(tx, request.playerId!);

      const layout = await tx.layout.findUnique({
        where: { playerId_slot: { playerId: player.id, slot: parsed.data.slot } },
      });
      if (!layout) return { ok: false as const, error: 'noSuchLayout' as const };

      const saved = layout.positions as unknown as SavedPosition[];
      const byId = new Map(saved.map((p) => [p.id, p]));

      // A building the builders are on cannot be moved, same as a manual move.
      const busy = player.buildings.filter((b) => b.completesAt !== null).map((b) => b.id);

      /*
       * Resolve the whole arrangement before writing any of it.
       *
       * Buildings swap places, so validating each move against the live board
       * one at a time would reject perfectly good layouts: the first move would
       * collide with the building that is about to vacate that spot.
       */
      const target: PlacedBuilding[] = player.buildings.map((b) => {
        const to = byId.get(b.id);
        const movable = to !== undefined && !busy.includes(b.id);
        return {
          id: b.id,
          type: b.type as BuildingType,
          gx: movable ? to.gx : b.gx,
          gy: movable ? to.gy : b.gy,
        };
      });

      for (const b of target) {
        const problem = cellsFree(b.type, b.gx, b.gy, target, b.id);
        if (problem) return { ok: false as const, error: problem };
      }

      let moved = 0;
      for (const b of target) {
        const current = player.buildings.find((x) => x.id === b.id)!;
        if (current.gx === b.gx && current.gy === b.gy) continue;
        await tx.building.update({ where: { id: b.id }, data: { gx: b.gx, gy: b.gy } });
        moved++;
      }

      return {
        ok: true as const,
        value: { slot: parsed.data.slot, moved, skipped: busy.length },
        player: await settleAndLoad(tx, player.id),
      };
    }, COMMAND_TX);

    if (!result.ok) return reply.code(409).send({ error: result.error });
    return reply.send({ ...result.value, player: serialise(result.player) });
  });

  app.post('/layouts/delete', async (request, reply) => {
    const parsed = slotSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });
    await prisma.layout.deleteMany({
      where: { playerId: request.playerId!, slot: parsed.data.slot },
    });
    return reply.send({ ok: true });
  });
}


