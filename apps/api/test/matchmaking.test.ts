import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Matchmaking must always find something.
 *
 * The failure this exists to prevent: a new player at zero trophies on a quiet
 * server presses RAID and gets a 404. That is the most important button in the
 * game answering "no". A generated hold is the floor under the trophy band, not
 * a replacement for it.
 */

describe.skipIf(!hasDatabase)('finding an opponent', () => {
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

  async function armed(name: string, opts: Parameters<typeof makePlayer>[1] = {}) {
    const id = await makePlayer(name, opts);
    await db.troop.updateMany({ where: { playerId: id, type: 'raider' }, data: { count: 10 } });
    return id;
  }

  it('finds a garrison when the player is alone on the server', async () => {
    const playerId = await armed('Alone', { trophies: 0 });
    const cookie = await loginAs(app, playerId);

    const res = await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} });
    expect(res.statusCode).toBe(200);

    const scout = res.json();
    expect(scout.isPlayer).toBe(false);
    expect(scout.snapshot.buildings.length).toBeGreaterThan(0);
    expect(scout.snapshot.pool.g).toBeGreaterThan(0);
    // Named, not "Opponent": a nameless target is a placeholder, not a hold.
    expect(scout.snapshot.defenderName).toBeTruthy();
    expect(scout.snapshot.defenderName).not.toBe('');
  });

  it('still prefers a real player when one is in band', async () => {
    const playerId = await armed('Seeker', { trophies: 300 });
    const rivalId = await makePlayer('Rival', { trophies: 310, gold: 30_000, iron: 30_000 });
    const cookie = await loginAs(app, playerId);

    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();
    expect(scout.isPlayer).toBe(true);
    expect(scout.snapshot.defenderId).toBe(rivalId);
  });

  it('resolves a raid on a garrison, paying the attacker without charging anybody', async () => {
    const playerId = await armed('Solo', { trophies: 0, gold: 0, iron: 0 });
    const cookie = await loginAs(app, playerId);

    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();
    const commands = Array.from({ length: 10 }, (_, i) => ({
      tickIndex: i * 2, troopType: 'raider' as const, gx: 17 + (i % 3), gy: 40,
    }));

    const res = await app.inject({
      method: 'POST', url: `/raid/${scout.raidId}/submit`, headers: { cookie }, payload: { commands },
    });
    expect(res.statusCode).toBe(200);

    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(after.raids).toBe(1);
    // No player row was touched but this one.
    expect(await db.player.count()).toBe(1);

    const raid = await db.raid.findUniqueOrThrow({ where: { id: scout.raidId } });
    expect(raid.defenderId).toBeNull();
    expect(raid.status).toBe('resolved');
  });

  it('never lets a garrison raid appear in somebody’s attack log', async () => {
    const playerId = await armed('Quiet', { trophies: 0 });
    const cookie = await loginAs(app, playerId);
    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();
    await app.inject({
      method: 'POST', url: `/raid/${scout.raidId}/submit`, headers: { cookie },
      payload: { commands: [] },
    });

    const log = (await app.inject({ method: 'GET', url: '/raids/incoming', headers: { cookie } })).json();
    expect(log.raids).toHaveLength(0);
  });

  it('replays a garrison raid from stored fields alone', async () => {
    const { seedToInt32, simulate } = await import('@ironvow/sim');
    const playerId = await armed('Replayer', { trophies: 120 });
    const cookie = await loginAs(app, playerId);

    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();
    const commands = Array.from({ length: 8 }, (_, i) => ({
      tickIndex: i * 3, troopType: 'raider' as const, gx: 17, gy: 40,
    }));
    await app.inject({
      method: 'POST', url: `/raid/${scout.raidId}/submit`, headers: { cookie }, payload: { commands },
    });

    const raid = await db.raid.findUniqueOrThrow({ where: { id: scout.raidId } });
    const replay = simulate({
      snapshot: raid.snapshot as never,
      commands: raid.commands as never,
      army: raid.army as never,
      hero: raid.hero as never,
      troopLevels: raid.troopLevels as never,
      seed: seedToInt32(raid.seed),
    });
    expect(replay.checksum).toBe(raid.checksum);
    expect(replay.stars).toBe(raid.stars);
  });
});

describe.skipIf(!hasDatabase)('revenge', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    migrate();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(resetDatabase);

  async function raidHappened() {
    const attackerId = await makePlayer('Aggressor', { trophies: 200, gold: 5000, iron: 5000 });
    await db.troop.updateMany({ where: { playerId: attackerId, type: 'raider' }, data: { count: 8 } });
    const victimId = await makePlayer('Victim', { trophies: 205, gold: 40_000, iron: 40_000 });
    await db.troop.updateMany({ where: { playerId: victimId, type: 'raider' }, data: { count: 8 } });

    const cookie = await loginAs(app, attackerId);
    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();
    await app.inject({
      method: 'POST', url: `/raid/${scout.raidId}/submit`, headers: { cookie },
      payload: { commands: [{ tickIndex: 0, troopType: 'raider', gx: 18, gy: 27 }] },
    });
    return { attackerId, victimId, raidId: scout.raidId };
  }

  it('lets the player who was raided open a raid straight back', async () => {
    const { attackerId, victimId, raidId } = await raidHappened();
    // Clear any shield the raid handed out, so the target is reachable.
    await db.player.update({ where: { id: attackerId }, data: { shieldUntil: null } });

    const cookie = await loginAs(app, victimId);
    const res = await app.inject({
      method: 'POST', url: '/raid/revenge', headers: { cookie }, payload: { raidId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().snapshot.defenderId).toBe(attackerId);
    expect(res.json().isPlayer).toBe(true);
  });

  it('refuses revenge on a raid that was not against you', async () => {
    const { attackerId, raidId } = await raidHappened();
    const cookie = await loginAs(app, attackerId);
    const res = await app.inject({
      method: 'POST', url: '/raid/revenge', headers: { cookie }, payload: { raidId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('respects a shield, even for revenge', async () => {
    const { attackerId, victimId, raidId } = await raidHappened();
    await db.player.update({
      where: { id: attackerId },
      data: { shieldUntil: new Date(Date.now() + 3_600_000) },
    });

    const cookie = await loginAs(app, victimId);
    const res = await app.inject({
      method: 'POST', url: '/raid/revenge', headers: { cookie }, payload: { raidId },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('shielded');
  });
});

describe.skipIf(!hasDatabase)('the ladder', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    migrate();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(resetDatabase);

  it('ranks by trophies and tells a player where they stand', async () => {
    for (const [name, trophies] of [['Top', 900], ['Middle', 500], ['Low', 100]] as const) {
      await makePlayer(name, { trophies });
    }
    const meId = await makePlayer('Me', { trophies: 300 });
    const cookie = await loginAs(app, meId);

    const board = (await app.inject({ method: 'GET', url: '/leaderboard', headers: { cookie } })).json();
    expect(board.top.map((p: { name: string }) => p.name)).toEqual(['Top', 'Middle', 'Me', 'Low']);
    expect(board.me.rank).toBe(3);
    expect(board.total).toBe(4);
    expect(board.top.find((p: { isMe: boolean }) => p.isMe).name).toBe('Me');
  });

  it('gives a lone player rank one', async () => {
    const meId = await makePlayer('Only', { trophies: 0 });
    const cookie = await loginAs(app, meId);
    const board = (await app.inject({ method: 'GET', url: '/leaderboard', headers: { cookie } })).json();
    expect(board.me.rank).toBe(1);
  });
});

describe.skipIf(!hasDatabase)('operations endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    migrate();
    process.env.OPS_TOKEN = 'ops-token-for-tests-0123456789';
    const { resetEnv } = await import('../src/lib/env.js');
    resetEnv();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.OPS_TOKEN;
    const { resetEnv } = await import('../src/lib/env.js');
    resetEnv();
  });
  beforeEach(resetDatabase);

  const auth = { authorization: 'Bearer ops-token-for-tests-0123456789' };

  it('refuses without the token', async () => {
    expect((await app.inject({ method: 'GET', url: '/ops/divergence' })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'GET', url: '/ops/divergence', headers: { authorization: 'Bearer wrong-token-entirely' },
    })).statusCode).toBe(401);
  });

  it('will not judge a handful of raids', async () => {
    const res = (await app.inject({ method: 'GET', url: '/ops/divergence', headers: auth })).json();
    expect(res.verdict).toBe('tooFewRaidsToJudge');
    expect(res.divergences).toBe(0);
  });

  it('calls a high divergence rate a determinism bug, not cheating', async () => {
    const attackerId = await makePlayer('Sample', { trophies: 10 });
    for (let i = 0; i < 60; i++) {
      await db.raid.create({
        data: {
          attackerId, seed: 1n, snapshot: {}, army: {},
          status: 'resolved', resolvedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    }
    for (let i = 0; i < 5; i++) {
      await db.divergence.create({
        data: {
          raidId: 'r' + i, playerId: attackerId,
          clientChecksum: 'aaaa', serverChecksum: 'bbbb',
          clientStars: 3, serverStars: 1, userAgent: 'TestKit/1.0',
        },
      });
    }

    const res = (await app.inject({ method: 'GET', url: '/ops/divergence', headers: auth })).json();
    expect(res.raidsResolved).toBe(60);
    expect(res.divergences).toBe(5);
    expect(res.verdict).toBe('likelyDeterminismBug');
    // Grouping by client is what points at one engine's maths.
    expect(res.byUserAgent[0]).toEqual({ userAgent: 'TestKit/1.0', count: 5 });
  });

  it('flags a worker that has stopped expiring raids', async () => {
    const playerId = await makePlayer('Stuck', { trophies: 10 });
    await db.raid.create({
      data: {
        attackerId: playerId, seed: 1n, snapshot: {}, army: {},
        status: 'open', expiresAt: new Date(Date.now() - 600_000),
      },
    });
    const res = (await app.inject({ method: 'GET', url: '/ops/health', headers: auth })).json();
    expect(res.staleRaids).toBe(1);
    expect(res.workerHealthy).toBe(false);
  });
});
