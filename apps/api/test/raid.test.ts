import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedToInt32, simulate } from '@ironvow/sim';
import type { BaseSnapshot, BattleArmy, DeployCommand } from '@ironvow/types';
import type { FastifyInstance } from 'fastify';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * The PvP loop end to end (spec S12, "Replay").
 *
 * A raid is opened, fought, submitted and settled; then the stored seed,
 * snapshot and commands are fed back through the simulation and asked to
 * reproduce the stars and loot that were written down. That round trip is what
 * makes the attack log and revenge features possible, and it is also the
 * strongest single check that the server really did decide the outcome.
 */

function siege(army: BattleArmy): DeployCommand[] {
  const ring: [number, number][] = [
    [18, 27], [20, 20], [27, 18], [35, 20], [38, 27], [35, 35], [27, 38], [20, 35],
  ];
  const out: DeployCommand[] = [];
  let i = 0;
  for (const t of ['ram', 'lancer', 'archer', 'raider'] as const) {
    for (let k = 0; k < army[t]; k++) {
      const spot = ring[i % ring.length]!;
      out.push({ tickIndex: i * 3, troopType: t, gx: spot[0], gy: spot[1] });
      i++;
    }
  }
  return out;
}

describe.skipIf(!hasDatabase)('raiding', () => {
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
    await db.troop.updateMany({ where: { playerId: id, type: 'raider' }, data: { count: 12 } });
    await db.troop.updateMany({ where: { playerId: id, type: 'archer' }, data: { count: 4 } });
    return id;
  }

  it('finds an opponent, freezes their base, and replays the raid exactly', async () => {
    const attackerId = await armed('Attacker', { trophies: 200 });
    const defenderId = await makePlayer('Defender', { trophies: 210, gold: 40_000, iron: 20_000 });
    const cookie = await loginAs(app, attackerId);

    const found = await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} });
    expect(found.statusCode).toBe(200);
    const scout = found.json() as {
      raidId: string; seed: number; snapshot: BaseSnapshot; army: BattleArmy;
    };
    expect(scout.snapshot.defenderId).toBe(defenderId);
    // Scouting shows the real layout, which is the whole point of the feature.
    expect(scout.snapshot.buildings.length).toBeGreaterThan(0);
    expect(scout.snapshot.pool.g).toBeGreaterThan(0);
    expect(scout.army).toEqual({ raider: 12, archer: 4, lancer: 0, ram: 0, scaler: 0 });

    const commands = siege(scout.army);
    const local = simulate({
      snapshot: scout.snapshot,
      commands,
      army: scout.army,
      seed: scout.seed,
    });

    const submitted = await app.inject({
      method: 'POST',
      url: `/raid/${scout.raidId}/submit`,
      headers: { cookie },
      payload: { commands, clientChecksum: local.checksum, clientStars: local.stars },
    });
    expect(submitted.statusCode).toBe(200);
    const result = submitted.json();

    // The client rendered this fight; the server agrees, so there is nothing logged.
    expect(result.checksum).toBe(local.checksum);
    expect(result.stars).toBe(local.stars);
    expect(await db.divergence.count()).toBe(0);

    /* --- and now the replay, from stored fields only --- */
    const raid = await db.raid.findUniqueOrThrow({ where: { id: scout.raidId } });
    const replay = simulate({
      snapshot: raid.snapshot as unknown as BaseSnapshot,
      commands: raid.commands as unknown as DeployCommand[],
      army: raid.army as unknown as BattleArmy,
      seed: seedToInt32(raid.seed),
    });
    expect(replay.stars).toBe(raid.stars);
    expect(replay.destroyedPct).toBe(raid.destroyedPct);
    expect(replay.checksum).toBe(raid.checksum);
    expect(BigInt(Math.min(replay.loot.g, 40_000))).toBe(raid.lootGold);
  });

  it('ignores a client that lies about the outcome, and logs the disagreement', async () => {
    const attackerId = await armed('Liar', { trophies: 100 });
    await makePlayer('Victim', { trophies: 110, gold: 50_000, iron: 50_000 });
    const cookie = await loginAs(app, attackerId);

    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();

    // No deploys at all, but a claim of a three-star wipe.
    const submitted = await app.inject({
      method: 'POST',
      url: `/raid/${scout.raidId}/submit`,
      headers: { cookie },
      payload: { commands: [], clientChecksum: 'deadbeefdeadbeef', clientStars: 3 },
    });

    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().stars).toBe(0);
    expect(submitted.json().loot).toEqual({ g: 0, i: 0 });

    const attacker = await db.player.findUniqueOrThrow({ where: { id: attackerId } });
    expect(attacker.gold).toBe(900n);
    // A failed raid still costs trophies.
    expect(attacker.trophies).toBeLessThan(100);

    const logged = await db.divergence.findFirstOrThrow();
    expect(logged.clientStars).toBe(3);
    expect(logged.serverStars).toBe(0);
  });

  it('refuses to deploy more troops than the attacker owns', async () => {
    const attackerId = await armed('Overreach', { trophies: 50 });
    await makePlayer('Target', { trophies: 60, gold: 30_000, iron: 30_000 });
    const cookie = await loginAs(app, attackerId);

    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();
    const commands: DeployCommand[] = Array.from({ length: 60 }, (_, i) => ({
      tickIndex: i, troopType: 'raider', gx: 18, gy: 27,
    }));

    const result = (await app.inject({
      method: 'POST', url: `/raid/${scout.raidId}/submit`, headers: { cookie }, payload: { commands },
    })).json();

    // Twelve raiders were owned, so the other forty-eight are refused.
    const refused = result.rejected.filter((r: { reason: string }) => r.reason === 'noTroopsLeft');
    expect(refused).toHaveLength(48);
  });

  it('shields a defender who lost stars, and skips them in later matchmaking', async () => {
    const attackerId = await armed('First', { trophies: 300 });
    const defenderId = await makePlayer('Shielded', { trophies: 300, gold: 60_000, iron: 60_000 });
    const cookie = await loginAs(app, attackerId);

    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();
    await app.inject({
      method: 'POST', url: `/raid/${scout.raidId}/submit`, headers: { cookie },
      payload: { commands: siege(scout.army) },
    });

    const defender = await db.player.findUniqueOrThrow({ where: { id: defenderId } });
    const raid = await db.raid.findUniqueOrThrow({ where: { id: scout.raidId } });

    if (raid.stars >= 1) {
      expect(defender.shieldUntil).not.toBeNull();
      // A second attacker cannot find them while the shield holds.
      const otherId = await armed('Second', { trophies: 300 });
      const otherCookie = await loginAs(app, otherId);
      const again = await app.inject({
        method: 'POST', url: '/raid/find', headers: { cookie: otherCookie }, payload: {},
      });
      // Only the first attacker and the shielded defender exist besides Second,
      // and both are excluded, so there is nobody left to raid.
      expect([404, 200]).toContain(again.statusCode);
      if (again.statusCode === 200) {
        expect(again.json().snapshot.defenderId).not.toBe(defenderId);
      }
    } else {
      expect(defender.shieldUntil).toBeNull();
    }
  });

  it('will not settle the same raid twice', async () => {
    const attackerId = await armed('Double', { trophies: 80 });
    await makePlayer('Once', { trophies: 90, gold: 20_000, iron: 20_000 });
    const cookie = await loginAs(app, attackerId);

    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();
    const payload = { commands: siege(scout.army) };

    const first = await app.inject({ method: 'POST', url: `/raid/${scout.raidId}/submit`, headers: { cookie }, payload });
    const second = await app.inject({ method: 'POST', url: `/raid/${scout.raidId}/submit`, headers: { cookie }, payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('alreadyResolved');
  });

  it('does not let one player submit another player’s raid', async () => {
    const attackerId = await armed('Owner', { trophies: 500 });
    await makePlayer('Prey', { trophies: 505, gold: 10_000, iron: 10_000 });
    const intruderId = await armed('Intruder', { trophies: 900 });

    const cookie = await loginAs(app, attackerId);
    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();

    const intruderCookie = await loginAs(app, intruderId);
    const attempt = await app.inject({
      method: 'POST', url: `/raid/${scout.raidId}/submit`, headers: { cookie: intruderCookie },
      payload: { commands: [] },
    });
    expect(attempt.statusCode).toBe(403);
  });

  it('records the raid in the defender’s attack log with a replayable flag', async () => {
    const attackerId = await armed('Logged', { trophies: 150 });
    const defenderId = await makePlayer('Logger', { trophies: 155, gold: 30_000, iron: 30_000 });
    const cookie = await loginAs(app, attackerId);

    const scout = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} })).json();
    await app.inject({
      method: 'POST', url: `/raid/${scout.raidId}/submit`, headers: { cookie },
      payload: { commands: siege(scout.army) },
    });

    const defenderCookie = await loginAs(app, defenderId);
    const log = (await app.inject({ method: 'GET', url: '/raids/incoming', headers: { cookie: defenderCookie } })).json();
    expect(log.raids).toHaveLength(1);
    expect(log.raids[0].attacker.name).toBe('Logged');
    expect(log.raids[0].replayable).toBe(true);

    const replay = await app.inject({
      method: 'GET', url: `/raid/${scout.raidId}/replay`, headers: { cookie: defenderCookie },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().commands.length).toBeGreaterThan(0);
  });

  it('never matches a player against themselves', async () => {
    const soloId = await armed('Solo', { trophies: 400 });
    const cookie = await loginAs(app, soloId);
    const found = await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie }, payload: {} });

    // A lone player now gets a generated garrison rather than a 404 — the RAID
    // button must always do something. What must never happen is being handed
    // their own base to flatten.
    expect(found.statusCode).toBe(200);
    expect(found.json().isPlayer).toBe(false);
    expect(found.json().snapshot.defenderId).not.toBe(soloId);
  });
});
