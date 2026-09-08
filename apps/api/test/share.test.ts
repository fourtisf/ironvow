import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { simulate } from '@ironvow/sim';
import type { BaseSnapshot, BattleArmy, DeployCommand } from '@ironvow/types';
import type { FastifyInstance } from 'fastify';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Replays anybody can watch.
 *
 * The point of the feature is the viewer who has no account, so the tests that
 * matter are the ones that send no cookie at all. The point of the token is
 * that having one link does not give you the next, so the other half is what a
 * stranger cannot reach.
 */

function siege(army: BattleArmy): DeployCommand[] {
  const ring: [number, number][] = [
    [18, 27], [20, 20], [27, 18], [35, 20], [38, 27], [35, 35], [27, 38], [20, 35],
  ];
  const out: DeployCommand[] = [];
  let i = 0;
  for (const t of ['ram', 'lancer', 'archer', 'raider'] as const) {
    for (let k = 0; k < army[t]; k++) {
      out.push({ tickIndex: i * 3, troopType: t, gx: ring[i % ring.length]![0], gy: ring[i % ring.length]![1] });
      i++;
    }
  }
  return out;
}

describe.skipIf(!hasDatabase)('a replay anybody can watch', () => {
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

  /** Fight a real raid to the end and hand back everything the tests need. */
  async function fought(): Promise<{
    raidId: string; attackerId: string; defenderId: string; cookie: string;
    snapshot: BaseSnapshot; army: BattleArmy; commands: DeployCommand[]; seed: number;
  }> {
    const attackerId = await makePlayer('Sword', { trophies: 200 });
    await db.troop.updateMany({ where: { playerId: attackerId, type: 'raider' }, data: { count: 12 } });
    await db.troop.updateMany({ where: { playerId: attackerId, type: 'archer' }, data: { count: 4 } });
    const defenderId = await makePlayer('Shield', { trophies: 210, gold: 40_000, iron: 20_000 });
    const cookie = await loginAs(app, attackerId);

    const scout = (await app.inject({
      method: 'POST', url: '/raid/find', headers: { cookie }, payload: {},
    })).json();
    const commands = siege(scout.army);
    const local = simulate({ snapshot: scout.snapshot, commands, army: scout.army, seed: scout.seed });
    const done = await app.inject({
      method: 'POST', url: `/raid/${scout.raidId}/submit`, headers: { cookie },
      payload: { commands, clientChecksum: local.checksum, clientStars: local.stars },
    });
    expect(done.statusCode).toBe(200);
    return {
      raidId: scout.raidId, attackerId, defenderId, cookie,
      snapshot: scout.snapshot, army: scout.army, commands, seed: scout.seed,
    };
  }

  it('is private until somebody shares it', async () => {
    const { raidId } = await fought();
    const raid = await db.raid.findUniqueOrThrow({ where: { id: raidId } });
    expect(raid.shareId).toBeNull();
    expect(raid.sharedAt).toBeNull();
  });

  it('opens to a viewer with no account at all', async () => {
    const f = await fought();
    const shared = await app.inject({
      method: 'POST', url: `/raid/${f.raidId}/share`, headers: { cookie: f.cookie },
    });
    expect(shared.statusCode).toBe(200);
    const { shareId } = shared.json();
    expect(shareId).toMatch(/^[A-Za-z0-9_-]{12}$/);

    // No cookie. This is the whole feature.
    const watched = await app.inject({ method: 'GET', url: `/share/${shareId}` });
    expect(watched.statusCode).toBe(200);
    const r = watched.json();
    expect(r.attacker).toBe('Sword');
    expect(r.defender).toBe('Shield');
    expect(r.commands).toHaveLength(f.commands.length);
  });

  it('hands a stranger a fight that still reproduces exactly', async () => {
    /*
     * The reason nothing in the payload may be trimmed or rounded. A watcher
     * runs the same simulation the server ran; if the public copy differs by so
     * much as one building the replay they watch is not the fight that happened.
     */
    const f = await fought();
    const { shareId } = (await app.inject({
      method: 'POST', url: `/raid/${f.raidId}/share`, headers: { cookie: f.cookie },
    })).json();

    const r = (await app.inject({ method: 'GET', url: `/share/${shareId}` })).json();
    const replay = simulate({
      snapshot: r.snapshot, commands: r.commands, army: r.army, seed: r.seed,
      hero: r.hero, troopLevels: r.troopLevels, pouch: r.pouch, items: r.items,
    });
    const stored = await db.raid.findUniqueOrThrow({ where: { id: f.raidId } });
    expect(replay.stars).toBe(stored.stars);
    expect(replay.destroyedPct).toBe(stored.destroyedPct);
    expect(replay.checksum).toBe(stored.checksum);
  });

  it('publishes no checksum and no defender id', async () => {
    const f = await fought();
    const { shareId } = (await app.inject({
      method: 'POST', url: `/raid/${f.raidId}/share`, headers: { cookie: f.cookie },
    })).json();
    const body = (await app.inject({ method: 'GET', url: `/share/${shareId}` })).body;
    const r = JSON.parse(body);

    // The number a forged client would have to reproduce. Never published.
    expect(r.checksum).toBeUndefined();
    expect(body).not.toContain(f.defenderId);
    expect(r.snapshot.defenderId).toBe('');
  });

  it('answers the card without the fight, for a link preview', async () => {
    const f = await fought();
    const { shareId } = (await app.inject({
      method: 'POST', url: `/raid/${f.raidId}/share`, headers: { cookie: f.cookie },
    })).json();

    const card = await app.inject({ method: 'GET', url: `/share/${shareId}/card` });
    expect(card.statusCode).toBe(200);
    const c = card.json();
    expect(c).toMatchObject({ shareId, attacker: 'Sword', defender: 'Shield' });
    expect(typeof c.stars).toBe('number');
    // Small enough to put in a <head>.
    expect(c.snapshot).toBeUndefined();
    expect(c.commands).toBeUndefined();
  });

  it('does not let one link be walked to another fight', async () => {
    const f = await fought();
    const { shareId } = (await app.inject({
      method: 'POST', url: `/raid/${f.raidId}/share`, headers: { cookie: f.cookie },
    })).json();

    // The raid id is not the token, and neither opens the other.
    expect(shareId).not.toBe(f.raidId);
    expect((await app.inject({ method: 'GET', url: `/share/${f.raidId}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/share/aaaaaaaaaaaa' })).statusCode).toBe(404);
    // And the private route still refuses a stranger.
    expect((await app.inject({ method: 'GET', url: `/raid/${f.raidId}/replay` })).statusCode).toBe(401);
  });

  it('lets the defender share too, and either of them take it back', async () => {
    const f = await fought();
    const theirs = await loginAs(app, f.defenderId);

    const shared = await app.inject({
      method: 'POST', url: `/raid/${f.raidId}/share`, headers: { cookie: theirs },
    });
    expect(shared.statusCode).toBe(200);
    const { shareId } = shared.json();
    expect((await app.inject({ method: 'GET', url: `/share/${shareId}` })).statusCode).toBe(200);

    const pulled = await app.inject({
      method: 'DELETE', url: `/raid/${f.raidId}/share`, headers: { cookie: f.cookie },
    });
    expect(pulled.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/share/${shareId}` })).statusCode).toBe(404);
  });

  it('gives back the same link when a withdrawn replay is shared again', async () => {
    /*
     * A link that has already been posted somewhere should start working again
     * rather than stay dead, so the token survives a withdrawal.
     */
    const f = await fought();
    const first = (await app.inject({
      method: 'POST', url: `/raid/${f.raidId}/share`, headers: { cookie: f.cookie },
    })).json().shareId;
    await app.inject({ method: 'DELETE', url: `/raid/${f.raidId}/share`, headers: { cookie: f.cookie } });
    const again = (await app.inject({
      method: 'POST', url: `/raid/${f.raidId}/share`, headers: { cookie: f.cookie },
    })).json().shareId;

    expect(again).toBe(first);
    expect((await app.inject({ method: 'GET', url: `/share/${first}` })).statusCode).toBe(200);
  });

  it('refuses to let somebody share a fight they were not in', async () => {
    const f = await fought();
    const nosy = await loginAs(app, await makePlayer('Nosy'));
    const refused = await app.inject({
      method: 'POST', url: `/raid/${f.raidId}/share`, headers: { cookie: nosy },
    });
    expect(refused.statusCode).toBe(403);
    expect((await db.raid.findUniqueOrThrow({ where: { id: f.raidId } })).sharedAt).toBeNull();

    expect((await app.inject({
      method: 'DELETE', url: `/raid/${f.raidId}/share`, headers: { cookie: nosy },
    })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/raid/${f.raidId}/share` })).statusCode).toBe(401);
  });

  it('refuses to share a raid that has not been fought yet', async () => {
    const attackerId = await makePlayer('Early', { trophies: 200 });
    await db.troop.updateMany({ where: { playerId: attackerId, type: 'raider' }, data: { count: 8 } });
    await makePlayer('Target', { trophies: 205, gold: 9_000 });
    const cookie = await loginAs(app, attackerId);
    const scout = (await app.inject({
      method: 'POST', url: '/raid/find', headers: { cookie }, payload: {},
    })).json();

    const early = await app.inject({
      method: 'POST', url: `/raid/${scout.raidId}/share`, headers: { cookie },
    });
    expect(early.statusCode).toBe(409);
  });

  it('tells the owner whether their replay is shared', async () => {
    const f = await fought();
    const before = await app.inject({
      method: 'GET', url: `/raid/${f.raidId}/replay`, headers: { cookie: f.cookie },
    });
    expect(before.json().shareId).toBeNull();

    const { shareId } = (await app.inject({
      method: 'POST', url: `/raid/${f.raidId}/share`, headers: { cookie: f.cookie },
    })).json();
    const after = await app.inject({
      method: 'GET', url: `/raid/${f.raidId}/replay`, headers: { cookie: f.cookie },
    });
    expect(after.json().shareId).toBe(shareId);

    await app.inject({ method: 'DELETE', url: `/raid/${f.raidId}/share`, headers: { cookie: f.cookie } });
    const pulled = await app.inject({
      method: 'GET', url: `/raid/${f.raidId}/replay`, headers: { cookie: f.cookie },
    });
    expect(pulled.json().shareId).toBeNull();
  });
});
