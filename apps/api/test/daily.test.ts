import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DAILY_COUNT, DAILY_POOL, dailyOrdersFor, dailyRewardOf, dayIndexOf, streakTenths } from '@ironvow/config';
import type { FastifyInstance } from 'fastify';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Daily War Orders.
 *
 * The twelve one-time orders run out on a player's second day. These are what
 * is there on the third. What matters is the same thing that mattered for the
 * one-time ones — they cannot be gamed — plus one thing that is new: a player
 * must not be able to claim an order they were not given.
 */

describe('the pool is picked, not stored', () => {
  it('gives each player three of the pool, without repeats', () => {
    const orders = dailyOrdersFor(20_000, 'player-a');
    expect(orders).toHaveLength(DAILY_COUNT);
    expect(new Set(orders.map((o) => o.id)).size).toBe(DAILY_COUNT);
    for (const o of orders) expect(DAILY_POOL).toContain(o);
  });

  it('is stable for one player on one day, and differs across both', () => {
    expect(dailyOrdersFor(20_000, 'a').map((o) => o.id))
      .toEqual(dailyOrdersFor(20_000, 'a').map((o) => o.id));

    // Not a guarantee for any single pair, but across a hundred days one
    // player's orders must change, or the rotation is not rotating.
    const days = new Set(
      Array.from({ length: 100 }, (_, i) => dailyOrdersFor(20_000 + i, 'a').map((o) => o.id).join()),
    );
    expect(days.size).toBeGreaterThan(10);

    const players = new Set(
      Array.from({ length: 100 }, (_, i) => dailyOrdersFor(20_000, `p${i}`).map((o) => o.id).join()),
    );
    expect(players.size).toBeGreaterThan(10);
  });

  it('pays more to a bigger hold and to a longer streak', () => {
    const order = DAILY_POOL[0]!;
    expect(dailyRewardOf(order, 8, 1).g).toBeGreaterThan(dailyRewardOf(order, 1, 1).g);
    expect(dailyRewardOf(order, 4, 5).g).toBeGreaterThan(dailyRewardOf(order, 4, 1).g);
  });

  it('stops paying more for a streak past the cap, so a missed day is survivable', () => {
    expect(streakTenths(400)).toBe(streakTenths(11));
    expect(streakTenths(1)).toBe(10);
  });
});

describe.skipIf(!hasDatabase)('daily orders over the wire', () => {
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

  it('starts a new player on a one-day streak with three unclaimed orders', async () => {
    const playerId = await makePlayer('Daily', { keepLevel: 3 });
    const cookie = await loginAs(app, playerId);

    const view = (await app.inject({ method: 'GET', url: '/quests/daily', headers: { cookie } })).json();
    expect(view.orders).toHaveLength(DAILY_COUNT);
    expect(view.streak).toBe(1);
    expect(view.orders.every((o: { claimed: boolean }) => !o.claimed)).toBe(true);
    expect(view.resetsInMs).toBeGreaterThan(0);
    expect(view.resetsInMs).toBeLessThanOrEqual(86_400_000);
  });

  it('refuses an order the player was not given today', async () => {
    const playerId = await makePlayer('Outsider', { keepLevel: 3 });
    const cookie = await loginAs(app, playerId);

    const mine = new Set(dailyOrdersFor(dayIndexOf(new Date()), playerId).map((o) => o.id));
    const other = DAILY_POOL.find((o) => !mine.has(o.id))!;
    // Complete everything, so the only thing standing between the player and
    // the reward is whether the order is theirs.
    await db.player.update({
      where: { id: playerId },
      data: {
        // dayKey too: without it the next settle sees a stale day, zeroes
        // everything set here, and the test would be measuring the rollover.
        dayKey: dayIndexOf(new Date()),
        dayCollected: 999, dayTrained: 999, dayWins: 999, dayRaids: 999,
        dayStars: 999, dayThreeStars: 999, dayLootGold: 999_999, dayUpgrades: 999,
      },
    });

    const res = await app.inject({
      method: 'POST', url: '/quests/daily/claim', headers: { cookie },
      payload: { orderId: other.id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('notToday');
  });

  it('refuses a claim the player has not earned', async () => {
    const playerId = await makePlayer('Impatient', { keepLevel: 3 });
    const cookie = await loginAs(app, playerId);
    const order = dailyOrdersFor(dayIndexOf(new Date()), playerId)[0]!;

    const res = await app.inject({
      method: 'POST', url: '/quests/daily/claim', headers: { cookie },
      payload: { orderId: order.id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('notComplete');
  });

  it('pays exactly once, however many times CLAIM is pressed', async () => {
    const playerId = await makePlayer('Doubler', { keepLevel: 3, gold: 0, iron: 0 });
    const cookie = await loginAs(app, playerId);
    const order = dailyOrdersFor(dayIndexOf(new Date()), playerId)[0]!;

    await db.player.update({
      where: { id: playerId },
      data: {
        // dayKey too: without it the next settle sees a stale day, zeroes
        // everything set here, and the test would be measuring the rollover.
        dayKey: dayIndexOf(new Date()),
        dayCollected: 999, dayTrained: 999, dayWins: 999, dayRaids: 999,
        dayStars: 999, dayThreeStars: 999, dayLootGold: 999_999, dayUpgrades: 999,
      },
    });

    const claim = () => app.inject({
      method: 'POST', url: '/quests/daily/claim', headers: { cookie },
      payload: { orderId: order.id },
    });

    const first = await claim();
    expect(first.statusCode).toBe(200);
    const paid = first.json().reward.g;
    expect(paid).toBeGreaterThan(0);

    const second = await claim();
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('alreadyClaimed');

    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(Number(after.gold)).toBe(paid);
  });

  it('rolls the counters over and advances the streak on a new day', async () => {
    const playerId = await makePlayer('Returner', { keepLevel: 3 });
    const cookie = await loginAs(app, playerId);

    // Yesterday: some progress, one order claimed, a nine-day streak.
    await db.player.update({
      where: { id: playerId },
      data: {
        dayKey: dayIndexOf(new Date()) - 1,
        dayCollected: 7,
        dailyClaimed: ['d-collect-8'],
        streakDays: 9,
      },
    });

    const view = (await app.inject({ method: 'GET', url: '/quests/daily', headers: { cookie } })).json();
    expect(view.streak).toBe(10);
    expect(view.orders.every((o: { claimed: boolean }) => !o.claimed)).toBe(true);

    const row = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(row.dayCollected).toBe(0);
    expect(row.dailyClaimed).toEqual([]);
  });

  it('resets the streak when a day was missed', async () => {
    const playerId = await makePlayer('Lapsed', { keepLevel: 3 });
    const cookie = await loginAs(app, playerId);
    await db.player.update({
      where: { id: playerId },
      data: { dayKey: dayIndexOf(new Date()) - 4, streakDays: 30 },
    });

    const view = (await app.inject({ method: 'GET', url: '/quests/daily', headers: { cookie } })).json();
    expect(view.streak).toBe(1);
  });

  it('counts collecting toward today, not just toward the lifetime total', async () => {
    const playerId = await makePlayer('Collector', { keepLevel: 3 });
    const cookie = await loginAs(app, playerId);
    // Put something in the mine to collect.
    await db.building.updateMany({ where: { playerId, type: 'mine' }, data: { stock: 40 } });

    await app.inject({ method: 'POST', url: '/collect', headers: { cookie }, payload: {} });

    const row = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(row.collected).toBe(1);
    expect(row.dayCollected).toBe(1);
  });
});
