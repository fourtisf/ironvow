import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { STARTING_BUILDERS, buildSeconds, finishNowCost } from '@ironvow/config';
import type { FastifyInstance } from 'fastify';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Build timers and builders.
 *
 * ALFA's answer to spec S8.4 was free, no in-app purchases, so these are a
 * rhythm rather than a wall: two builders from the first minute and more for
 * gold, ramparts
 * with no timer at all, and nothing in the game longer than ten minutes.
 */

describe('the timer curve', () => {
  it('leaves ramparts instant, so a run of them stays one fluid action', () => {
    expect(buildSeconds('wall', 0, 0)).toBe(0);
    expect(buildSeconds('wall', 5, 40)).toBe(0);
  });

  it('starts short and never exceeds ten minutes', () => {
    expect(buildSeconds('mine', 0, 0)).toBeLessThan(30);
    // A Keep from 8 to 9 is the longest job in the game.
    expect(buildSeconds('keep', 8, 1)).toBeLessThanOrEqual(600);
    expect(buildSeconds('keep', 8, 1)).toBeGreaterThan(300);
  });

  it('rises with cost, never falls', () => {
    let previous = -1;
    for (let level = 1; level <= 8; level++) {
      const seconds = buildSeconds('cannon', level, 3);
      expect(seconds).toBeGreaterThanOrEqual(previous);
      previous = seconds;
    }
  });

  it('prices finishing now as a convenience, not a toll', () => {
    expect(finishNowCost(0)).toBe(10);
    expect(finishNowCost(600)).toBe(1800);
  });
});

describe.skipIf(!hasDatabase)('builders', () => {
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

  it('puts a new building on the map immediately but leaves it inert', async () => {
    const playerId = await makePlayer('Builder', { keepLevel: 5, gold: 100_000, iron: 100_000 });
    const cookie = await loginAs(app, playerId);

    const res = await app.inject({
      method: 'POST', url: '/build', headers: { cookie }, payload: { type: 'mine', gx: 8, gy: 8 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().seconds).toBeGreaterThan(0);

    const row = await db.building.findUniqueOrThrow({ where: { id: res.json().buildingId } });
    expect(row.completesAt).not.toBeNull();
    // A fresh build has no target level: it simply starts working when done.
    expect(row.upgradingTo).toBeNull();

    // It occupies its cells straight away, so nothing else can be put there.
    const clash = await app.inject({
      method: 'POST', url: '/build', headers: { cookie }, payload: { type: 'mine', gx: 8, gy: 8 },
    });
    expect(clash.json().error).toBe('overlaps');
  });

  it('produces nothing while it is still going up', async () => {
    const playerId = await makePlayer('Patient', { keepLevel: 5, gold: 100_000, iron: 100_000 });
    const cookie = await loginAs(app, playerId);

    const built = (await app.inject({
      method: 'POST', url: '/build', headers: { cookie }, payload: { type: 'mine', gx: 8, gy: 8 },
    })).json();

    // Rewind the watermark so a real span of production would have accrued.
    await db.player.update({
      where: { id: playerId },
      data: { lastTickAt: new Date(Date.now() - 30 * 60_000) },
    });
    await app.inject({ method: 'GET', url: '/me', headers: { cookie } });

    const scaffold = await db.building.findUniqueOrThrow({ where: { id: built.buildingId } });
    expect(scaffold.stock).toBe(0);

    // The mine that came with the base did accrue, so this is not a stuck clock.
    const working = await db.building.findFirstOrThrow({
      where: { playerId, type: 'mine', completesAt: null },
    });
    expect(working.stock).toBeGreaterThan(0);
  });

  it('keeps a building working at its old level while it is upgraded', async () => {
    const playerId = await makePlayer('Upgrader', { keepLevel: 5, gold: 100_000, iron: 100_000 });
    const cookie = await loginAs(app, playerId);
    const mine = await db.building.findFirstOrThrow({ where: { playerId, type: 'mine' } });

    await app.inject({
      method: 'POST', url: '/upgrade', headers: { cookie }, payload: { buildingId: mine.id },
    });

    const row = await db.building.findUniqueOrThrow({ where: { id: mine.id } });
    expect(row.level).toBe(1);
    expect(row.upgradingTo).toBe(2);

    await db.player.update({
      where: { id: playerId },
      data: { lastTickAt: new Date(Date.now() - 10 * 60_000) },
    });
    await app.inject({ method: 'GET', url: '/me', headers: { cookie } });

    // Still earning: taking a building offline for its own upgrade would make
    // upgrading a mistake.
    expect((await db.building.findUniqueOrThrow({ where: { id: mine.id } })).stock).toBeGreaterThan(0);
  });

  it('applies the new level only once the timer runs out', async () => {
    const playerId = await makePlayer('Waiter', { keepLevel: 5, gold: 100_000, iron: 100_000 });
    const cookie = await loginAs(app, playerId);
    const mine = await db.building.findFirstOrThrow({ where: { playerId, type: 'mine' } });

    await app.inject({
      method: 'POST', url: '/upgrade', headers: { cookie }, payload: { buildingId: mine.id },
    });
    await db.building.update({
      where: { id: mine.id },
      data: { completesAt: new Date(Date.now() - 1000) },
    });
    const me = (await app.inject({ method: 'GET', url: '/me', headers: { cookie } })).json();

    const row = await db.building.findUniqueOrThrow({ where: { id: mine.id } });
    expect(row.level).toBe(2);
    expect(row.completesAt).toBeNull();
    expect(row.upgradingTo).toBeNull();
    expect(me.buildersFree).toBe(STARTING_BUILDERS);
  });

  it('runs out of builders at the crew size, and ramparts need none', async () => {
    const playerId = await makePlayer('Foreman', { keepLevel: 9, gold: 10_000_000, iron: 10_000_000 });
    const cookie = await loginAs(app, playerId);

    // Driven by the constant rather than a literal: the crew starts at two now
    // and is hired up from there, so a test that hard-coded three would have to
    // be rewritten every time the opening changes.
    const spots = [[8, 8], [12, 8], [16, 8], [20, 8], [24, 8]] as const;
    for (let i = 0; i < STARTING_BUILDERS; i++) {
      const spot = spots[i]!;
      const res = await app.inject({
        method: 'POST', url: '/build', headers: { cookie }, payload: { type: 'mine', gx: spot[0], gy: spot[1] },
      });
      expect(res.statusCode, `mine ${i}`).toBe(200);
    }

    const oneTooMany = spots[STARTING_BUILDERS]!;
    const fourth = await app.inject({
      method: 'POST', url: '/build', headers: { cookie }, payload: { type: 'mine', gx: oneTooMany[0], gy: oneTooMany[1] },
    });
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json().error).toBe('noBuilderFree');

    // A rampart still goes up: it never occupied a builder in the first place.
    const wall = await app.inject({
      method: 'POST', url: '/build', headers: { cookie }, payload: { type: 'wall', gx: 20, gy: 12 },
    });
    expect(wall.statusCode).toBe(200);
    expect(wall.json().seconds).toBe(0);
    expect((await db.building.findUniqueOrThrow({ where: { id: wall.json().buildingId } })).completesAt).toBeNull();
  });

  it('refuses a second job on a building that is already busy', async () => {
    const playerId = await makePlayer('Impatient', { keepLevel: 5, gold: 100_000, iron: 100_000 });
    const cookie = await loginAs(app, playerId);
    const mine = await db.building.findFirstOrThrow({ where: { playerId, type: 'mine' } });

    await app.inject({ method: 'POST', url: '/upgrade', headers: { cookie }, payload: { buildingId: mine.id } });
    const again = await app.inject({
      method: 'POST', url: '/upgrade', headers: { cookie }, payload: { buildingId: mine.id },
    });
    expect(again.json().error).toBe('alreadyBusy');

    // Nor can it be moved out from under the builder.
    const moved = await app.inject({
      method: 'POST', url: '/move', headers: { cookie }, payload: { buildingId: mine.id, gx: 9, gy: 9 },
    });
    expect(moved.json().error).toBe('alreadyBusy');
  });

  it('finishes a job for gold and frees the builder', async () => {
    const playerId = await makePlayer('Hasty', { keepLevel: 5, gold: 100_000, iron: 100_000 });
    const cookie = await loginAs(app, playerId);
    const mine = await db.building.findFirstOrThrow({ where: { playerId, type: 'mine' } });

    await app.inject({ method: 'POST', url: '/upgrade', headers: { cookie }, payload: { buildingId: mine.id } });
    const before = await db.player.findUniqueOrThrow({ where: { id: playerId } });

    const res = await app.inject({
      method: 'POST', url: '/finish', headers: { cookie }, payload: { buildingId: mine.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().cost).toBeGreaterThan(0);
    expect(res.json().player.buildersFree).toBe(STARTING_BUILDERS);

    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(after.gold).toBe(before.gold - BigInt(res.json().cost));
    expect((await db.building.findUniqueOrThrow({ where: { id: mine.id } })).level).toBe(2);
  });

  it('refuses to finish something nobody is building', async () => {
    const playerId = await makePlayer('Confused', { keepLevel: 5, gold: 100_000 });
    const cookie = await loginAs(app, playerId);
    const mine = await db.building.findFirstOrThrow({ where: { playerId, type: 'mine' } });

    const res = await app.inject({
      method: 'POST', url: '/finish', headers: { cookie }, payload: { buildingId: mine.id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('notBusy');
  });

  it('does not unlock anything until a Keep upgrade actually completes', async () => {
    // A big crew, because this test is about the Keep's count cap and not
    // about builders: with the opening two, the Keep's own job would take one
    // and the second mine would be refused for the wrong reason.
    const playerId = await makePlayer('Ambitious', {
      keepLevel: 1, gold: 10_000_000, iron: 10_000_000, builders: 6,
    });
    const cookie = await loginAs(app, playerId);
    const keep = await db.building.findFirstOrThrow({ where: { playerId, type: 'keep' } });

    await app.inject({ method: 'POST', url: '/upgrade', headers: { cookie }, payload: { buildingId: keep.id } });
    const during = (await app.inject({ method: 'GET', url: '/me', headers: { cookie } })).json();
    expect(during.keepLevel).toBe(1);

    // A Keep 1 permits three mines, and the hold starts with one: the third
    // built is one too many.
    for (const gx of [8, 12]) {
      await app.inject({ method: 'POST', url: '/build', headers: { cookie }, payload: { type: 'mine', gx, gy: 8 } });
    }
    const overCap = await app.inject({
      method: 'POST', url: '/build', headers: { cookie }, payload: { type: 'mine', gx: 16, gy: 8 },
    });
    expect(overCap.json().error).toBe('atCountLimit');

    await db.building.update({ where: { id: keep.id }, data: { completesAt: new Date(Date.now() - 1000) } });
    const after = (await app.inject({ method: 'GET', url: '/me', headers: { cookie } })).json();
    expect(after.keepLevel).toBe(2);
  });

  it('leaves scaffolding out of a raid snapshot', async () => {
    const attackerId = await makePlayer('Raider', { trophies: 200, gold: 5000, iron: 5000 });
    await db.troop.updateMany({ where: { playerId: attackerId, type: 'raider' }, data: { count: 5 } });
    const defenderId = await makePlayer('Site', { trophies: 205, keepLevel: 5, gold: 40_000, iron: 40_000 });

    await db.building.create({
      data: {
        playerId: defenderId, type: 'cannon', gx: 8, gy: 8, level: 1,
        completesAt: new Date(Date.now() + 300_000),
      },
    });
    const upgrading = await db.building.create({
      data: {
        playerId: defenderId, type: 'tower', gx: 12, gy: 8, level: 3,
        completesAt: new Date(Date.now() + 300_000), upgradingTo: 4,
      },
    });

    const cookie = await loginAs(app, attackerId);
    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();
    const ids = scout.snapshot.buildings.map((b: { id: string }) => b.id);

    // The half-built cannon is scaffolding and is not there to be fought.
    expect(ids).not.toContain((await db.building.findFirstOrThrow({
      where: { playerId: defenderId, type: 'cannon' },
    })).id);
    // The tower being upgraded is a real building and defends at its old level.
    expect(ids).toContain(upgrading.id);
    const tower = scout.snapshot.buildings.find((b: { id: string }) => b.id === upgrading.id);
    expect(tower.level).toBe(3);
  });
});
