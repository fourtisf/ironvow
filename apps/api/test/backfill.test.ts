import { START_GOLD, START_IRON } from '@ironvow/config';
import { beforeAll, describe, expect, it } from 'vitest';
import { backfillOpeningPurse } from '../src/lib/backfill.js';
import { db, hasDatabase, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * The opening purse was raised twice while there were already people playing,
 * and a constant only applies where it is read: holds made before the change
 * kept whatever they had. ALFA's own hold sat on 20 iron through two deploys
 * that were about giving players more of it.
 */

const log = { info: () => undefined } as unknown as Parameters<typeof backfillOpeningPurse>[0];

describe.skipIf(!hasDatabase)('lifting old holds to the current opening purse', () => {
  beforeAll(() => { migrate(); });

  it('raises a hold that predates the change, and leaves a richer one alone', async () => {
    await resetDatabase();
    const poor = await makePlayer('poor-hold', { gold: 9300, iron: 20 });
    const rich = await makePlayer('rich-hold', { gold: 80_000, iron: 40_000 });

    await backfillOpeningPurse(log);

    const after = await db.player.findMany({
      where: { id: { in: [poor, rich] } },
      select: { id: true, gold: true, iron: true },
    });
    const of = (id: string) => after.find((p) => p.id === id)!;

    // Gold was already above the floor; only the iron moves.
    expect(of(poor).gold).toBe(BigInt(9300));
    expect(of(poor).iron).toBe(BigInt(START_IRON));
    // A floor, never a ceiling: nothing is taken from a hold that is ahead.
    expect(of(rich).gold).toBe(BigInt(80_000));
    expect(of(rich).iron).toBe(BigInt(40_000));
  });

  it('runs once, ever', async () => {
    await resetDatabase();
    const id = await makePlayer('once', { gold: 10, iron: 10 });

    await backfillOpeningPurse(log);
    expect((await db.player.findUniqueOrThrow({ where: { id } })).gold).toBe(BigInt(START_GOLD));

    // Spend it back down, then boot again: the marker means no second grant.
    await db.player.update({ where: { id }, data: { gold: BigInt(5), iron: BigInt(5) } });
    await backfillOpeningPurse(log);

    const after = await db.player.findUniqueOrThrow({ where: { id } });
    expect(after.gold).toBe(BigInt(5));
    expect(after.iron).toBe(BigInt(5));
  });
});
