import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  WAR_ATTACKS, WAR_MAX_ROSTER, WAR_MIN_MEMBERS, WAR_REWARD_PER_STAR, WAR_WIN_MULTIPLIER,
  attackerStars, clanScore, rosterSize, warOutcome, warReward,
} from '@ironvow/config';
import type { BattleArmy, DeployCommand } from '@ironvow/types';
import type { FastifyInstance } from 'fastify';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Clan wars.
 *
 * The rules are pure and tested first. Then a whole war over the wire: two
 * clans declare, are matched, fight with frozen bases, and are settled by the
 * same code the worker runs — with the reward landing on the winners and the
 * defender of a war attack losing nothing.
 */

describe('war rules', () => {
  it('counts only the best result against each base', () => {
    const score = clanScore([
      { defenderMemberId: 'x', stars: 1, destroyedPct: 40 },
      { defenderMemberId: 'x', stars: 3, destroyedPct: 100 },
      { defenderMemberId: 'y', stars: 0, destroyedPct: 30 },
      { defenderMemberId: 'y', stars: 0, destroyedPct: 12 },
    ]);
    expect(score.stars).toBe(3);
    expect(score.pct).toBeCloseTo(130);
  });

  it('breaks a tie on stars by destruction, then calls it a draw', () => {
    expect(warOutcome(5, 200, 4, 300)).toBe('a');
    expect(warOutcome(4, 200, 5, 100)).toBe('b');
    expect(warOutcome(4, 210, 4, 200)).toBe('a');
    expect(warOutcome(4, 200, 4, 200)).toBe('draw');
  });

  it('fields equal rosters, set by the smaller clan', () => {
    expect(rosterSize(3, 9)).toBe(3);
    expect(rosterSize(30, 40)).toBe(WAR_MAX_ROSTER);
  });

  it('pays per star, scaled by the Keep, doubled for the winners', () => {
    expect(warReward(0, 5, true)).toEqual({ g: 0, i: 0 });
    expect(warReward(2, 3, false)).toEqual({ g: WAR_REWARD_PER_STAR.g * 6, i: WAR_REWARD_PER_STAR.i * 6 });
    expect(warReward(2, 3, true).g).toBe(WAR_REWARD_PER_STAR.g * 6 * WAR_WIN_MULTIPLIER);
    expect(attackerStars([
      { defenderMemberId: 'x', stars: 2, destroyedPct: 60 },
      { defenderMemberId: 'x', stars: 1, destroyedPct: 50 },
      { defenderMemberId: 'z', stars: 3, destroyedPct: 100 },
    ])).toBe(5);
  });
});

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

describe.skipIf(!hasDatabase)('a war over the wire', () => {
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

  /** A clan of `n` members, the first of whom leads. Every member is armed. */
  async function clan(name: string, n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      // Well under the storage cap, so a reward has room to land.
      const id = await makePlayer(`${name} ${i}`, { trophies: 100 + i * 10, gold: 300, iron: 100 });
      await db.troop.updateMany({ where: { playerId: id, type: 'raider' }, data: { count: 12 } });
      await db.troop.updateMany({ where: { playerId: id, type: 'archer' }, data: { count: 4 } });
      ids.push(id);
    }
    const c = await db.clan.create({
      data: {
        name, tag: name.slice(0, 4).toUpperCase(),
        members: { create: ids.map((playerId, i) => ({ playerId, role: i === 0 ? 'leader' : 'member' })) },
      },
      select: { id: true },
    });
    return { id: c.id, ids, leader: await loginAs(app, ids[0]!) };
  }

  const post = (url: string, cookie: string, payload: unknown = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie }, payload });
  const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  it('refuses a clan that is too small, and a member who is not an elder', async () => {
    const small = await clan('Small', WAR_MIN_MEMBERS - 1);
    expect((await post('/war/search', small.leader)).json().error).toBe('clanTooSmall');
    const big = await clan('Big', WAR_MIN_MEMBERS);
    const member = await loginAs(app, big.ids[1]!);
    expect((await post('/war/search', member)).json().error).toBe('notAllowed');
  });

  it('matches two searching clans, freezes both rosters, and scores only the server’s stars', async () => {
    const a = await clan('Ashen', 3);
    const b = await clan('Briar', 4);
    expect((await post('/war/search', a.leader)).statusCode).toBe(200);
    // Alone, so still searching.
    expect((await get('/war', a.leader)).json().war.state).toBe('search');
    expect((await post('/war/search', b.leader)).statusCode).toBe(200);

    const view = (await get('/war', a.leader)).json();
    expect(view.war.state).toBe('active');
    expect(view.war.size).toBe(3);
    expect(view.war.us.roster).toHaveLength(3);
    expect(view.war.them.roster).toHaveLength(3);
    expect(view.war.myAttacksLeft).toBe(WAR_ATTACKS);
    // The smaller clan sets the size; Briar's weakest member is left off.
    const briarNames = view.war.them.roster.map((m: { name: string }) => m.name);
    expect(briarNames).not.toContain('Briar 0');

    // Rebuilding after the war starts changes nothing about the frozen base.
    const target = view.war.them.roster[0];
    await db.building.deleteMany({ where: { playerId: target.playerId, type: 'mine' } });

    const opened = await post('/war/attack', a.leader, { memberId: target.memberId });
    expect(opened.statusCode).toBe(200);
    const scout = opened.json();
    expect(scout.war).toBe(true);
    expect(scout.snapshot.pool).toEqual({ g: 0, i: 0 });
    expect(scout.snapshot.buildings.some((x: { type: string }) => x.type === 'mine')).toBe(true);

    const defenderBefore = await db.player.findUnique({ where: { id: target.playerId }, select: { gold: true, trophies: true } });
    const attackerBefore = await db.player.findUnique({ where: { id: a.ids[0]! }, select: { gold: true, trophies: true } });

    const submitted = await post(`/raid/${scout.raidId}/submit`, a.leader, { commands: siege(scout.army), clientStars: 3 });
    expect(submitted.statusCode).toBe(200);
    const result = submitted.json();
    expect(result.war).toBe(true);
    expect(result.loot).toEqual({ g: 0, i: 0 });
    expect(result.trophyDelta).toBe(0);

    // Nobody paid and nobody moved on the ladder.
    const defenderAfter = await db.player.findUnique({ where: { id: target.playerId }, select: { gold: true, trophies: true, shieldUntil: true } });
    const attackerAfter = await db.player.findUnique({ where: { id: a.ids[0]! }, select: { gold: true, trophies: true } });
    expect(defenderAfter!.gold).toBe(defenderBefore!.gold);
    expect(defenderAfter!.trophies).toBe(defenderBefore!.trophies);
    expect(defenderAfter!.shieldUntil).toBeNull();
    expect(attackerAfter!.gold).toBe(attackerBefore!.gold);
    expect(attackerAfter!.trophies).toBe(attackerBefore!.trophies);

    // The war holds the server's stars, whatever the client claimed.
    const after = (await get('/war', a.leader)).json();
    expect(after.war.us.stars).toBe(result.stars);
    expect(after.war.myAttacksLeft).toBe(WAR_ATTACKS - 1);
    const hit = after.war.them.roster.find((m: { memberId: string }) => m.memberId === target.memberId);
    expect(hit.bestStars).toBe(result.stars);

    // A second attack on the same base with fewer stars does not lower it.
    const again = (await post('/war/attack', a.leader, { memberId: target.memberId })).json();
    await post(`/raid/${again.raidId}/submit`, a.leader, { commands: [] });
    const third = (await get('/war', a.leader)).json();
    expect(third.war.us.stars).toBe(result.stars);
    expect(third.war.myAttacksLeft).toBe(0);
    expect((await post('/war/attack', a.leader, { memberId: target.memberId })).json().error).toBe('noAttacksLeft');
  });

  it('settles when the clock runs out: record, reward, and a line in both rooms', async () => {
    const a = await clan('Crag', 3);
    const b = await clan('Dune', 3);
    await post('/war/search', a.leader);
    await post('/war/search', b.leader);
    const view = (await get('/war', a.leader)).json();
    const target = view.war.them.roster[0];
    const scout = (await post('/war/attack', a.leader, { memberId: target.memberId })).json();
    const result = (await post(`/raid/${scout.raidId}/submit`, a.leader, { commands: siege(scout.army) })).json();
    expect(result.stars).toBeGreaterThan(0);

    // Run the clock out and let the worker's code settle it.
    await db.clanWar.update({ where: { id: view.war.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    const before = await db.player.findUnique({ where: { id: a.ids[0]! }, select: { gold: true, keepLevel: true } });
    const { settleDueWars } = await import('../src/lib/war.js');
    expect(await settleDueWars(new Date())).toBe(1);
    expect(await settleDueWars(new Date())).toBe(0);

    const done = (await get('/war', a.leader)).json();
    expect(done.war.state).toBe('done');
    expect(done.war.result).toBe('won');
    expect(done.record).toEqual({ wins: 1, losses: 0, draws: 0 });
    expect((await get('/war', b.leader)).json().war.result).toBe('lost');

    const after = await db.player.findUnique({ where: { id: a.ids[0]! }, select: { gold: true } });
    const expected = warReward(result.stars, before!.keepLevel, true);
    expect(Number(after!.gold - before!.gold)).toBe(expected.g);

    const room = await db.clanMessage.findMany({ where: { clanId: b.id, kind: 'system' }, orderBy: { createdAt: 'desc' }, take: 1 });
    expect(room[0]!.body).toContain('won the war');
  });

  it('lets a clan challenge another, and the challenged side answer', async () => {
    const a = await clan('Ember', 3);
    const b = await clan('Frost', 3);
    const sent = await post('/war/challenge', a.leader, { clanId: b.id });
    expect(sent.statusCode).toBe(200);
    const bView = (await get('/war', b.leader)).json();
    expect(bView.incoming).toHaveLength(1);
    expect(bView.incoming[0].name).toBe('Ember');
    // A member cannot answer for the clan.
    const member = await loginAs(app, b.ids[2]!);
    expect((await post('/war/respond', member, { warId: sent.json().warId, accept: true })).json().error).toBe('notAllowed');
    expect((await post('/war/respond', b.leader, { warId: sent.json().warId, accept: true })).statusCode).toBe(200);
    expect((await get('/war', a.leader)).json().war.state).toBe('active');
    // While at war, nobody can declare again.
    expect((await post('/war/search', a.leader)).json().error).toBe('alreadyAtWar');
  });
});
