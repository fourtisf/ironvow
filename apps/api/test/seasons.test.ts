import {
  SEASON_MIN_TROPHIES,
  SEASON_RESET_FLOOR,
  SEASON_TIERS,
  seasonEnd,
  seasonReset,
  seasonReward,
  tierAt,
} from '@ironvow/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeDueSeasons, currentSeason, peakAfter } from '../src/lib/seasons.js';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Seasons.
 *
 * The property worth more than all the others: a season is paid **exactly
 * once**. Paying it twice is silent, it is a faucet, and by the time anybody
 * has noticed the gold is spent. Most of what is below is that one property
 * approached from different directions.
 */

let app: Awaited<ReturnType<typeof buildApp>>;

/** Move the open season's clock into the past so a close is due. */
async function expire(): Promise<void> {
  const s = await currentSeason();
  await db.season.update({
    where: { id: s.id },
    data: { endsAt: new Date(Date.now() - 60_000) },
  });
}

describe.skipIf(!hasDatabase)('seasons', () => {
  beforeAll(async () => {
    migrate();
    app = await buildApp();
    await app.ready();
  });
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await app.close(); await db.$disconnect(); });

  it('opens the first season on demand, and only one of it', async () => {
    const [a, b, c] = await Promise.all([currentSeason(), currentSeason(), currentSeason()]);
    expect(a.index).toBe(1);
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect(await db.season.count()).toBe(1);
  });

  it('pays the ladder by peak, ranks it, and writes one receipt each', async () => {
    const top = await makePlayer('top', { seasonPeak: 2_100, trophies: 2_100, gold: 0, iron: 0 });
    const mid = await makePlayer('mid', { seasonPeak: 950, trophies: 950, gold: 0, iron: 0 });
    const low = await makePlayer('low', { seasonPeak: 40, trophies: 40, gold: 0, iron: 0 });
    await expire();

    const [closed] = await closeDueSeasons();
    expect(closed?.paid).toBe(2);

    const rows = await db.seasonResult.findMany({ orderBy: { rank: 'asc' } });
    expect(rows.map((r) => r.playerId)).toEqual([top, mid]);
    expect(rows.map((r) => r.tier)).toEqual(['gold', 'bronze']);
    expect(rows[0]!.gold).toBe(seasonReward(2_100).g);
    // Below the first tier is paid nothing and gets no receipt: a reward every
    // account collects for existing is a faucet, not a prize.
    expect(rows.some((r) => r.playerId === low)).toBe(false);
  });

  it('actually credits the purse, not only the receipt', async () => {
    const id = await makePlayer('rich', { seasonPeak: 600, trophies: 600, gold: 0, iron: 0, keepLevel: 10 });
    await expire();
    await closeDueSeasons();
    const p = await db.player.findUniqueOrThrow({ where: { id } });
    expect(Number(p.gold)).toBeGreaterThan(0);
    expect(Number(p.gold)).toBeLessThanOrEqual(seasonReward(600).g);
  });

  it('resets every hold, not only the paid ones, and restarts the peak there', async () => {
    const high = await makePlayer('high', { trophies: 1_000, seasonPeak: 1_000 });
    const under = await makePlayer('under', { trophies: 80, seasonPeak: 80 });
    await expire();
    await closeDueSeasons();

    const a = await db.player.findUniqueOrThrow({ where: { id: high } });
    const b = await db.player.findUniqueOrThrow({ where: { id: under } });
    expect(a.trophies).toBe(seasonReset(1_000));
    expect(a.trophies).toBe(SEASON_RESET_FLOOR + 400);
    expect(b.trophies).toBe(80);
    // The next season starts from where the reset left them, not from zero, or
    // the first raid of a season would be worth a tier.
    expect(a.seasonPeak).toBe(a.trophies);
    expect(b.seasonPeak).toBe(b.trophies);
  });

  it('pays once, even when two workers close the same season at the same moment', async () => {
    const id = await makePlayer('one', { seasonPeak: 3_000, trophies: 3_000, gold: 0, iron: 0, keepLevel: 10 });
    await expire();

    const runs = await Promise.all([closeDueSeasons(), closeDueSeasons(), closeDueSeasons()]);
    expect(runs.filter((r) => r.length === 1)).toHaveLength(1);
    expect(await db.seasonResult.count({ where: { playerId: id } })).toBe(1);
  });

  it('is a no-op while the clock is still running', async () => {
    await makePlayer('waiting', { seasonPeak: 3_000, trophies: 3_000 });
    expect(await closeDueSeasons()).toEqual([]);
    expect(await db.seasonResult.count()).toBe(0);
  });

  it('opens the next season from the last one\'s scheduled end, not from now', async () => {
    const first = await currentSeason();
    const endsAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await db.season.update({ where: { id: first.id }, data: { endsAt } });
    await closeDueSeasons();

    const next = await db.season.findFirstOrThrow({ where: { closedAt: null } });
    expect(next.index).toBe(2);
    // Three hours late to notice is still the same schedule. Otherwise every
    // worker outage walks all future seasons forward, permanently.
    expect(next.startedAt.getTime()).toBe(endsAt.getTime());
    expect(next.endsAt.getTime()).toBe(seasonEnd(endsAt).getTime());
  });

  it('reports the standing, the countdown and the last receipt', async () => {
    const me = await makePlayer('me', { trophies: 620, seasonPeak: 620 });
    await makePlayer('ahead', { trophies: 3_000, seasonPeak: 3_000 });
    const cookie = await loginAs(app, me);

    const res = await app.inject({ method: 'GET', url: '/season', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.index).toBe(1);
    expect(body.rank).toBe(2);
    expect(body.peak).toBe(620);
    expect(body.tier.id).toBe(tierAt(620)!.id);
    expect(body.next.at).toBeGreaterThan(620);
    expect(body.msLeft).toBeGreaterThan(0);
    expect(body.contenders).toBe(2);
    expect(body.last).toBeNull();

    await expire();
    await closeDueSeasons();
    const after = (await app.inject({ method: 'GET', url: '/season', headers: { cookie } })).json();
    expect(after.index).toBe(2);
    expect(after.last.index).toBe(1);
    expect(after.last.rank).toBe(2);
    expect(after.last.trophies).toBe(620);
  });

  it('moves the peak on a won raid and leaves it alone on a lost one', () => {
    // The watermark, in isolation from the raid route that calls it.
    expect(peakAfter(300, 340)).toBe(340);
    expect(peakAfter(340, 300)).toBe(340);
    expect(peakAfter(0, 0)).toBe(0);
  });

  it('agrees with the config about where every tier boundary sits', async () => {
    // The reset is a raw UPDATE for speed; this pins it against the pure
    // function the client uses to preview it, at every boundary that exists.
    for (const t of SEASON_TIERS) {
      const id = await makePlayer(`t${t.id}`, { trophies: t.at, seasonPeak: t.at, gold: 0, iron: 0 });
      await expire();
      await closeDueSeasons();
      const p = await db.player.findUniqueOrThrow({ where: { id } });
      expect(p.trophies).toBe(seasonReset(t.at));
      const receipt = await db.seasonResult.findFirstOrThrow({ where: { playerId: id } });
      expect(receipt.tier).toBe(t.id);
      expect(receipt.gold).toBe(t.reward.g);
      await resetDatabase();
    }
    expect(tierAt(SEASON_MIN_TROPHIES - 1)).toBeNull();
  });
});
