import {
  RELIC,
  RELIC_FORGE_COST,
  RELIC_KEEP_LEVEL,
  RELIC_MAX_LEVEL,
  RELIC_SLOTS,
  heroStats,
  heroWith,
  parseLoadout,
  relicRaiseCost,
  respawnWith,
  warShards,
} from '@ironvow/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Relics.
 *
 * A Keep tops out at 9 and everything tops out with it, so a finished player
 * had nothing left to work towards. Relics are that — and the currency is
 * deliberately not gold, because gold is what a finished hold has too much of.
 *
 * The rules worth pinning: a relic only helps while it is carried, a loadout is
 * never trusted, and the whole thing is frozen onto a raid like the hero level.
 */

let app: Awaited<ReturnType<typeof buildApp>>;

describe('what a relic is worth', () => {
  it('is worth nothing at all while it sits in the vault', () => {
    const base = heroStats(5);
    // Forged to level 10 and carried by nobody.
    expect(heroWith(base, { bulwark: 10 }, [null, null])).toEqual(base);
  });

  it('moves exactly the one number it says it moves', () => {
    const base = heroStats(5);
    const tough = heroWith(base, { bulwark: 4 }, ['bulwark', null]);
    expect(tough.hp).toBeGreaterThan(base.hp);
    expect(tough.dmg).toBe(base.dmg);

    const sharp = heroWith(base, { edge: 4 }, ['edge', null]);
    expect(sharp.dmg).toBeGreaterThan(base.dmg);
    expect(sharp.hp).toBe(base.hp);
  });

  it('never touches speed, reach or cadence, whatever is carried', () => {
    const base = heroStats(5);
    const both = heroWith(base, { bulwark: 10, edge: 10 }, ['bulwark', 'edge']);
    expect(both.spd).toBe(base.spd);
    expect(both.rng).toBe(base.rng);
    expect(both.cd).toBe(base.cd);
  });

  it('brings the hero back sooner with Haste, and never instantly', () => {
    const plain = respawnWith(9);
    expect(respawnWith(9, { haste: 5 }, ['haste', null])).toBeLessThan(plain);
    // A hero with no cost to losing is a hero nobody thinks about committing,
    // which is the only thing that made it interesting.
    expect(respawnWith(1, { haste: RELIC_MAX_LEVEL }, ['haste', null])).toBeGreaterThanOrEqual(3);
  });
});

describe('a loadout is never trusted', () => {
  it('drops a relic that was never forged', () => {
    expect(parseLoadout(['bulwark', 'edge'], { bulwark: 2 })).toEqual(['bulwark', null]);
  });

  it('refuses to carry the same one twice', () => {
    expect(parseLoadout(['edge', 'edge'], { edge: 3 })).toEqual(['edge', null]);
  });

  it('is always the right length, whatever was stored', () => {
    expect(parseLoadout(null)).toHaveLength(RELIC_SLOTS);
    expect(parseLoadout(['edge', 'bulwark', 'haste'], { edge: 1, bulwark: 1, haste: 1 }))
      .toHaveLength(RELIC_SLOTS);
  });

  it('has fewer slots than there are relics, so carrying is a choice', () => {
    expect(RELIC_SLOTS).toBeLessThan(Object.keys(RELIC).length);
  });
});

describe('shards', () => {
  it('pay more for a war won than a war lost, per star', () => {
    expect(warShards(3, true)).toBeGreaterThan(warShards(3, false));
    expect(warShards(0, true)).toBe(0);
  });

  it('get harder to spend as a relic climbs', () => {
    for (let lv = 1; lv < RELIC_MAX_LEVEL; lv++) {
      expect(relicRaiseCost(lv + 1)).toBeGreaterThan(relicRaiseCost(lv));
    }
  });
});

describe.skipIf(!hasDatabase)('over the wire', () => {
  beforeAll(async () => {
    migrate();
    app = await buildApp();
    await app.ready();
  });
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await app.close(); await db.$disconnect(); });

  const forge = async (id: string, type: string) => app.inject({
    method: 'POST', url: '/relic/forge', headers: { cookie: await loginAs(app, id) },
    payload: { type },
  });
  const carry = async (id: string, slot: number, type: string | null) => app.inject({
    method: 'POST', url: '/relic/carry', headers: { cookie: await loginAs(app, id) },
    payload: { slot, type },
  });

  it('forges one, spends the shards, and raises it after', async () => {
    const id = await makePlayer('smith', { keepLevel: RELIC_KEEP_LEVEL, shards: 500 });
    expect((await forge(id, 'edge')).statusCode).toBe(200);
    let p = await db.player.findUniqueOrThrow({ where: { id } });
    expect(p.relics).toEqual({ edge: 1 });
    expect(p.shards).toBe(500 - RELIC_FORGE_COST);

    expect((await forge(id, 'edge')).statusCode).toBe(200);
    p = await db.player.findUniqueOrThrow({ where: { id } });
    expect(p.relics).toEqual({ edge: 2 });
    expect(p.shards).toBe(500 - RELIC_FORGE_COST - relicRaiseCost(1));
  });

  it('refuses without the shards, and without the Keep', async () => {
    const poor = await makePlayer('poor', { keepLevel: RELIC_KEEP_LEVEL, shards: 1 });
    expect((await forge(poor, 'edge')).json().error).toBe('noShards');

    const young = await makePlayer('young', { keepLevel: RELIC_KEEP_LEVEL - 1, shards: 9_000 });
    expect((await forge(young, 'edge')).json().error).toBe('relicLocked');
  });

  it('stops at the top rather than taking the shards', async () => {
    const id = await makePlayer('maxed', {
      keepLevel: RELIC_KEEP_LEVEL, shards: 99_999,
      relics: { edge: RELIC_MAX_LEVEL }, carried: ['edge', null],
    });
    expect((await forge(id, 'edge')).json().error).toBe('relicAtMax');
    expect((await db.player.findUniqueOrThrow({ where: { id } })).shards).toBe(99_999);
  });

  it('carries one, and refuses to carry one never forged', async () => {
    const id = await makePlayer('bearer', { keepLevel: RELIC_KEEP_LEVEL, shards: 500 });
    await forge(id, 'edge');
    expect((await carry(id, 0, 'edge')).statusCode).toBe(200);
    expect((await db.player.findUniqueOrThrow({ where: { id } })).carried).toEqual(['edge', null]);
    expect((await carry(id, 1, 'haste')).json().error).toBe('relicNotForged');
  });

  it('moves a relic between slots rather than duplicating it', async () => {
    const id = await makePlayer('mover', {
      keepLevel: RELIC_KEEP_LEVEL,
      relics: { edge: 2, bulwark: 2 }, carried: ['edge', 'bulwark'],
    });
    // "Carry Edge in slot 1" and "stop carrying it in slot 0" is one intention.
    expect((await carry(id, 1, 'edge')).statusCode).toBe(200);
    expect((await db.player.findUniqueOrThrow({ where: { id } })).carried)
      .toEqual(['bulwark', 'edge']);
  });

  it('empties a slot when asked to', async () => {
    const id = await makePlayer('barehand', {
      keepLevel: RELIC_KEEP_LEVEL, relics: { edge: 2 }, carried: ['edge', null],
    });
    expect((await carry(id, 0, null)).statusCode).toBe(200);
    expect((await db.player.findUniqueOrThrow({ where: { id } })).carried).toEqual([null, null]);
  });

  it('freezes what was carried onto the raid', async () => {
    const id = await makePlayer('raider', {
      keepLevel: RELIC_KEEP_LEVEL, gold: 9_000, iron: 9_000,
      relics: { edge: 3 }, carried: ['edge', null],
    });
    const cookie = await loginAs(app, id);
    const found = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie } })).json();
    expect(found.hero.relics).toEqual({ edge: 3 });
    expect(found.hero.carried).toEqual(['edge', null]);

    // Swapped after the raid opened. The raid's own hero must not move.
    await carry(id, 0, null);
    const raid = await db.raid.findFirstOrThrow({ where: { attackerId: id } });
    expect((raid.hero as { carried: unknown }).carried).toEqual(['edge', null]);
  });

  it('shows the pouch, the shards and the prices on /progression', async () => {
    const id = await makePlayer('shopper', { keepLevel: RELIC_KEEP_LEVEL, shards: 120 });
    const cookie = await loginAs(app, id);
    const view = (await app.inject({ method: 'GET', url: '/progression', headers: { cookie } })).json();
    expect(view.relics.unlocked).toBe(true);
    expect(view.relics.shards).toBe(120);
    expect(view.relics.list).toHaveLength(Object.keys(RELIC).length);
    for (const r of view.relics.list) {
      expect(r.level).toBe(0);
      expect(r.cost).toBe(RELIC_FORGE_COST);
      expect(typeof r.n).toBe('string');
    }
  });

  it('tells a Keep too low that it is too low, rather than hiding them', async () => {
    const id = await makePlayer('early', { keepLevel: RELIC_KEEP_LEVEL - 2 });
    const view = (await app.inject({
      method: 'GET', url: '/progression', headers: { cookie: await loginAs(app, id) },
    })).json();
    expect(view.relics.unlocked).toBe(false);
    expect(view.relics.keep).toBe(RELIC_KEEP_LEVEL);
  });
});
