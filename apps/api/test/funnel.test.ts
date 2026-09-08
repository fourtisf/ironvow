import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { dayIndexOf } from '@ironvow/config';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';
import { dayKeyOf, funnel } from '../src/lib/count.js';

/**
 * The funnel.
 *
 * The reason it exists is the pair of numbers either side of the access code:
 * without them a launch where nobody wanted the game and a launch where nobody
 * could get in produce exactly the same graph. Everything after the gate is
 * read from columns the game already keeps, so the tests below are as much
 * about those readings being the right ones as about the counters.
 */

const OPS = 'a-test-ops-token-of-sufficient-length';

/**
 * `bump` is deliberately never awaited by a request handler — a counter that
 * can 500 the door is worse than a counter that misses a tick — so a test that
 * reads straight after a request races the write. Wait for the row instead of
 * sleeping a guessed number of milliseconds.
 */
async function counted(name: string, want: number): Promise<number> {
  for (let i = 0; i < 200; i++) {
    const row = await db.counter.findFirst({ where: { name, day: dayKeyOf() } });
    if ((row?.count ?? 0) >= want) return row?.count ?? 0;
    await new Promise((r) => setTimeout(r, 10));
  }
  const row = await db.counter.findFirst({ where: { name, day: dayKeyOf() } });
  return row?.count ?? 0;
}

describe.skipIf(!hasDatabase)('the launch funnel', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ACCESS_CODE = '1010';
    process.env.OPS_TOKEN = OPS;
    migrate();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    delete process.env.OPS_TOKEN;
    await app?.close();
    await db.$disconnect();
  });

  beforeEach(resetDatabase);

  const read = (query = ''): Promise<any> =>
    app
      .inject({ method: 'GET', url: `/ops/funnel${query}`, headers: { authorization: `Bearer ${OPS}` } })
      .then((r) => ({ statusCode: r.statusCode, body: r.json() }));

  it('is not readable without the ops token', async () => {
    expect((await app.inject({ method: 'GET', url: '/ops/funnel' })).statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'GET',
      url: '/ops/funnel',
      headers: { authorization: 'Bearer not-the-token-but-long-enough' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('counts the door, and both answers the access code can give', async () => {
    await app.inject({ method: 'GET', url: '/auth/gate' });
    await app.inject({ method: 'GET', url: '/auth/gate' });
    await app.inject({ method: 'POST', url: '/auth/gate', payload: { accessCode: '9999' } });
    await app.inject({ method: 'POST', url: '/auth/gate', payload: { accessCode: '1010' } });

    expect(await counted('door', 2)).toBe(2);
    expect(await counted('door_new', 2)).toBe(2);
    expect(await counted('gate_fail', 1)).toBe(1);
    expect(await counted('gate_ok', 1)).toBe(1);

    const { statusCode, body } = await read();
    expect(statusCode).toBe(200);
    expect(body.totals).toMatchObject({ door: 2, doorNew: 2, gateOk: 1, gateFail: 1 });

    const today = body.rows.find((r: { day: string }) => r.day === dayKeyOf());
    expect(today).toMatchObject({ door: 2, doorNew: 2, gateOk: 1, gateFail: 1 });
  });

  it('does not count a player who is already playing as an arrival', async () => {
    const cookie = await loginAs(app, await makePlayer('already'));
    await app.inject({ method: 'GET', url: '/auth/gate', headers: { cookie } });
    await app.inject({ method: 'GET', url: '/auth/gate' });
    await app.inject({ method: 'GET', url: '/auth/gate' });

    /*
     * Waiting for the second arrival is what makes this deterministic: the
     * writes are not awaited by the handler, so reading for an absence would
     * pass simply by being early. By the time two arrivals have landed, a
     * third from the session would have landed too.
     */
    expect(await counted('door_new', 2)).toBe(2);
    expect(await counted('door', 3)).toBe(3);
  });

  it('never echoes the access code, however wrong the guess', async () => {
    await app.inject({ method: 'POST', url: '/auth/gate', payload: { accessCode: '1010' } });
    await counted('gate_ok', 1);
    const { body } = await read();
    expect(JSON.stringify(body)).not.toContain('1010');
  });

  it('counts milestones against the day the player signed up, not today', async () => {
    const old = new Date(Date.now() - 3 * 86_400_000);
    const id = await makePlayer('threedays');
    // A raid three days ago, won: the row belongs to that day's cohort even
    // though the reading happens now.
    await db.player.update({
      where: { id },
      data: { createdAt: old, collected: 5, raids: 2, wins: 1, dayKey: dayIndexOf(old), streakDays: 1 },
    });

    const rows = await funnel();
    const theirs = rows.find((r) => r.day === dayKeyOf(old));
    expect(theirs).toMatchObject({ signups: 1, built: 1, raided: 1, won: 1, returned: 0 });

    const todays = rows.find((r) => r.day === dayKeyOf());
    expect(todays?.signups ?? 0).toBe(0);
  });

  it('counts a milestone only for the players who reached it', async () => {
    const looked = await makePlayer('looked');
    const built = await makePlayer('built');
    const raided = await makePlayer('raided');
    await db.player.update({ where: { id: looked }, data: { dayKey: dayIndexOf(new Date()), streakDays: 1 } });
    await db.player.update({ where: { id: built }, data: { collected: 1, dayKey: dayIndexOf(new Date()), streakDays: 1 } });
    await db.player.update({
      where: { id: raided },
      data: { collected: 4, raids: 3, dayKey: dayIndexOf(new Date()), streakDays: 1 },
    });

    const today = (await funnel()).find((r) => r.day === dayKeyOf());
    expect(today).toMatchObject({ signups: 3, built: 2, raided: 1, won: 0 });
  });

  it('calls a player returned once they have played a second day, streak or not', async () => {
    const old = new Date(Date.now() - 5 * 86_400_000);

    /*
     * Came back after a gap. A missed day resets `streakDays` to one, so the
     * streak says nothing about them and only the day they last played does —
     * this is the player a live-streak-only reading would lose.
     */
    const lapsed = await makePlayer('lapsed');
    await db.player.update({
      where: { id: lapsed },
      data: { createdAt: old, dayKey: dayIndexOf(old) + 3, streakDays: 1 },
    });

    // Played every day since. Here the streak is what proves it.
    const daily = await makePlayer('daily');
    await db.player.update({
      where: { id: daily },
      data: { createdAt: old, dayKey: dayIndexOf(new Date()), streakDays: 6 },
    });

    // Signed up the same day and never opened it again.
    const once = await makePlayer('once');
    await db.player.update({
      where: { id: once },
      data: { createdAt: old, dayKey: dayIndexOf(old), streakDays: 1 },
    });

    const theirs = (await funnel()).find((r) => r.day === dayKeyOf(old));
    expect(theirs).toMatchObject({ signups: 3, returned: 2 });
  });

  it('does not read a player who has never played as one who came back', async () => {
    /*
     * `dayKey` is zero until the first settle. Zero differs from the signup
     * day for every player alive, so a naive comparison reports a hundred per
     * cent retention forever — which is the shape of the bug this row exists
     * to keep out.
     */
    await makePlayer('neverplayed');
    expect(await db.player.findFirst({ select: { dayKey: true } })).toMatchObject({ dayKey: 0 });

    const today = (await funnel()).find((r) => r.day === dayKeyOf());
    expect(today).toMatchObject({ signups: 1, returned: 0 });
  });

  it('reads newest first, and honours the window', async () => {
    const long = new Date(Date.now() - 20 * 86_400_000);
    const id = await makePlayer('longago');
    await db.player.update({ where: { id }, data: { createdAt: long } });
    await makePlayer('recent');

    const wide = await read('?days=30');
    expect(wide.body.rows.map((r: { day: string }) => r.day)).toEqual(
      [...wide.body.rows.map((r: { day: string }) => r.day)].sort().reverse(),
    );
    expect(wide.body.totals.signups).toBe(2);

    // The default window is fourteen days, so the older signup falls outside.
    expect((await read()).body.totals.signups).toBe(1);
    expect((await read('?days=0')).statusCode).toBe(400);
    expect((await read('?days=nope')).statusCode).toBe(400);
  });
});
