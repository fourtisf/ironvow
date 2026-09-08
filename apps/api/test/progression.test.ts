import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  HERO_UNLOCK_KEEP_LEVEL, TROOP_ORDER, heroRespawnMinutes, heroUpgradeCost, troopUpgradeCost,
} from '@ironvow/config';
import type { FastifyInstance } from 'fastify';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Hero and War Lab, server-side.
 *
 * Both are persistent power, so the tests worth having are the gates: a hero
 * cannot outrank the Keep, a troop cannot outrank the Lab, and neither can be
 * raised by a client that simply asks twice.
 */

describe.skipIf(!hasDatabase)('progression', () => {
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

  it('locks the hero until the Keep can support it', async () => {
    const playerId = await makePlayer('Early', { keepLevel: 2, gold: 10_000_000, iron: 10_000_000 });
    const cookie = await loginAs(app, playerId);

    const res = await app.inject({ method: 'POST', url: '/hero/upgrade', headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('heroLocked');
    expect(HERO_UNLOCK_KEEP_LEVEL).toBe(3);
  });

  it('raises the hero once, charging the derived cost', async () => {
    const cost = heroUpgradeCost(1);
    const playerId = await makePlayer('Champion', { keepLevel: 4, gold: cost.g, iron: cost.i });
    const cookie = await loginAs(app, playerId);

    const res = await app.inject({ method: 'POST', url: '/hero/upgrade', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().toLevel).toBe(2);

    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(after.heroLevel).toBe(2);
    expect(after.gold).toBe(0n);
  });

  it('will not let the hero outrank the Keep', async () => {
    const playerId = await makePlayer('Overreach', { keepLevel: 3, gold: 10_000_000, iron: 10_000_000 });
    await db.player.update({ where: { id: playerId }, data: { heroLevel: 3 } });
    const cookie = await loginAs(app, playerId);

    const res = await app.inject({ method: 'POST', url: '/hero/upgrade', headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('heroAtKeepCap');
  });

  it('raises the hero exactly once under a burst', async () => {
    const playerId = await makePlayer('Masher', { keepLevel: 9, gold: 10_000_000, iron: 10_000_000 });
    const cookie = await loginAs(app, playerId);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => app.inject({ method: 'POST', url: '/hero/upgrade', headers: { cookie } })),
    );
    // Every request can afford it, so the guard that matters is the row lock
    // serialising them: each sees the level the one before it wrote.
    const levels = responses.filter((r) => r.statusCode === 200).map((r) => r.json().toLevel);
    expect(new Set(levels).size).toBe(levels.length);

    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(after.heroLevel).toBe(1 + levels.length);
  });

  it('refuses a troop upgrade with no War Lab', async () => {
    const playerId = await makePlayer('Unequipped', { keepLevel: 5, gold: 10_000_000, iron: 10_000_000 });
    const cookie = await loginAs(app, playerId);

    const res = await app.inject({
      method: 'POST', url: '/troop/upgrade', headers: { cookie }, payload: { type: 'raider' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('noLab');
  });

  it('caps a troop at the Lab’s level', async () => {
    const playerId = await makePlayer('Researcher', { keepLevel: 6, gold: 10_000_000, iron: 10_000_000 });
    await db.building.create({ data: { playerId, type: 'lab', gx: 10, gy: 10, level: 2 } });
    const cookie = await loginAs(app, playerId);

    const first = await app.inject({
      method: 'POST', url: '/troop/upgrade', headers: { cookie }, payload: { type: 'raider' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().toLevel).toBe(2);

    const second = await app.inject({
      method: 'POST', url: '/troop/upgrade', headers: { cookie }, payload: { type: 'raider' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('troopAtLabCap');
  });

  it('charges the cost derived from the troop’s own price', async () => {
    const cost = troopUpgradeCost('ram', 1);
    const playerId = await makePlayer('Smith', { keepLevel: 6, gold: cost.g, iron: cost.i });
    await db.building.create({ data: { playerId, type: 'lab', gx: 10, gy: 10, level: 4 } });
    const cookie = await loginAs(app, playerId);

    const res = await app.inject({
      method: 'POST', url: '/troop/upgrade', headers: { cookie }, payload: { type: 'ram' },
    });
    expect(res.statusCode).toBe(200);

    const after = await db.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(after.gold).toBe(0n);
    const ram = await db.troop.findFirstOrThrow({ where: { playerId, type: 'ram' } });
    expect(ram.level).toBe(2);
  });

  it('reports the hero and lab state the panels need', async () => {
    const playerId = await makePlayer('Reader', { keepLevel: 5 });
    await db.building.create({ data: { playerId, type: 'lab', gx: 10, gy: 10, level: 3 } });
    const cookie = await loginAs(app, playerId);

    const res = (await app.inject({ method: 'GET', url: '/progression', headers: { cookie } })).json();
    expect(res.hero.unlocked).toBe(true);
    expect(res.hero.stats.hp).toBeGreaterThan(0);
    expect(res.lab.level).toBe(3);
    expect(res.lab.troops).toHaveLength(TROOP_ORDER.length);
    expect(res.lab.troops.every((t: { level: number }) => t.level === 1)).toBe(true);
  });
});

describe.skipIf(!hasDatabase)('the hero in a raid', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    migrate();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(resetDatabase);

  async function armed(name: string, keepLevel: number, trophies: number) {
    const id = await makePlayer(name, { keepLevel, trophies, gold: 5000, iron: 5000 });
    await db.troop.updateMany({ where: { playerId: id, type: 'raider' }, data: { count: 10 } });
    return id;
  }

  it('freezes the hero and lab levels onto the raid when it opens', async () => {
    const attackerId = await armed('Hero', 6, 300);
    await db.player.update({ where: { id: attackerId }, data: { heroLevel: 4 } });
    await db.troop.updateMany({ where: { playerId: attackerId, type: 'raider' }, data: { level: 3 } });
    await makePlayer('Target', { trophies: 305, gold: 40_000, iron: 40_000 });
    const cookie = await loginAs(app, attackerId);

    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();
    // The relics ride along with the level now, and they are frozen for the
    // same reason: forging one mid-raid must not change the fight in flight.
    expect(scout.hero).toEqual({ level: 4, available: true, relics: {}, carried: [null, null] });
    expect(scout.troopLevels.raider).toBe(3);

    // Raising the hero mid-raid must not change what the raid may field.
    await db.player.update({ where: { id: attackerId }, data: { heroLevel: 9 } });
    const raid = await db.raid.findUniqueOrThrow({ where: { id: scout.raidId } });
    expect((raid.hero as { level: number }).level).toBe(4);
  });

  it('marks the hero unavailable while it is recovering', async () => {
    const attackerId = await armed('Wounded', 6, 200);
    await db.player.update({
      where: { id: attackerId },
      data: { heroReadyAt: new Date(Date.now() + 20 * 60_000) },
    });
    await makePlayer('Prey', { trophies: 205, gold: 20_000, iron: 20_000 });
    const cookie = await loginAs(app, attackerId);

    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();
    expect(scout.hero.available).toBe(false);

    // Deploying it anyway is refused by the server's own replay.
    const res = (await app.inject({
      method: 'POST', url: `/raid/${scout.raidId}/submit`, headers: { cookie },
      payload: { commands: [{ tickIndex: 0, troopType: 'hero', gx: 18, gy: 27 }] },
    })).json();
    expect(res.rejected).toEqual([{ index: 0, reason: 'heroUnavailable' }]);
    expect(res.heroDeployed).toBe(false);
  });

  it('sets a respawn timer when the hero falls, and does not touch the warband', async () => {
    const attackerId = await armed('Bold', 4, 100);
    // A defender bristling with maximum-level guns, so the hero cannot survive.
    const defenderId = await makePlayer('Fortress', { trophies: 105, keepLevel: 9, gold: 30_000, iron: 30_000 });
    await db.building.deleteMany({ where: { playerId: defenderId, type: { not: 'keep' } } });
    await db.building.updateMany({ where: { playerId: defenderId }, data: { level: 9 } });
    for (const [gx, gy] of [[22, 27], [32, 27], [27, 22], [27, 32], [22, 22], [32, 32]]) {
      await db.building.create({ data: { playerId: defenderId, type: 'cannon', gx, gy, level: 9 } });
    }
    const cookie = await loginAs(app, attackerId);

    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();
    expect(scout.hero.available).toBe(true);

    const res = (await app.inject({
      method: 'POST', url: `/raid/${scout.raidId}/submit`, headers: { cookie },
      payload: { commands: [{ tickIndex: 0, troopType: 'hero', gx: 27, gy: 18 }] },
    })).json();

    expect(res.heroDeployed).toBe(true);
    expect(res.heroDied).toBe(true);

    const after = await db.player.findUniqueOrThrow({ where: { id: attackerId } });
    expect(after.heroReadyAt).not.toBeNull();
    const minutes = (after.heroReadyAt!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(heroRespawnMinutes(1) - 2);

    // The hero is not a troop: the warband is untouched by committing it.
    const raider = await db.troop.findFirstOrThrow({ where: { playerId: attackerId, type: 'raider' } });
    expect(raider.count).toBe(10);
  });
});
