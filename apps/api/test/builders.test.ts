import { MAX_BUILDERS, STARTING_BUILDERS, builderCost } from '@ironvow/config';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Hiring builders.
 *
 * A hold starts with two and can hire up to ten, for gold. It is the one
 * upgrade a brand-new hold can save toward from its first hour, and the only
 * one that is not gated by the Keep — a builder is not a building, it is how
 * fast the hold works.
 */

describe.skipIf(!hasDatabase)('the crew', () => {
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

  it('starts a hold on the opening crew', async () => {
    const playerId = await makePlayer('Newcomer');
    const cookie = await loginAs(app, playerId);
    const me = (await app.inject({ method: 'GET', url: '/me', headers: { cookie } })).json();
    expect(me.buildersTotal).toBe(STARTING_BUILDERS);
    expect(me.buildersFree).toBe(STARTING_BUILDERS);
  });

  it('hires the next builder for the quoted price', async () => {
    const playerId = await makePlayer('Foreman', { gold: 1_000_000 });
    const cookie = await loginAs(app, playerId);

    const before = (await app.inject({ method: 'GET', url: '/progression', headers: { cookie } })).json();
    expect(before.crew).toEqual({
      builders: STARTING_BUILDERS, max: MAX_BUILDERS, nextCost: builderCost(STARTING_BUILDERS),
    });

    const res = await app.inject({ method: 'POST', url: '/builder/hire', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().to).toBe(STARTING_BUILDERS + 1);

    const player = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(player.builders).toBe(STARTING_BUILDERS + 1);
    // Gold only: a builder never costs iron, so an iron-poor hold can still
    // buy its way to building faster.
    expect(player.gold).toBe(BigInt(1_000_000 - builderCost(STARTING_BUILDERS)!));
    expect(player.iron).toBe(BigInt(320));

    const after = (await app.inject({ method: 'GET', url: '/progression', headers: { cookie } })).json();
    expect(after.crew.nextCost).toBe(builderCost(STARTING_BUILDERS + 1));
  });

  it('refuses a hire nobody can pay for', async () => {
    const playerId = await makePlayer('Broke', { gold: 10 });
    const cookie = await loginAs(app, playerId);
    const res = await app.inject({ method: 'POST', url: '/builder/hire', headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('cannotAfford');
    expect((await db.player.findUniqueOrThrow({ where: { id: playerId } })).builders).toBe(STARTING_BUILDERS);
  });

  it('stops at ten, and quotes no price once it is there', async () => {
    const playerId = await makePlayer('Full', { gold: 100_000_000, builders: MAX_BUILDERS });
    const cookie = await loginAs(app, playerId);

    const crew = (await app.inject({ method: 'GET', url: '/progression', headers: { cookie } })).json().crew;
    expect(crew).toEqual({ builders: MAX_BUILDERS, max: MAX_BUILDERS, nextCost: null });

    const res = await app.inject({ method: 'POST', url: '/builder/hire', headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('crewFull');
  });

  it('lets the hold run as many jobs as it has hired', async () => {
    const playerId = await makePlayer('Busy', {
      keepLevel: 9, gold: 10_000_000, iron: 10_000_000, builders: 4,
    });
    const cookie = await loginAs(app, playerId);

    for (const [i, gx] of [8, 12, 16, 20].entries()) {
      const res = await app.inject({
        method: 'POST', url: '/build', headers: { cookie }, payload: { type: 'mine', gx, gy: 8 },
      });
      expect(res.statusCode, `mine ${i}`).toBe(200);
    }
    const fifth = await app.inject({
      method: 'POST', url: '/build', headers: { cookie }, payload: { type: 'cannon', gx: 24, gy: 8 },
    });
    expect(fifth.json().error).toBe('noBuilderFree');
  });

  it('prices every builder, and only the tenth has no successor', () => {
    for (let owned = STARTING_BUILDERS; owned < MAX_BUILDERS; owned++) {
      const price = builderCost(owned);
      expect(price).not.toBeNull();
      // Each one dearer than the last, so the crew is a decision every time
      // rather than a purchase made the moment it is affordable.
      if (owned > STARTING_BUILDERS) expect(price!).toBeGreaterThan(builderCost(owned - 1)!);
    }
    expect(builderCost(MAX_BUILDERS)).toBeNull();
  });
});
