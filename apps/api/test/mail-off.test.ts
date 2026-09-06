import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * A server with no mail provider must still run.
 *
 * The first deployment of IRONVOW did not: compose set NODE_ENV=production
 * with the console transport, env() refused that on principle, and the API
 * crash-looped for an hour while the client drew an empty field. `off` is the
 * state a hobby server is actually in — guest play works, the email buttons
 * say why they do not — and production has to accept it.
 */

describe('MAIL_TRANSPORT=off', () => {
  const saved = { ...process.env };

  afterEach(async () => {
    process.env = { ...saved };
    const { resetEnv } = await import('../src/lib/env.js');
    resetEnv();
  });

  it('is accepted in production, where console is not', async () => {
    const { env, resetEnv } = await import('../src/lib/env.js');
    Object.assign(process.env, {
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://x', SESSION_SECRET: 'a-real-secret-of-decent-length',
    });

    resetEnv();
    process.env.MAIL_TRANSPORT = 'console';
    expect(() => env()).toThrow(/console/);

    resetEnv();
    process.env.MAIL_TRANSPORT = 'off';
    expect(env().MAIL_TRANSPORT).toBe('off');
  });
});

describe.skipIf(!hasDatabase)('the email routes with mail off', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.MAIL_TRANSPORT = 'off';
    const { resetEnv } = await import('../src/lib/env.js');
    resetEnv();
    migrate();
    const { buildApp } = await import('../src/app.js');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
    delete process.env.MAIL_TRANSPORT;
    const { resetEnv } = await import('../src/lib/env.js');
    resetEnv();
  });

  beforeEach(resetDatabase);

  it('still raises a guest hold', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/guest' });
    expect(res.statusCode).toBe(200);
  });

  it('says so on a login request, and mints no link', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/request', payload: { email: 'someone@example.com' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('mailOff');
    expect(await db.loginLink.count()).toBe(0);
  });

  it('says so on a claim too', async () => {
    const playerId = await makePlayer('Guest');
    const cookie = await loginAs(app, playerId);
    const res = await app.inject({
      method: 'POST', url: '/auth/claim', headers: { cookie }, payload: { email: 'keeper@example.com' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('mailOff');
  });
});
