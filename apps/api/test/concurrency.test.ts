import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { costOf } from '@ironvow/config';
import type { FastifyInstance } from 'fastify';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Double-spend under concurrency (spec S12).
 *
 * Fifty upgrade requests are fired at one player who can afford exactly one.
 * Without the row-level lock in `lockPlayer`, they all read the same balance,
 * all decide they can pay, and the player gets fifty upgrades for one payment.
 * With it, one wins and forty-nine are refused.
 */

describe.skipIf(!hasDatabase)('concurrent commands cannot double-spend', () => {
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

  it('resolves 50 simultaneous upgrades of one building to exactly one success', async () => {
    // A Keep 1 -> 2 costs 900 gold and 260 iron. Fund exactly that, once.
    const cost = costOf('keep', 1, 1);
    const playerId = await makePlayer('Solo', { gold: cost.g, iron: cost.i });
    const cookie = await loginAs(app, playerId);
    const keep = await db.building.findFirstOrThrow({ where: { playerId, type: 'keep' } });

    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({
          method: 'POST',
          url: '/upgrade',
          headers: { cookie },
          payload: { buildingId: keep.id },
        }),
      ),
    );

    const ok = responses.filter((r) => r.statusCode === 200);
    const refused = responses.filter((r) => r.statusCode === 409);
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(49);
    // Two refusals are correct here and both are right: the losers either
    // cannot pay, or arrive after a builder is already on the Keep. What
    // matters is that the payment happened exactly once.
    expect(refused.every((r) => ['cannotAfford', 'alreadyBusy'].includes(r.json().error))).toBe(true);

    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(after.gold).toBe(0n);
    expect(after.iron).toBe(0n);
    // The Keep is under upgrade, not upgraded: the level lands when the timer
    // does, so nothing it would unlock is available yet.
    expect(after.keepLevel).toBe(1);

    const keepAfter = await db.building.findUniqueOrThrow({ where: { id: keep.id } });
    expect(keepAfter.level).toBe(1);
    expect(keepAfter.upgradingTo).toBe(2);
    expect(keepAfter.completesAt).not.toBeNull();
  });

  it('never lets a balance go negative under a burst of builds', async () => {
    // Enough for two mines: 150 then 233.
    const playerId = await makePlayer('Builder', { gold: 400, iron: 0 });
    const cookie = await loginAs(app, playerId);

    const responses = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/build',
          headers: { cookie },
          payload: { type: 'mine', gx: 6 + (i % 15) * 3, gy: 6 + Math.floor(i / 15) * 3 },
        }),
      ),
    );

    const built = responses.filter((r) => r.statusCode === 200).length;
    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    const mines = await db.building.count({ where: { playerId, type: 'mine' } });

    expect(after.gold).toBeGreaterThanOrEqual(0n);
    // One mine came with the starting layout.
    expect(mines).toBe(built + 1);
    // A Keep 1 permits three mines in total, so at most two more can be bought.
    expect(built).toBeLessThanOrEqual(2);
  });

  it('does not let two concurrent moves put a building in two places', async () => {
    const playerId = await makePlayer('Mover');
    const cookie = await loginAs(app, playerId);
    const mine = await db.building.findFirstOrThrow({ where: { playerId, type: 'mine' } });

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/move',
          headers: { cookie },
          payload: { buildingId: mine.id, gx: 8 + i, gy: 8 },
        }),
      ),
    );

    // Prototype bug #3 produced two rows sharing one id. There is exactly one row.
    const rows = await db.building.findMany({ where: { playerId, type: 'mine' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(mine.id);
  });

  it('charges once per queued troop under a burst of train requests', async () => {
    const playerId = await makePlayer('Trainer', { gold: 450, iron: 0 });
    const cookie = await loginAs(app, playerId);

    await Promise.all(
      Array.from({ length: 20 }, () =>
        app.inject({ method: 'POST', url: '/train', headers: { cookie }, payload: { type: 'raider' } }),
      ),
    );

    const queued = await db.trainJob.count({ where: { playerId } });
    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    // Raiders cost 45 gold each, so 450 buys ten, and the warband holds fourteen.
    expect(queued).toBe(10);
    expect(after.gold).toBe(0n);
  });
});
