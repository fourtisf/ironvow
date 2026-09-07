import { START_GOLD, START_IRON, STARTING_CAMPS, TYPES } from '@ironvow/config';
import { beforeAll, describe, expect, it } from 'vitest';
import { backfillMusterFields, backfillOpeningPurse } from '../src/lib/backfill.js';
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

/**
 * Warband room moved off the Barracks and onto the Muster Field, and a hold
 * raised before that owns no fields at all. Left alone, every player who has
 * ever logged in would open the game to a capacity of zero and a TRAIN button
 * that refuses — the game breaking, not a balance change.
 */
describe.skipIf(!hasDatabase)('granting old holds their Muster Fields', () => {
  beforeAll(() => { migrate(); });

  const fieldsOf = async (id: string) =>
    db.building.findMany({ where: { playerId: id, type: 'camp' }, select: { gx: true, gy: true } });

  it('tops a hold up to the opening two, on ground it can actually stand on', async () => {
    await resetDatabase();
    const id = await makePlayer('old-hold');
    await db.building.deleteMany({ where: { playerId: id, type: 'camp' } });

    await backfillMusterFields(log);

    const fields = await fieldsOf(id);
    expect(fields).toHaveLength(STARTING_CAMPS);
    // Nothing may be granted on top of something already standing.
    const all = await db.building.findMany({
      where: { playerId: id }, select: { type: true, gx: true, gy: true },
    });
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!; const b = all[j]!;
        const as = TYPES[a.type as keyof typeof TYPES].s;
        const bs = TYPES[b.type as keyof typeof TYPES].s;
        const overlap = a.gx < b.gx + bs && a.gx + as > b.gx && a.gy < b.gy + bs && a.gy + as > b.gy;
        expect(overlap).toBe(false);
      }
    }
  });

  it('is a floor: a hold that already bought fields keeps exactly what it has', async () => {
    await resetDatabase();
    const id = await makePlayer('field-owner');
    // The fixture lays down the opening two; give it a third and check the
    // backfill does not decide that is the wrong number.
    await db.building.create({ data: { playerId: id, type: 'camp', gx: 20, gy: 40, level: 3 } });

    await backfillMusterFields(log);

    expect(await fieldsOf(id)).toHaveLength(STARTING_CAMPS + 1);
  });

  it('runs once, ever', async () => {
    await resetDatabase();
    const id = await makePlayer('once-fields');
    await db.building.deleteMany({ where: { playerId: id, type: 'camp' } });

    await backfillMusterFields(log);
    expect(await fieldsOf(id)).toHaveLength(STARTING_CAMPS);

    // Tear them down and boot again: the marker means no second grant.
    await db.building.deleteMany({ where: { playerId: id, type: 'camp' } });
    await backfillMusterFields(log);
    expect(await fieldsOf(id)).toHaveLength(0);
  });
});
