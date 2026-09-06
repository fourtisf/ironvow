import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, hasDatabase, migrate, resetDatabase } from './helpers.js';

/**
 * The door.
 *
 * With ACCESS_CODE set, nobody raises a hold or asks for a login link
 * without it. The check answers only yes or no, and the code is never
 * echoed back in any response.
 */
describe.skipIf(!hasDatabase)('the access code', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ACCESS_CODE = '1010';
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

  it('says a code is needed', async () => {
    expect((await app.inject({ method: 'GET', url: '/auth/gate' })).json()).toEqual({ required: true });
  });

  it('answers yes to the code and no to anything else, without echoing it', async () => {
    const wrong = await app.inject({ method: 'POST', url: '/auth/gate', payload: { accessCode: '1234' } });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.body).not.toContain('1010');
    expect((await app.inject({ method: 'POST', url: '/auth/gate', payload: { accessCode: '10100' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/auth/gate', payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/auth/gate', payload: { accessCode: ' 1010 ' } })).statusCode).toBe(200);
  });

  it('keeps a guest out without the code, and lets one in with it', async () => {
    const shut = await app.inject({ method: 'POST', url: '/auth/guest', payload: {} });
    expect(shut.statusCode).toBe(403);
    expect(shut.json().error).toBe('badAccessCode');
    expect(await db.player.count()).toBe(0);

    const open = await app.inject({ method: 'POST', url: '/auth/guest', payload: { accessCode: '1010' } });
    expect(open.statusCode).toBe(200);
    expect(await db.player.count()).toBe(1);

    const link = await app.inject({ method: 'POST', url: '/auth/request', payload: { email: 'a@b.co' } });
    expect(link.statusCode).toBe(403);
  });
});
