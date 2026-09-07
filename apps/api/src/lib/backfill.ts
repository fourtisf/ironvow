import { START_GOLD, START_IRON, STARTING_CAMPS } from '@ironvow/config';
import type { FastifyBaseLogger } from 'fastify';
import { findFreeSpot } from '../domain/placement.js';
import { prisma } from './prisma.js';

/**
 * One-time work a running server does to itself.
 *
 * The opening purse was raised twice while there were already people playing,
 * and a constant only applies where it is read: a hold created before the
 * change kept whatever it had. ALFA's own hold sat on 20 iron through two
 * deploys that were supposed to be about giving players more of it, which is
 * exactly the shape of thing that reads as "nothing changed" from the outside.
 *
 * So every hold is brought *up to* what a hold created today would start with.
 * It never takes anything away and never grants more than a new player gets,
 * which is the only version of this that is defensible: a player who has been
 * here since the first week should not be worse off than one who signs up
 * after a balance change.
 */

/**
 * Bump the version when the floor moves again and every hold should be lifted
 * to the new one. Old keys are left in the table as a record of what ran.
 */
const KEY = 'backfill:opening-purse-v1';

export async function backfillOpeningPurse(log: FastifyBaseLogger): Promise<void> {
  const done = await prisma.serverSetting.findUnique({ where: { key: KEY } });
  if (done) return;

  /*
   * Work first, then record it.
   *
   * The update is a floor rather than an addition, so running it twice does
   * nothing the first run did not — which means the marker can be written
   * afterwards. That is the order that matters: writing it first would mark
   * the job done even if the update then failed, and nobody would ever be
   * lifted. Two instances starting together may both do the work; the second
   * one changes no rows.
   */
  const lifted = await prisma.$executeRaw`
    UPDATE "Player"
    SET gold = GREATEST(gold, ${START_GOLD}::bigint),
        iron = GREATEST(iron, ${START_IRON}::bigint)
    WHERE gold < ${START_GOLD}::bigint OR iron < ${START_IRON}::bigint`;

  await prisma.$executeRaw`
    INSERT INTO "ServerSetting" ("key", "value", "updatedAt")
    VALUES (${KEY}, ${JSON.stringify({ gold: START_GOLD, iron: START_IRON, holds: lifted })}::jsonb, now())
    ON CONFLICT ("key") DO NOTHING`;

  log.info(
    { holds: lifted, gold: START_GOLD, iron: START_IRON },
    'lifted existing holds to the current opening purse',
  );
}

const CAMPS_KEY = 'backfill:muster-fields-v1';

/**
 * Give every existing hold the Muster Fields a new one is created with.
 *
 * Warband capacity moved off the Barracks and onto the Muster Field
 * (CAMP_NOTE in @ironvow/config), and a hold raised before that change owns no
 * fields at all. Left alone, every player who has ever logged in would open the
 * game to a warband capacity of zero, an army over its own limit, and a TRAIN
 * button that refuses. That is not a balance change anyone would read as one;
 * it is the game breaking.
 *
 * So each hold is topped up to STARTING_CAMPS, on free ground next to its own
 * Keep. It is a floor, like the purse above: a hold that has already bought
 * fields is left exactly as it is.
 */
export async function backfillMusterFields(log: FastifyBaseLogger): Promise<void> {
  const done = await prisma.serverSetting.findUnique({ where: { key: CAMPS_KEY } });
  if (done) return;

  const holds = await prisma.player.findMany({
    select: { id: true, buildings: { select: { id: true, type: true, gx: true, gy: true } } },
  });

  let granted = 0;
  for (const hold of holds) {
    const owned = hold.buildings.filter((b) => b.type === 'camp').length;
    if (owned >= STARTING_CAMPS) continue;

    // Placed off the Keep so the fields land where the player is looking,
    // and threaded through the same free-spot search a new base is seeded
    // with — including the ones added in this loop, or two would stack.
    const keep = hold.buildings.find((b) => b.type === 'keep');
    const placed = hold.buildings.map((b) => ({
      id: b.id, type: b.type as Parameters<typeof findFreeSpot>[0], gx: b.gx, gy: b.gy,
    }));
    for (let i = owned; i < STARTING_CAMPS; i++) {
      const spot = findFreeSpot('camp', keep?.gx ?? 27, (keep?.gy ?? 27) + 4, placed);
      // A hold with no room left keeps what it has rather than failing the
      // boot: it is one player short of a field, not a server that will not
      // start. They can still buy one after moving something.
      if (!spot) break;
      const row = await prisma.building.create({
        data: { playerId: hold.id, type: 'camp', gx: spot.gx, gy: spot.gy, level: 1 },
        select: { id: true },
      });
      placed.push({ id: row.id, type: 'camp', gx: spot.gx, gy: spot.gy });
      granted++;
    }
  }

  await prisma.$executeRaw`
    INSERT INTO "ServerSetting" ("key", "value", "updatedAt")
    VALUES (${CAMPS_KEY}, ${JSON.stringify({ each: STARTING_CAMPS, fields: granted })}::jsonb, now())
    ON CONFLICT ("key") DO NOTHING`;

  log.info({ fields: granted, holds: holds.length }, 'granted existing holds their Muster Fields');
}
