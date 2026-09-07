import { TROOP, donationReward, garrisonSlots, garrisonUsed, parseGarrison } from '@ironvow/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { placeGarrison, snapshotBase } from '../src/domain/raid.js';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * The garrison.
 *
 * A clan without donation is a chat room between wars. These pin the three
 * rules that make it worth having: what is given comes out of the giver's own
 * warband, it stands in the receiver's hold and fights for them, and it is
 * spent doing it — because a garrison that survives is one nobody ever asks
 * for again, and the asking is the point.
 */

let app: Awaited<ReturnType<typeof buildApp>>;

async function clanOf(leader: string, ...members: string[]): Promise<string> {
  const clan = await db.clan.create({
    data: { name: `Clan ${Math.random().toString(36).slice(2, 8)}`, tag: Math.random().toString(36).slice(2, 6) },
  });
  await db.clanMember.create({ data: { clanId: clan.id, playerId: leader, role: 'leader' } });
  for (const m of members) {
    await db.clanMember.create({ data: { clanId: clan.id, playerId: m, role: 'member' } });
  }
  return clan.id;
}

describe.skipIf(!hasDatabase)('clan donation', () => {
  beforeAll(async () => {
    migrate();
    app = await buildApp();
    await app.ready();
  });
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await app.close(); await db.$disconnect(); });

  const give = async (from: string, to: string, type: string, count: number) => app.inject({
    method: 'POST', url: '/clan/donate', headers: { cookie: await loginAs(app, from) },
    payload: { playerId: to, type, count },
  });

  it('moves troops out of the giver and into the receiver, and pays for it', async () => {
    const giver = await makePlayer('giver');
    const taker = await makePlayer('taker');
    await clanOf(giver, taker);
    await db.troop.update({
      where: { playerId_type: { playerId: giver, type: 'raider' } }, data: { count: 5 },
    });
    const before = await db.player.findUniqueOrThrow({ where: { id: giver } });

    const res = await give(giver, taker, 'raider', 3);
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(3);

    const mine = await db.troop.findUniqueOrThrow({
      where: { playerId_type: { playerId: giver, type: 'raider' } },
    });
    expect(mine.count).toBe(2);
    const theirs = await db.player.findUniqueOrThrow({ where: { id: taker } });
    expect(parseGarrison(theirs.garrison).raider).toBe(3);

    // Giving is never worse than keeping: the reward covers the training cost.
    const paid = await db.player.findUniqueOrThrow({ where: { id: giver } });
    expect(Number(paid.gold - before.gold)).toBe(donationReward('raider', 3));
    expect(donationReward('raider', 3)).toBeGreaterThan(TROOP.raider.cost.g * 3);
  });

  it('refuses anyone outside your own clan, and yourself', async () => {
    const a = await makePlayer('a');
    const b = await makePlayer('b');
    await clanOf(a);
    await db.troop.update({
      where: { playerId_type: { playerId: a, type: 'raider' } }, data: { count: 5 },
    });
    expect((await give(a, b, 'raider', 1)).statusCode).toBe(409);
    // A hold that can garrison itself is a hold with a second warband.
    expect((await give(a, a, 'raider', 1)).statusCode).toBe(409);
  });

  it('refuses what the giver does not have', async () => {
    const giver = await makePlayer('giver');
    const taker = await makePlayer('taker');
    await clanOf(giver, taker);
    expect((await give(giver, taker, 'raider', 1)).statusCode).toBe(409);
  });

  it('clamps to the room there is rather than failing on arithmetic', async () => {
    const giver = await makePlayer('giver');
    const taker = await makePlayer('taker');
    await clanOf(giver, taker);
    await db.troop.update({
      where: { playerId_type: { playerId: giver, type: 'raider' } }, data: { count: 20 },
    });
    // A Keep-1 garrison holds ten slots; a Raider is one each.
    const cap = garrisonSlots(1);
    const res = await give(giver, taker, 'raider', 20);
    expect(res.json().count).toBe(cap);
    const theirs = await db.player.findUniqueOrThrow({ where: { id: taker } });
    expect(garrisonUsed(parseGarrison(theirs.garrison))).toBe(cap);

    // And once it is full, it is full.
    expect((await give(giver, taker, 'raider', 1)).statusCode).toBe(409);
  });
});

describe('a garrison stands where the snapshot says it stands', () => {
  const buildings = [
    { id: 'k', type: 'keep' as const, gx: 26, gy: 26, level: 3 },
    { id: 'm', type: 'mine' as const, gx: 22, gy: 26, level: 2 },
  ];

  it('places every troop, around the Keep, and identically for one seed', () => {
    const a = placeGarrison({ raider: 3, archer: 2 }, buildings, 99);
    const b = placeGarrison({ raider: 3, archer: 2 }, buildings, 99);
    expect(a).toHaveLength(5);
    expect(a).toEqual(b);
    for (const u of a) {
      const d = Math.hypot(u.x - 27.5, u.y - 27.5);
      expect(d).toBeGreaterThan(2);
      expect(d).toBeLessThan(6);
    }
  });

  it('rides into the snapshot only when there is one', () => {
    const bare = snapshotBase({
      id: 'd', name: 'D', keepLevel: 3, gold: 0n, iron: 0n, buildings,
    });
    expect(bare.garrison).toBeUndefined();

    const held = snapshotBase({
      id: 'd', name: 'D', keepLevel: 3, gold: 0n, iron: 0n, buildings,
      garrison: { lancer: 2 }, seed: 7,
    });
    expect(held.garrison).toHaveLength(2);
  });
});
