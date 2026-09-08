import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BASE_STORAGE, capOf, costOf, demolishRefund, investedIn, storageCapOf } from '@ironvow/config';
import type { FastifyInstance } from 'fastify';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Undoing things.
 *
 * Every test here exists because a player could previously get permanently
 * stuck: a building in the wrong place with a count limit spending that slot
 * for good, or gold committed to a queue with no way out.
 */

describe('the rampart cost curve', () => {
  /*
   * A balance bug inherited from the specification, now fixed.
   *
   * S6 prices a new building at firstCost x 1.55^owned and, in the same
   * section, permits 320 ramparts at Keep 9. The most gold anybody can hold is
   * 91,900, and under 1.55 the eighteenth rampart cost 103,226 — so seventeen
   * was the real ceiling, forever.
   */
  it('lets a player actually reach the count the table promises', () => {
    const maxStorage = storageCapOf([
      { type: 'keep', level: 9 },
      ...Array.from({ length: 6 }, () => ({ type: 'store' as const, level: 9 })),
    ]);
    const lastAllowed = capOf('wall', 9);
    expect(lastAllowed).toBe(320);

    // The final rampart the table permits must be affordable at max storage.
    expect(costOf('wall', 0, lastAllowed - 1).g).toBeLessThan(maxStorage);
  });

  it('keeps War Order q8 inside a Keep 1 purse', () => {
    let total = 0;
    for (let i = 0; i < 8; i++) total += costOf('wall', 0, i).g;
    expect(total).toBeLessThan(storageCapOf([{ type: 'keep', level: 1 }]));
  });

  it('leaves every other building priced exactly as before', () => {
    // Spec S6: firstCost x 1.55^owned.
    expect(costOf('mine', 0, 2).g).toBe(Math.round(150 * 1.55 ** 2));
    expect(costOf('cannon', 0, 3).g).toBe(Math.round(220 * 1.55 ** 3));
    expect(costOf('tower', 0, 1).i).toBe(Math.round(120 * 1.55));
  });

  it('never refunds more than was invested', () => {
    for (const type of ['wall', 'mine', 'cannon'] as const) {
      for (const level of [1, 5, 9]) {
        for (const owned of [0, 5, 11]) {
          const spent = investedIn(type, level, owned);
          const refund = demolishRefund(type, level, owned);
          expect(refund.g).toBeLessThanOrEqual(spent.g);
          expect(refund.i).toBeLessThanOrEqual(spent.i);
          // Half, as documented, give or take the floor.
          expect(refund.g).toBe(Math.floor(spent.g * 0.5));
        }
      }
    }
  });
});

describe.skipIf(!hasDatabase)('undoing a mistake', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    migrate();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });

  beforeEach(resetDatabase);

  it('frees the count slot again when a building comes down', async () => {
    // A Keep 1 permits one Vault. Putting it in the wrong place used to spend
    // that slot for the life of the account.
    const playerId = await makePlayer('Regretful', { keepLevel: 1, gold: 100_000, iron: 100_000 });
    const cookie = await loginAs(app, playerId);

    const built = await app.inject({
      method: 'POST', url: '/build', headers: { cookie }, payload: { type: 'store', gx: 8, gy: 8 },
    });
    expect(built.statusCode).toBe(200);

    const blocked = await app.inject({
      method: 'POST', url: '/build', headers: { cookie }, payload: { type: 'store', gx: 14, gy: 8 },
    });
    expect(blocked.json().error).toBe('atCountLimit');

    // Let the builder finish, then tear it down.
    await db.building.updateMany({
      where: { playerId, type: 'store' },
      data: { completesAt: new Date(Date.now() - 1000) },
    });
    await app.inject({ method: 'GET', url: '/me', headers: { cookie } });

    const razed = await app.inject({
      method: 'POST', url: '/demolish', headers: { cookie },
      payload: { buildingId: built.json().buildingId },
    });
    expect(razed.statusCode).toBe(200);
    expect(razed.json().refund.g).toBeGreaterThan(0);

    // The slot is free again.
    const retry = await app.inject({
      method: 'POST', url: '/build', headers: { cookie }, payload: { type: 'store', gx: 14, gy: 8 },
    });
    expect(retry.statusCode).toBe(200);
  });

  it('refunds half of everything that went in, upgrades included', async () => {
    const playerId = await makePlayer('Investor', { keepLevel: 9, gold: 20_000, iron: 20_000 });
    const cookie = await loginAs(app, playerId);
    // Vaults, so the refund is not clamped away by a starting storage cap.
    for (const gx of [8, 12, 16, 20]) {
      await db.building.create({ data: { playerId, type: 'store', gx, gy: 8, level: 9 } });
    }
    const mine = await db.building.findFirstOrThrow({ where: { playerId, type: 'mine' } });
    await db.building.update({ where: { id: mine.id }, data: { level: 5 } });

    const before = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    const res = await app.inject({
      method: 'POST', url: '/demolish', headers: { cookie }, payload: { buildingId: mine.id },
    });
    expect(res.statusCode).toBe(200);

    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    // A level 5 mine returns more than a level 1 one would.
    expect(after.gold - before.gold).toBe(BigInt(res.json().refund.g));
    expect(res.json().refund.g).toBeGreaterThan(demolishRefund('mine', 1, 0).g);
  });

  it('refuses to tear down the Keep, or anything a builder is on', async () => {
    const playerId = await makePlayer('Careful', { keepLevel: 5, gold: 100_000, iron: 100_000 });
    const cookie = await loginAs(app, playerId);
    const keep = await db.building.findFirstOrThrow({ where: { playerId, type: 'keep' } });
    const mine = await db.building.findFirstOrThrow({ where: { playerId, type: 'mine' } });

    expect((await app.inject({
      method: 'POST', url: '/demolish', headers: { cookie }, payload: { buildingId: keep.id },
    })).json().error).toBe('cannotDemolishKeep');

    await app.inject({ method: 'POST', url: '/upgrade', headers: { cookie }, payload: { buildingId: mine.id } });
    expect((await app.inject({
      method: 'POST', url: '/demolish', headers: { cookie }, payload: { buildingId: mine.id },
    })).json().error).toBe('alreadyBusy');
  });

  it('cancels a fresh build, removing it and refunding in full', async () => {
    const playerId = await makePlayer('Hasty', { keepLevel: 5, gold: 5_000, iron: 5_000 });
    const cookie = await loginAs(app, playerId);
    for (const gx of [20, 24]) {
      await db.building.create({ data: { playerId, type: 'store', gx, gy: 20, level: 9 } });
    }

    const before = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    const built = (await app.inject({
      method: 'POST', url: '/build', headers: { cookie }, payload: { type: 'mine', gx: 8, gy: 8 },
    })).json();

    const cancelled = await app.inject({
      method: 'POST', url: '/cancel', headers: { cookie }, payload: { buildingId: built.buildingId },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().removes).toBe(true);

    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    // Nothing was consumed, so nothing is lost.
    expect(after.gold).toBe(before.gold);
    expect(await db.building.findUnique({ where: { id: built.buildingId } })).toBeNull();
    expect(after.iron).toBe(before.iron);
  });

  it('cancels an upgrade, keeping the building at the level it already was', async () => {
    const playerId = await makePlayer('Changeable', { keepLevel: 5, gold: 5_000, iron: 5_000 });
    const cookie = await loginAs(app, playerId);
    for (const gx of [20, 24]) {
      await db.building.create({ data: { playerId, type: 'store', gx, gy: 20, level: 9 } });
    }
    const mine = await db.building.findFirstOrThrow({ where: { playerId, type: 'mine' } });

    const before = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    await app.inject({ method: 'POST', url: '/upgrade', headers: { cookie }, payload: { buildingId: mine.id } });

    const cancelled = await app.inject({
      method: 'POST', url: '/cancel', headers: { cookie }, payload: { buildingId: mine.id },
    });
    expect(cancelled.json().removes).toBe(false);

    const row = await db.building.findUniqueOrThrow({ where: { id: mine.id } });
    expect(row.level).toBe(1);
    expect(row.completesAt).toBeNull();
    expect(row.upgradingTo).toBeNull();
    expect((await db.player.findUniqueOrThrow({ where: { id: playerId } })).gold).toBe(before.gold);
  });

  it('takes a troop back out of the queue and closes the gap behind it', async () => {
    const playerId = await makePlayer('Overeager', { keepLevel: 5, gold: 5_000, iron: 5_000 });
    const cookie = await loginAs(app, playerId);
    for (const gx of [20, 24]) {
      await db.building.create({ data: { playerId, type: 'store', gx, gy: 20, level: 9 } });
    }

    await app.inject({
      method: 'POST', url: '/train', headers: { cookie }, payload: { type: 'raider', count: 4 },
    });
    const queue = await db.trainJob.findMany({ where: { playerId }, orderBy: { position: 'asc' } });
    expect(queue).toHaveLength(4);
    const lastBefore = queue[3]!.finishesAt.getTime();

    const before = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    const res = await app.inject({
      method: 'POST', url: '/train/cancel', headers: { cookie }, payload: { jobId: queue[0]!.id },
    });
    expect(res.statusCode).toBe(200);

    const after = await db.trainJob.findMany({ where: { playerId }, orderBy: { position: 'asc' } });
    expect(after).toHaveLength(3);
    // Positions close up rather than leaving a hole.
    expect(after.map((j) => j.position)).toEqual([0, 1, 2]);
    // And everything behind it finishes sooner, which is the point of removing
    // something from a queue.
    expect(after[2]!.finishesAt.getTime()).toBeLessThan(lastBefore);

    const player = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(player.gold).toBe(before.gold + BigInt(res.json().refund.g));
    // Nothing hit the storage ceiling, so nothing was thrown away.
    expect(res.json().wasted).toEqual({ gold: 0, iron: 0 });
  });

  it('tells the player when a full Vault ate their refund', async () => {
    // Sitting at the cap with no room: the refund cannot land, and saying so is
    // the difference between a clamp and prototype bug #1.
    // At the ceiling exactly, whatever the ceiling currently is: written as
    // a literal, this test passed until the day the cap was raised and then
    // failed for a reason that had nothing to do with refunds.
    const playerId = await makePlayer('Brimming', {
      keepLevel: 5, gold: BASE_STORAGE, iron: BASE_STORAGE,
    });
    const cookie = await loginAs(app, playerId);
    const mine = await db.building.findFirstOrThrow({ where: { playerId, type: 'mine' } });

    const res = await app.inject({
      method: 'POST', url: '/demolish', headers: { cookie }, payload: { buildingId: mine.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().refund.g).toBeGreaterThan(0);
    expect(res.json().wasted.gold).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasDatabase)('the account', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    migrate();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(resetDatabase);

  it('renames a hold, and refuses a name somebody else holds', async () => {
    const meId = await makePlayer('Thornkeep 2637');
    await makePlayer('Taken');
    const cookie = await loginAs(app, meId);

    const ok = await app.inject({
      method: 'POST', url: '/account/name', headers: { cookie }, payload: { name: 'Ironhold' },
    });
    expect(ok.statusCode).toBe(200);
    expect((await db.player.findUniqueOrThrow({ where: { id: meId } })).name).toBe('Ironhold');

    const clash = await app.inject({
      method: 'POST', url: '/account/name', headers: { cookie }, payload: { name: 'Taken' },
    });
    expect(clash.statusCode).toBe(409);
  });

  it('deletes everything, and needs the name typed to do it', async () => {
    const meId = await makePlayer('Departing', { keepLevel: 5 });
    const cookie = await loginAs(app, meId);

    const wrong = await app.inject({
      method: 'DELETE', url: '/account', headers: { cookie }, payload: { confirmName: 'Something Else' },
    });
    expect(wrong.statusCode).toBe(409);
    expect(await db.player.count()).toBe(1);

    const gone = await app.inject({
      method: 'DELETE', url: '/account', headers: { cookie }, payload: { confirmName: 'Departing' },
    });
    expect(gone.statusCode).toBe(200);

    expect(await db.player.count()).toBe(0);
    // Every relation cascades: nothing is left pointing at a player who asked
    // to be forgotten.
    expect(await db.building.count()).toBe(0);
    expect(await db.troop.count()).toBe(0);
    expect(await db.session.count()).toBe(0);
  });
});

describe.skipIf(!hasDatabase)('saved layouts', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    migrate();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(resetDatabase);

  it('saves where everything stands and puts it back', async () => {
    const playerId = await makePlayer('Architect', { keepLevel: 5, gold: 100_000, iron: 100_000 });
    const cookie = await loginAs(app, playerId);
    const mine = await db.building.findFirstOrThrow({ where: { playerId, type: 'mine' } });
    const original = { gx: mine.gx, gy: mine.gy };

    await app.inject({
      method: 'POST', url: '/layouts/save', headers: { cookie }, payload: { slot: 'defence' },
    });

    // Wander off from the saved arrangement.
    await app.inject({
      method: 'POST', url: '/move', headers: { cookie }, payload: { buildingId: mine.id, gx: 8, gy: 8 },
    });
    expect((await db.building.findUniqueOrThrow({ where: { id: mine.id } })).gx).toBe(8);

    const applied = await app.inject({
      method: 'POST', url: '/layouts/apply', headers: { cookie }, payload: { slot: 'defence' },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().moved).toBe(1);

    const back = await db.building.findUniqueOrThrow({ where: { id: mine.id } });
    expect({ gx: back.gx, gy: back.gy }).toEqual(original);
  });

  it('applies a layout where two buildings swap places', async () => {
    // Validating moves one at a time against the live board would reject this:
    // the first move collides with the building about to vacate the spot.
    const playerId = await makePlayer('Swapper', { keepLevel: 5, gold: 100_000, iron: 100_000 });
    const cookie = await loginAs(app, playerId);
    const mine = await db.building.findFirstOrThrow({ where: { playerId, type: 'mine' } });
    const barr = await db.building.findFirstOrThrow({ where: { playerId, type: 'barr' } });

    await db.building.update({ where: { id: mine.id }, data: { gx: 8, gy: 8 } });
    await db.building.update({ where: { id: barr.id }, data: { gx: 12, gy: 8 } });
    await app.inject({
      method: 'POST', url: '/layouts/save', headers: { cookie }, payload: { slot: 'farming' },
    });

    // Swap them by hand, then restore.
    await db.building.update({ where: { id: mine.id }, data: { gx: 12, gy: 8 } });
    await db.building.update({ where: { id: barr.id }, data: { gx: 8, gy: 8 } });

    const applied = await app.inject({
      method: 'POST', url: '/layouts/apply', headers: { cookie }, payload: { slot: 'farming' },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().moved).toBe(2);
    expect((await db.building.findUniqueOrThrow({ where: { id: mine.id } })).gx).toBe(8);
    expect((await db.building.findUniqueOrThrow({ where: { id: barr.id } })).gx).toBe(12);
  });

  it('skips a building demolished since the layout was saved', async () => {
    const playerId = await makePlayer('Forgetful', { keepLevel: 5, gold: 100_000, iron: 100_000 });
    const cookie = await loginAs(app, playerId);
    const mine = await db.building.findFirstOrThrow({ where: { playerId, type: 'mine' } });

    await app.inject({
      method: 'POST', url: '/layouts/save', headers: { cookie }, payload: { slot: 'defence' },
    });
    await app.inject({
      method: 'POST', url: '/demolish', headers: { cookie }, payload: { buildingId: mine.id },
    });

    const applied = await app.inject({
      method: 'POST', url: '/layouts/apply', headers: { cookie }, payload: { slot: 'defence' },
    });
    expect(applied.statusCode).toBe(200);
  });

  it('reports every slot, saved or not', async () => {
    const playerId = await makePlayer('Planner', { keepLevel: 5 });
    const cookie = await loginAs(app, playerId);
    const before = (await app.inject({ method: 'GET', url: '/layouts', headers: { cookie } })).json();
    // Four now: war and push were added when the game grew a reason for each.
    expect(before.layouts.map((l: { slot: string }) => l.slot))
      .toEqual(['defence', 'farming', 'war', 'push']);
    expect(before.layouts.every((l: { saved: boolean }) => !l.saved)).toBe(true);
  });
});

describe.skipIf(!hasDatabase)('defend drills', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    migrate();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(resetDatabase);

  it('hands back your own base with an attacking wave, and takes nothing', async () => {
    const playerId = await makePlayer('Defender', { keepLevel: 5, trophies: 400, gold: 30_000 });
    const cookie = await loginAs(app, playerId);

    const res = await app.inject({ method: 'POST', url: '/defend', headers: { cookie } });
    expect(res.statusCode).toBe(200);

    const drill = res.json();
    expect(drill.snapshot.defenderId).toBe(playerId);
    expect(drill.snapshot.defendWave.length).toBeGreaterThan(0);
    // A drill is not a raid: nothing is on the table.
    expect(drill.snapshot.pool).toEqual({ g: 0, i: 0 });

    // Nothing is written down, so nothing can be lost.
    expect(await db.raid.count()).toBe(0);
    expect((await db.player.findUniqueOrThrow({ where: { id: playerId } })).gold).toBe(30_000n);
  });

  it('produces a wave the shared simulation can actually run', async () => {
    const { simulate } = await import('@ironvow/sim');
    const playerId = await makePlayer('Drilled', { keepLevel: 5, trophies: 600 });
    const cookie = await loginAs(app, playerId);

    const drill = (await app.inject({ method: 'POST', url: '/defend', headers: { cookie } })).json();
    const out = simulate({
      snapshot: drill.snapshot,
      commands: [],
      army: drill.army,
      hero: drill.hero,
      troopLevels: drill.troopLevels,
      seed: drill.seed,
      kind: 'defend',
    });
    expect(out.ticks).toBeGreaterThan(0);
    expect(['wiped', 'timeout', 'keepFell']).toContain(out.endedBy);
  });
});
