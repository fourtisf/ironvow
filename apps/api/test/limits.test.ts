import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Rate limiting.
 *
 * Both of these came out of running the server against five thousand players
 * rather than six. Neither is visible at test scale.
 */

describe.skipIf(!hasDatabase)('rate limiting', () => {
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

  /**
   * Keying on IP looks right until you remember how mobile works: carriers put
   * thousands of subscribers behind a handful of addresses. A per-IP ceiling
   * would then be shared by everyone on that carrier, and the game would break
   * for whole networks at once — worst for exactly the phone users it targets.
   */
  it('gives each player their own budget, not each address', async () => {
    const a = await makePlayer('Neighbour A', { trophies: 100 });
    const bPlayer = await makePlayer('Neighbour B', { trophies: 110, gold: 20_000, iron: 20_000 });
    await db.troop.updateMany({ where: { playerId: a, type: 'raider' }, data: { count: 5 } });
    await db.troop.updateMany({ where: { playerId: bPlayer, type: 'raider' }, data: { count: 5 } });

    const cookieA = await loginAs(app, a);
    const cookieB = await loginAs(app, bPlayer);

    // Both arrive from the same address, as everyone behind one NAT does.
    // Spend most of A's matchmaking budget.
    for (let i = 0; i < 20; i++) {
      await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie: cookieA }, payload: { reroll: true } });
    }
    const aBlocked = await app.inject({
      method: 'POST', url: '/raid/find', headers: { cookie: cookieA }, payload: { reroll: true },
    });
    expect(aBlocked.statusCode).toBe(429);

    // B is a different player and must be untouched by A's spending.
    const bFine = await app.inject({
      method: 'POST', url: '/raid/find', headers: { cookie: cookieB }, payload: {},
    });
    expect(bFine.statusCode).toBe(200);
  });

  /**
   * The error handler used to swallow the framework's own status and answer
   * 500, so a client could not tell "slow down" from "the server is broken"
   * and had no way to back off.
   */
  it('answers a rate limit with 429, not 500', async () => {
    // Funded, so the reroll charge does not run out before the limit bites.
    const playerId = await makePlayer('Impatient', { trophies: 100, gold: 1_000_000 });
    const cookie = await loginAs(app, playerId);

    let limited: Awaited<ReturnType<typeof app.inject>> | null = null;
    for (let i = 0; i < 40 && !limited; i++) {
      const res = await app.inject({
        method: 'POST', url: '/raid/find', headers: { cookie }, payload: { reroll: true },
      });
      if (res.statusCode === 429) limited = res;
    }

    expect(limited).not.toBeNull();
    expect(limited!.statusCode).toBe(429);
    expect(limited!.json().error).toBe('rateLimited');
  });
});
