import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { NIGHT_START_GOLD, NIGHT_UNLOCK_KEEP } from '@ironvow/config';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Two worlds, and nothing crossing between them.
 *
 * ALFA: "2 dunia berbeda malam kaya coc". The rule the whole feature rests on
 * is in worlds.ts and it has no exceptions — gold mined at night cannot pay for
 * a Cannon in the day, an army trained in one cannot raid in the other, and the
 * trophies are two ladders.
 *
 * These are the tests that would catch it leaking. A leak is not a crash: every
 * number stays plausible, every check passes, and the game is quietly wrong
 * about which pocket it is spending from — which is unrecoverable once players
 * have spent months either side of it.
 */
describe.skipIf(!hasDatabase)('the night world', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    delete process.env.ACCESS_CODE;
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

  /** A hold high enough up the day world to be allowed across. */
  async function crossed(): Promise<{ id: string; cookie: string }> {
    const id = await makePlayer('Traveller', { keepLevel: NIGHT_UNLOCK_KEEP, gold: 50_000, iron: 50_000 });
    await db.building.updateMany({ where: { playerId: id, type: 'keep' }, data: { level: NIGHT_UNLOCK_KEEP } });
    const cookie = await loginAs(app, id);
    const gone = await app.inject({ method: 'POST', url: '/world', headers: { cookie }, payload: { world: 'night' } });
    expect(gone.statusCode).toBe(200);
    return { id, cookie };
  }

  it('is shut until the day Town Hall is high enough', async () => {
    const id = await makePlayer('Early', { keepLevel: 1 });
    const cookie = await loginAs(app, id);
    const shut = await app.inject({ method: 'POST', url: '/world', headers: { cookie }, payload: { world: 'night' } });
    expect(shut.statusCode).toBe(409);
    expect(shut.json().error).toBe('nightLocked');
    expect(await db.building.count({ where: { playerId: id, world: 'night' } })).toBe(0);
  });

  it('lays a base down the first time somebody crosses, and only the first time', async () => {
    const { id, cookie } = await crossed();
    const laid = await db.building.count({ where: { playerId: id, world: 'night' } });
    expect(laid).toBeGreaterThan(0);

    // Crossing again must not build a second opening base on top of the first.
    await app.inject({ method: 'POST', url: '/world', headers: { cookie }, payload: { world: 'night' } });
    await app.inject({ method: 'POST', url: '/world', headers: { cookie }, payload: { world: 'night' } });
    expect(await db.building.count({ where: { playerId: id, world: 'night' } })).toBe(laid);
  });

  it('starts the night world with its own purse', async () => {
    const { cookie } = await crossed();
    const night = await app.inject({ method: 'GET', url: '/me?world=night', headers: { cookie } });
    expect(night.json().gold).toBe(NIGHT_START_GOLD);

    // And the day world's is untouched by any of it.
    const day = await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    expect(day.json().gold).toBe(50_000);
  });

  it('shows each world only its own buildings', async () => {
    const { cookie } = await crossed();
    const day = (await app.inject({ method: 'GET', url: '/me', headers: { cookie } })).json();
    const night = (await app.inject({ method: 'GET', url: '/me?world=night', headers: { cookie } })).json();

    const ids = new Set(day.buildings.map((b: { id: string }) => b.id));
    for (const b of night.buildings) expect(ids.has(b.id), 'a building in both worlds').toBe(false);
    expect(day.world).toBe('day');
    expect(night.world).toBe('night');
  });

  it('spends the night purse on a night building, and never the day one', async () => {
    /*
     * The leak that would not crash. The price check reads the night purse
     * because `settleAndLoad` chose it — so a write that named `gold:` would
     * pass every check and quietly take the money out of the day world.
     */
    const { cookie } = await crossed();
    const before = (await app.inject({ method: 'GET', url: '/me?world=night', headers: { cookie } })).json();
    const dayBefore = (await app.inject({ method: 'GET', url: '/me', headers: { cookie } })).json();

    const built = await app.inject({
      method: 'POST', url: '/build', headers: { cookie },
      payload: { world: 'night', type: 'mine', gx: 20, gy: 20 },
    });
    expect(built.statusCode).toBe(200);

    const after = built.json().player;
    expect(after.world).toBe('night');
    expect(after.gold).toBeLessThan(before.gold);

    const dayAfter = (await app.inject({ method: 'GET', url: '/me', headers: { cookie } })).json();
    expect(dayAfter.gold).toBe(dayBefore.gold);
    expect(dayAfter.buildings.length).toBe(dayBefore.buildings.length);
  });

  it('refuses what the night world does not build', async () => {
    const { cookie } = await crossed();
    for (const type of ['lab', 'statue', 'brazier', 'standard']) {
      const no = await app.inject({
        method: 'POST', url: '/build', headers: { cookie },
        payload: { world: 'night', type, gx: 30, gy: 30 },
      });
      expect(no.statusCode, type).toBe(409);
    }
    // And the day world still builds them. Clear of the opening layout, which
    // reaches to (33,34) — a refusal here would be the placement rule, not the
    // world rule, and the test would be proving the wrong thing.
    const yes = await app.inject({
      method: 'POST', url: '/build', headers: { cookie },
      payload: { type: 'lab', gx: 38, gy: 38 },
    });
    expect(yes.statusCode).toBe(200);
  });

  it('keeps the two armies apart', async () => {
    const { id, cookie } = await crossed();
    await db.troop.updateMany({ where: { playerId: id, world: 'day', type: 'raider' }, data: { count: 9 } });

    const day = (await app.inject({ method: 'GET', url: '/me', headers: { cookie } })).json();
    const night = (await app.inject({ method: 'GET', url: '/me?world=night', headers: { cookie } })).json();
    expect(day.army.raider).toBe(9);
    expect(night.army.raider).toBe(0);
  });

  it('gives each world its own production clock', async () => {
    /*
     * The subtle one. Production pays out for the time since the last tick, so
     * a single shared clock would mean opening the day base resets the night
     * base's accrual — and whatever it had earned is gone, with nothing
     * anywhere to show it ever existed.
     */
    const { id, cookie } = await crossed();
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await db.player.update({ where: { id }, data: { nightTickAt: old } });

    // Settle the day world. The night clock must not move.
    await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    const still = await db.player.findUniqueOrThrow({ where: { id }, select: { nightTickAt: true } });
    expect(still.nightTickAt.getTime()).toBe(old.getTime());

    // Settling the night world is what moves it.
    await app.inject({ method: 'GET', url: '/me?world=night', headers: { cookie } });
    const moved = await db.player.findUniqueOrThrow({ where: { id }, select: { nightTickAt: true } });
    expect(moved.nightTickAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it('does not pay War Orders for night work', async () => {
    // A quest finished in a world where the reward cannot be spent is a quest
    // that lies about what it is for.
    const { id, cookie } = await crossed();
    const before = await db.player.findUniqueOrThrow({ where: { id }, select: { collected: true } });
    await db.building.updateMany({ where: { playerId: id, world: 'night', type: 'mine' }, data: { stock: 500 } });

    await app.inject({ method: 'POST', url: '/collect', headers: { cookie }, payload: { world: 'night' } });
    const after = await db.player.findUniqueOrThrow({
      where: { id }, select: { collected: true, nightGold: true },
    });
    expect(after.collected).toBe(before.collected);
    expect(Number(after.nightGold)).toBeGreaterThan(NIGHT_START_GOLD);
  });

  it('reports which worlds are open', async () => {
    const cookie = await loginAs(app, await makePlayer('Peering', { keepLevel: 1 }));
    const shut = (await app.inject({ method: 'GET', url: '/worlds', headers: { cookie } })).json();
    expect(shut.worlds.find((w: { world: string }) => w.world === 'night').open).toBe(false);
    expect(shut.worlds.find((w: { world: string }) => w.world === 'day').open).toBe(true);
  });
});
