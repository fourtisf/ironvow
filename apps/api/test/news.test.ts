import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { NEWS_LATEST } from '@ironvow/config';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * What's New, server side.
 *
 * The one thing that has to be right is who gets shown what. A hold raised
 * today must not be greeted by seven notes about features it has never met,
 * and a hold that predates the column must be shown all of them — that player
 * is the entire reason the panel was written.
 */
describe.skipIf(!hasDatabase)("what's new", () => {
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

  it('creates a new hold already caught up', async () => {
    const made = await app.inject({ method: 'POST', url: '/auth/guest', payload: {} });
    expect(made.statusCode).toBe(200);
    const row = await db.player.findUnique({
      where: { id: made.json().playerId },
      select: { newsSeen: true },
    });
    expect(row?.newsSeen).toBe(NEWS_LATEST);
  });

  it('shows everything to a hold that predates the column', async () => {
    // The schema default, which is what every existing row in production has.
    const id = await makePlayer('older');
    expect((await db.player.findUnique({ where: { id }, select: { newsSeen: true } }))?.newsSeen).toBe(0);

    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie: await loginAs(app, id) } });
    expect(me.json().newsSeen).toBe(0);
  });

  it('marks the notes read, and does not un-read them afterwards', async () => {
    const id = await makePlayer('reader');
    const cookie = await loginAs(app, id);

    const marked = await app.inject({
      method: 'POST', url: '/me/news', headers: { cookie }, payload: { no: NEWS_LATEST },
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json().newsSeen).toBe(NEWS_LATEST);

    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    expect(me.json().newsSeen).toBe(NEWS_LATEST);
  });

  it('refuses a note number that does not exist', async () => {
    const cookie = await loginAs(app, await makePlayer('liar'));
    for (const no of [NEWS_LATEST + 1, -1, 1.5, 'all']) {
      const bad = await app.inject({ method: 'POST', url: '/me/news', headers: { cookie }, payload: { no } });
      expect(bad.statusCode, String(no)).toBe(400);
    }
    const missing = await app.inject({ method: 'POST', url: '/me/news', headers: { cookie }, payload: {} });
    expect(missing.statusCode).toBe(400);
  });

  it('needs a session', async () => {
    const out = await app.inject({ method: 'POST', url: '/me/news', payload: { no: NEWS_LATEST } });
    expect(out.statusCode).toBe(401);
  });
});
