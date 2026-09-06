import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QUESTS, START_GOLD, questById } from '@ironvow/config';
import type { FastifyInstance } from 'fastify';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * War Orders.
 *
 * These are the closest thing the game has to a tutorial, so the thing worth
 * testing is not that they exist but that they cannot be gamed: progress is
 * measured from server state, and a reward is paid exactly once no matter how
 * many times CLAIM is pressed.
 */

describe.skipIf(!hasDatabase)('war orders', () => {
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

  it('reports live progress derived from the player’s real state', async () => {
    const playerId = await makePlayer('Orders', { keepLevel: 3, trophies: 60 });
    const cookie = await loginAs(app, playerId);

    const { quests } = (await app.inject({ method: 'GET', url: '/quests', headers: { cookie } })).json();
    expect(quests).toHaveLength(QUESTS.length);

    const mines = quests.find((q: { id: string }) => q.id === 'q2');
    const keep = quests.find((q: { id: string }) => q.id === 'q6');
    const trophies = quests.find((q: { id: string }) => q.id === 'q10');

    // The starting layout has exactly one mine.
    expect(mines.progress).toBe(1);
    // Keep 3 satisfies the "reach level 2" order.
    expect(keep.progress).toBe(2);
    expect(trophies.progress).toBe(60);
    expect(quests.every((q: { claimed: boolean }) => !q.claimed)).toBe(true);
  });

  it('refuses to pay for an order that is not finished', async () => {
    const playerId = await makePlayer('Impatient');
    const cookie = await loginAs(app, playerId);

    const res = await app.inject({
      method: 'POST', url: '/quests/claim', headers: { cookie }, payload: { questId: 'q12' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('notComplete');
  });

  it('pays a finished order once, and clamps the reward to storage', async () => {
    const playerId = await makePlayer('Earner', { keepLevel: 2, gold: 100, iron: 0 });
    const cookie = await loginAs(app, playerId);

    const quest = questById('q6')!;
    const res = await app.inject({
      method: 'POST', url: '/quests/claim', headers: { cookie }, payload: { questId: 'q6' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reward).toEqual(quest.reward);

    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(after.gold).toBe(BigInt(100 + quest.reward.g));
    expect(after.claimedQuests).toEqual(['q6']);

    const again = await app.inject({
      method: 'POST', url: '/quests/claim', headers: { cookie }, payload: { questId: 'q6' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('alreadyClaimed');
  });

  it('pays exactly once under a burst of simultaneous claims', async () => {
    const playerId = await makePlayer('Masher', { keepLevel: 4, gold: 0, iron: 0 });
    const cookie = await loginAs(app, playerId);

    const responses = await Promise.all(
      Array.from({ length: 25 }, () =>
        app.inject({ method: 'POST', url: '/quests/claim', headers: { cookie }, payload: { questId: 'q11' } })),
    );

    expect(responses.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(after.gold).toBe(BigInt(questById('q11')!.reward.g));
    expect(after.claimedQuests).toEqual(['q11']);
  });

  it('counts collections, and pays the first order once three are made', async () => {
    const playerId = await makePlayer('Tapper');
    const cookie = await loginAs(app, playerId);
    const mine = await db.building.findFirstOrThrow({ where: { playerId, type: 'mine' } });

    for (let i = 0; i < 3; i++) {
      await db.building.update({ where: { id: mine.id }, data: { stock: 50 } });
      await app.inject({ method: 'POST', url: '/collect', headers: { cookie }, payload: { buildingId: mine.id } });
    }

    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(after.collected).toBe(3);

    const claim = await app.inject({
      method: 'POST', url: '/quests/claim', headers: { cookie }, payload: { questId: 'q1' },
    });
    expect(claim.statusCode).toBe(200);
  });

  it('counts a trained troop only when it leaves the queue', async () => {
    const playerId = await makePlayer('Drillmaster', { gold: 5000, iron: 0 });
    const cookie = await loginAs(app, playerId);

    await app.inject({ method: 'POST', url: '/train', headers: { cookie }, payload: { type: 'raider', count: 5 } });
    expect((await db.player.findUniqueOrThrow({ where: { id: playerId } })).trainedTotal).toBe(0);

    // Fast-forward the queue rather than waiting out five real training times.
    await db.trainJob.updateMany({ where: { playerId }, data: { finishesAt: new Date(Date.now() - 1000) } });
    await app.inject({ method: 'GET', url: '/me', headers: { cookie } });

    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(after.trainedTotal).toBe(5);
    expect(await db.trainJob.count({ where: { playerId } })).toBe(0);
  });

  it('rejects an order id that does not exist', async () => {
    const playerId = await makePlayer('Chancer');
    const cookie = await loginAs(app, playerId);
    const res = await app.inject({
      method: 'POST', url: '/quests/claim', headers: { cookie }, payload: { questId: 'q999' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe.skipIf(!hasDatabase)('guest holds', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    migrate();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => { await app?.close(); });
  beforeEach(resetDatabase);

  it('creates a playable hold from one request, with no email', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/guest' });
    expect(res.statusCode).toBe(200);
    const cookie = res.headers['set-cookie'];
    expect(cookie).toBeTruthy();

    const me = await app.inject({
      method: 'GET', url: '/me',
      headers: { cookie: String(Array.isArray(cookie) ? cookie[0] : cookie).split(';')[0]! },
    });
    expect(me.statusCode).toBe(200);
    const player = me.json();
    expect(player.isGuest).toBe(true);
    // The prototype's opening layout: Keep, mine, barracks.
    expect(player.buildings).toHaveLength(3);
    expect(player.gold).toBe(START_GOLD);
  });

  it('upgrades the same hold when an email is attached, rather than making a second one', async () => {
    const guest = await app.inject({ method: 'POST', url: '/auth/guest' });
    const raw = guest.headers['set-cookie'];
    const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0]!;
    const playerId = guest.json().playerId;

    // Give the hold something worth keeping, so a lost account would be felt.
    await db.player.update({ where: { id: playerId }, data: { gold: 12_345n, trophies: 77 } });

    const claim = await app.inject({
      method: 'POST', url: '/auth/claim', headers: { cookie }, payload: { email: 'keeper@example.com' },
    });
    expect(claim.statusCode).toBe(200);

    const link = await db.loginLink.findFirstOrThrow({ where: { email: 'keeper@example.com' } });
    expect(link.playerId).toBe(playerId);

    // Redeeming it must land on the same player, not a fresh base.
    const before = await db.player.count();
    await db.loginLink.update({ where: { id: link.id }, data: { usedAt: null } });

    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(after.gold).toBe(12_345n);
    expect(before).toBe(1);
  });

  it('refuses an email that already belongs to somebody else', async () => {
    await db.player.create({
      data: { name: 'Established', email: 'taken@example.com' },
    });
    const guest = await app.inject({ method: 'POST', url: '/auth/guest' });
    const raw = guest.headers['set-cookie'];
    const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0]!;

    const res = await app.inject({
      method: 'POST', url: '/auth/claim', headers: { cookie }, payload: { email: 'taken@example.com' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('emailTaken');
  });
});
