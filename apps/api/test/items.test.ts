import { FIREPOT_DAMAGE, ITEM, hpOf } from '@ironvow/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ItemCommand } from '@ironvow/types';
import { buildApp } from '../src/app.js';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Battle items, server-side.
 *
 * The client decides *when* to use one. The server decides whether there was
 * one to use, what it did, and what it cost — and it decides all three by
 * replaying the command through the same simulation, so there is no second
 * ruleset to keep in step.
 */

let app: Awaited<ReturnType<typeof buildApp>>;

describe.skipIf(!hasDatabase)('battle items', () => {
  beforeAll(async () => {
    migrate();
    app = await buildApp();
    await app.ready();
  });
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await app.close(); await db.$disconnect(); });

  const buy = async (id: string, type: string, count: number) => app.inject({
    method: 'POST', url: '/item/buy', headers: { cookie: await loginAs(app, id) },
    payload: { type, count },
  });

  it('sells one, charges for it, and puts it in the pouch', async () => {
    const id = await makePlayer('buyer', { keepLevel: 6, gold: 20_000, iron: 20_000 });
    const res = await buy(id, 'horn', 1);
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(1);

    const p = await db.player.findUniqueOrThrow({ where: { id } });
    expect(p.pouch).toEqual({ horn: 1 });
    expect(Number(p.gold)).toBe(20_000 - ITEM.horn.cost.g);
  });

  it('refuses one the Keep has not reached', async () => {
    const id = await makePlayer('young', { keepLevel: 2, gold: 99_000, iron: 99_000 });
    const res = await buy(id, 'firepot', 1);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('itemLocked');
  });

  it('clamps to the pouch rather than refusing, and refuses only when it is full', async () => {
    const id = await makePlayer('hoarder', { keepLevel: 8, gold: 999_000, iron: 999_000 });
    // Asking for more than fits gives what fits, the same way a donation does.
    const first = await buy(id, 'horn', 9);
    expect(first.json().count).toBe(ITEM.horn.cap);
    const second = await buy(id, 'horn', 1);
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('pouchFull');
  });

  it('clamps to what the purse can pay, and never overdraws it', async () => {
    const id = await makePlayer('poorish', {
      keepLevel: 8, gold: ITEM.horn.cost.g * 2 + 10, iron: 0,
    });
    const res = await buy(id, 'horn', 3);
    expect(res.json().count).toBe(2);
    expect(Number((await db.player.findUniqueOrThrow({ where: { id } })).gold)).toBe(10);
  });

  it('refuses outright when even one is out of reach', async () => {
    const id = await makePlayer('broke', { keepLevel: 8, gold: 1, iron: 1 });
    expect((await buy(id, 'horn', 1)).json().error).toBe('cannotAfford');
  });

  it('freezes the pouch onto the raid, so a purchase mid-raid cannot be spent in it', async () => {
    const id = await makePlayer('raider', { keepLevel: 8, gold: 999_000, iron: 999_000 });
    const cookie = await loginAs(app, id);
    await buy(id, 'firepot', 1);

    const found = await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie } });
    expect(found.statusCode).toBe(200);
    expect(found.json().pouch).toEqual({ firepot: 1 });

    // Bought after the raid opened. The raid's own pouch must not move.
    await buy(id, 'horn', 1);
    const raid = await db.raid.findFirstOrThrow({ where: { attackerId: id } });
    expect(raid.pouch).toEqual({ firepot: 1 });
  });

  it('spends what the simulation accepted, and nothing it rejected', async () => {
    const id = await makePlayer('thrower', { keepLevel: 8, gold: 999_000, iron: 999_000 });
    const cookie = await loginAs(app, id);
    await buy(id, 'firepot', 1);

    const found = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie } })).json();
    // Three thrown, one in the pouch. The honest client would have sent one.
    const items: ItemCommand[] = [
      { tickIndex: 1, item: 'firepot', gx: 28, gy: 28 },
      { tickIndex: 2, item: 'firepot', gx: 29, gy: 29 },
      { tickIndex: 3, item: 'firepot', gx: 30, gy: 30 },
    ];
    const res = await app.inject({
      method: 'POST', url: `/raid/${found.raidId}/submit`, headers: { cookie },
      payload: { commands: [], items },
    });
    expect(res.statusCode).toBe(200);

    // Charged for exactly the one that landed.
    const p = await db.player.findUniqueOrThrow({ where: { id } });
    expect(p.pouch).toEqual({});
    const raid = await db.raid.findUniqueOrThrow({ where: { id: found.raidId } });
    expect(raid.items).toHaveLength(3);
  });

  it('actually changes the result the server computes', async () => {
    // The same raid twice: once with a Firepot on the Keep, once without. The
    // server decides destruction, so the item has to move the number it stores.
    const play = async (withItem: boolean) => {
      await resetDatabase();
      const id = await makePlayer('a', { keepLevel: 8, gold: 999_000, iron: 999_000 });
      const cookie = await loginAs(app, id);
      if (withItem) await buy(id, 'firepot', 1);
      const found = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie } })).json();
      // Scoring counts a structure that fell, not one that was dented, so the
      // thing to burn is a rampart -- which is what a Firepot is for anyway.
      const wall = found.snapshot.buildings.find((b: { type: string }) => b.type === 'wall');
      expect(wall).toBeDefined();
      const items: ItemCommand[] = withItem
        ? [{ tickIndex: 1, item: 'firepot', gx: wall.gx + 0.5, gy: wall.gy + 0.5 }]
        : [];
      await app.inject({
        method: 'POST', url: `/raid/${found.raidId}/submit`, headers: { cookie },
        payload: { commands: [], items },
      });
      return db.raid.findUniqueOrThrow({ where: { id: found.raidId } });
    };
    const withPot = await play(true);
    const without = await play(false);
    expect(withPot.destroyedPct).toBeGreaterThan(without.destroyedPct);
    expect(without.destroyedPct).toBe(0);
    // And the damage is the config's, not something the client asserted.
    expect(FIREPOT_DAMAGE).toBeLessThan(hpOf('keep', 10));
  });

  it('hands a replay both the pouch and the items, or it is not the same fight', async () => {
    const id = await makePlayer('replayer', { keepLevel: 8, gold: 999_000, iron: 999_000 });
    const cookie = await loginAs(app, id);
    await buy(id, 'firepot', 1);
    const found = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie } })).json();
    await app.inject({
      method: 'POST', url: `/raid/${found.raidId}/submit`, headers: { cookie },
      payload: { commands: [], items: [{ tickIndex: 1, item: 'firepot', gx: 28, gy: 28 }] },
    });

    const replay = (await app.inject({
      method: 'GET', url: `/raid/${found.raidId}/replay`, headers: { cookie },
    })).json();
    expect(replay.items).toHaveLength(1);
    // Without the pouch a replay would reject the very command the live raid
    // accepted, and the stored result would stop reproducing.
    expect(replay.pouch).toEqual({ firepot: 1 });
  });

  it('replays a raid submitted with no items at all', async () => {
    const id = await makePlayer('plain', { keepLevel: 8, gold: 9_000, iron: 9_000 });
    const cookie = await loginAs(app, id);
    const found = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie } })).json();
    const res = await app.inject({
      method: 'POST', url: `/raid/${found.raidId}/submit`, headers: { cookie },
      payload: { commands: [] },
    });
    expect(res.statusCode).toBe(200);
    const replay = (await app.inject({
      method: 'GET', url: `/raid/${found.raidId}/replay`, headers: { cookie },
    })).json();
    expect(replay.items).toEqual([]);
  });

  it('lists them on /progression with what is held and what is still locked', async () => {
    const id = await makePlayer('shopper', { keepLevel: 4, gold: 999_000, iron: 999_000 });
    const cookie = await loginAs(app, id);
    await buy(id, 'horn', 2);
    const view = (await app.inject({ method: 'GET', url: '/progression', headers: { cookie } })).json();
    const horn = view.items.find((i: { type: string }) => i.type === 'horn');
    const pot = view.items.find((i: { type: string }) => i.type === 'firepot');
    expect(horn.held).toBe(2);
    expect(horn.unlocked).toBe(true);
    expect(pot.held).toBe(0);
    expect(pot.unlocked).toBe(false);
  });
});
