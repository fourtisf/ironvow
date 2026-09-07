import { START_GOLD, START_IRON } from '@ironvow/config';
import type { FastifyBaseLogger } from 'fastify';
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
