import {
  INVITE_REWARD, INVITE_REWARD_KEEP_LEVEL, INVITE_WELCOME, looksLikeInvite,
} from '@ironvow/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { newInviteCode } from '../src/domain/invites.js';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Invitations.
 *
 * ALFA was going to launch by handing out one access code in replies, which is
 * already a referral programme — just one nobody was writing down. These pin
 * the two rules that keep it from being farmed: the inviter is paid when the
 * invited hold reaches a Keep level, never at sign-up, and paid once.
 */

let app: Awaited<ReturnType<typeof buildApp>>;

describe.skipIf(!hasDatabase)('invitations', () => {
  beforeAll(async () => {
    // The refusal below is only a refusal when the operator's door is shut.
    process.env.ACCESS_CODE = '1010';
    migrate();
    app = await buildApp();
    await app.ready();
  });
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await app.close(); await db.$disconnect(); });

  const codeOf = async (playerId: string): Promise<string> => {
    const res = await app.inject({
      method: 'GET', url: '/invite', headers: { cookie: await loginAs(app, playerId) },
    });
    expect(res.statusCode).toBe(200);
    return res.json().code as string;
  };

  it('draws codes a human can read off one phone and into another', () => {
    for (let i = 0; i < 200; i++) {
      const code = newInviteCode();
      expect(looksLikeInvite(code)).toBe(true);
      // No O/0, I/1 or S/5: the three pairs people actually get wrong.
      expect(/[O0I1S5]/.test(code)).toBe(false);
    }
  });

  it('gives a player the same code every time it is asked for', async () => {
    const id = await makePlayer('host');
    expect(await codeOf(id)).toBe(await codeOf(id));
  });

  it('opens the door, and remembers who opened it', async () => {
    const host = await makePlayer('host');
    const code = await codeOf(host);

    const gate = await app.inject({ method: 'POST', url: '/auth/gate', payload: { accessCode: code } });
    expect(gate.statusCode).toBe(200);

    const joined = await app.inject({ method: 'POST', url: '/auth/guest', payload: { accessCode: code } });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().invited).toBe(true);

    const newcomer = await db.player.findUniqueOrThrow({ where: { id: joined.json().playerId } });
    expect(newcomer.invitedById).toBe(host);
    // And arrives with a little more than a stranger would.
    expect(Number(newcomer.gold)).toBeGreaterThanOrEqual(INVITE_WELCOME.g);
  });

  it('refuses a code that fits nothing', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/guest', payload: { accessCode: 'ZZZZZZ' } });
    expect(res.statusCode).toBe(403);
  });

  it('pays nothing until the invited hold has actually been played', async () => {
    const host = await makePlayer('host');
    const code = await codeOf(host);
    const joined = await app.inject({ method: 'POST', url: '/auth/guest', payload: { accessCode: code } });
    const newcomerId = joined.json().playerId as string;

    const before = await db.player.findUniqueOrThrow({ where: { id: host } });
    // A fresh hold reads /me and pays nobody: it is at Keep 1.
    await app.inject({
      method: 'GET', url: '/me', headers: { cookie: await loginAs(app, newcomerId) },
    });
    const still = await db.player.findUniqueOrThrow({ where: { id: host } });
    expect(still.gold).toBe(before.gold);
  });

  it('pays the inviter once the Keep is up, and exactly once', async () => {
    const host = await makePlayer('host');
    const code = await codeOf(host);
    const joined = await app.inject({ method: 'POST', url: '/auth/guest', payload: { accessCode: code } });
    const newcomerId = joined.json().playerId as string;
    const cookie = await loginAs(app, newcomerId);

    const before = await db.player.findUniqueOrThrow({ where: { id: host } });
    // Raise the Keep the way the game does: the level lives on the building,
    // and settleAndLoad is what notices.
    await db.building.updateMany({
      where: { playerId: newcomerId, type: 'keep' },
      data: { level: INVITE_REWARD_KEEP_LEVEL },
    });
    await app.inject({ method: 'GET', url: '/me', headers: { cookie } });

    const paid = await db.player.findUniqueOrThrow({ where: { id: host } });
    expect(Number(paid.gold - before.gold)).toBe(INVITE_REWARD.g);
    expect(Number(paid.iron - before.iron)).toBe(INVITE_REWARD.i);

    // Every read after this is free. A referral that pays per page view is a
    // referral that pays for a refresh loop.
    await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    const after = await db.player.findUniqueOrThrow({ where: { id: host } });
    expect(after.gold).toBe(paid.gold);
  });

  it('counts who joined and who has paid out', async () => {
    const host = await makePlayer('host');
    const code = await codeOf(host);
    for (let i = 0; i < 2; i++) {
      await app.inject({ method: 'POST', url: '/auth/guest', payload: { accessCode: code } });
    }
    const res = await app.inject({
      method: 'GET', url: '/invite', headers: { cookie: await loginAs(app, host) },
    });
    expect(res.json().invited).toBe(2);
    expect(res.json().paid).toBe(0);
  });
});
