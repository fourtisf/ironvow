import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_RATE_LIMIT, CLAN_CREATE_COST, CLAN_CREATE_KEEP_LEVEL, cleanMessage, cleanTag, outranks,
} from '@ironvow/config';
import type { FastifyInstance } from 'fastify';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Clans.
 *
 * The interesting surface here is not "can two players be in a clan" but the
 * permission edges: a member must not be able to kick, an elder must not be
 * able to remove another elder, a leader must not be able to walk out and
 * leave a room nobody can moderate, and nothing at all may be decided from
 * what the client claims its own role is.
 */

describe('clan rules that need no database', () => {
  it('ranks strictly, so equals cannot act on each other', () => {
    expect(outranks('leader', 'elder')).toBe(true);
    expect(outranks('elder', 'member')).toBe(true);
    expect(outranks('elder', 'elder')).toBe(false);
    expect(outranks('member', 'member')).toBe(false);
  });

  it('flattens a message that would otherwise take over the room', () => {
    expect(cleanMessage('hello\n\n\n\n\n\nthere')).toBe('hello there');
    expect(cleanMessage('   ')).toBe('');
    expect(cleanMessage('a'.repeat(500)).length).toBeLessThanOrEqual(220);
  });

  it('normalises a tag rather than refusing it', () => {
    expect(cleanTag('  ir-on!  ')).toBe('IRON');
  });
});

describe.skipIf(!hasDatabase)('clans over the wire', () => {
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

  /** A player who can afford to found a clan. */
  async function founder(name: string) {
    const id = await makePlayer(name, {
      keepLevel: CLAN_CREATE_KEEP_LEVEL, gold: CLAN_CREATE_COST.g + 5000, trophies: 400,
    });
    return { id, cookie: await loginAs(app, id) };
  }

  async function joiner(name: string, trophies = 100) {
    const id = await makePlayer(name, { keepLevel: 2, trophies });
    return { id, cookie: await loginAs(app, id) };
  }

  const post = (url: string, cookie: string, payload: unknown = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie }, payload: payload as object });
  const get = (url: string, cookie: string) =>
    app.inject({ method: 'GET', url, headers: { cookie } });

  async function makeClan(cookie: string, over: Record<string, unknown> = {}) {
    const res = await post('/clans', cookie, {
      name: 'Iron Vow', tag: 'iv', joinPolicy: 'open', ...over,
    });
    expect(res.statusCode).toBe(200);
    return res.json().clanId as string;
  }

  it('charges for founding, and makes the founder the leader', async () => {
    const a = await founder('Founder');
    const before = await db.player.findUniqueOrThrow({ where: { id: a.id } });
    await makeClan(a.cookie);

    const after = await db.player.findUniqueOrThrow({ where: { id: a.id } });
    expect(Number(before.gold) - Number(after.gold)).toBe(CLAN_CREATE_COST.g);

    const mine = (await get('/clan', a.cookie)).json();
    expect(mine.role).toBe('leader');
    expect(mine.clan.tag).toBe('IV');
    expect(mine.clan.memberCount).toBe(1);
  });

  it('refuses a founder who cannot afford it, and takes nothing', async () => {
    const id = await makePlayer('Broke', { keepLevel: CLAN_CREATE_KEEP_LEVEL, gold: 10 });
    const cookie = await loginAs(app, id);
    const res = await post('/clans', cookie, { name: 'Paupers', tag: 'PR' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('cannotAfford');
    expect(Number((await db.player.findUniqueOrThrow({ where: { id } })).gold)).toBe(10);
  });

  it('refuses a second clan with the same name or tag', async () => {
    const a = await founder('First');
    await makeClan(a.cookie);
    const b = await founder('Second');
    expect((await post('/clans', b.cookie, { name: 'Iron Vow', tag: 'XX' })).json().error).toBe('nameTaken');
    expect((await post('/clans', b.cookie, { name: 'Other Name', tag: 'IV' })).json().error).toBe('nameTaken');
  });

  it('keeps a player in one clan at a time', async () => {
    const a = await founder('LeaderA');
    const clan = await makeClan(a.cookie);
    const b = await joiner('Joiner');
    expect((await post('/clan/join', b.cookie, { clanId: clan })).json().state).toBe('joined');
    // Already seated: the second attempt is refused rather than moving them.
    expect((await post('/clan/join', b.cookie, { clanId: clan })).json().error).toBe('alreadyInClan');
  });

  it('holds the trophy floor on the server, not in the list', async () => {
    const a = await founder('Picky');
    const clan = await makeClan(a.cookie, { minTrophies: 500 });
    const b = await joiner('Rookie', 20);
    const res = await post('/clan/join', b.cookie, { clanId: clan });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('trophiesTooLow');
  });

  it('queues an application when the policy asks for one', async () => {
    const a = await founder('Gatekeeper');
    const clan = await makeClan(a.cookie, { joinPolicy: 'request' });
    const b = await joiner('Applicant');

    expect((await post('/clan/join', b.cookie, { clanId: clan })).json().state).toBe('requested');
    expect((await get('/clan', b.cookie)).json().clan).toBeNull();

    const seen = (await get('/clan', a.cookie)).json();
    expect(seen.requests).toHaveLength(1);
    expect(seen.requests[0].name).toBe('Applicant');

    expect((await post('/clan/requests/decide', a.cookie, { playerId: b.id, accept: true })).json().accepted).toBe(true);
    expect((await get('/clan', b.cookie)).json().role).toBe('member');
  });

  it('does not let a member kick anyone', async () => {
    const a = await founder('Chief');
    const clan = await makeClan(a.cookie);
    const b = await joiner('MemberB');
    const c = await joiner('MemberC');
    await post('/clan/join', b.cookie, { clanId: clan });
    await post('/clan/join', c.cookie, { clanId: clan });

    const res = await post('/clan/kick', b.cookie, { playerId: c.id });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('notAllowed');
  });

  it('does not let an elder remove another elder', async () => {
    const a = await founder('Chief2');
    const clan = await makeClan(a.cookie);
    const b = await joiner('ElderB');
    const c = await joiner('ElderC');
    await post('/clan/join', b.cookie, { clanId: clan });
    await post('/clan/join', c.cookie, { clanId: clan });
    await post('/clan/role', a.cookie, { playerId: b.id, role: 'elder' });
    await post('/clan/role', a.cookie, { playerId: c.id, role: 'elder' });

    expect((await post('/clan/kick', b.cookie, { playerId: c.id })).json().error).toBe('notAllowed');
    // But an elder can remove a plain member.
    const d = await joiner('PlainD');
    await post('/clan/join', d.cookie, { clanId: clan });
    expect((await post('/clan/kick', b.cookie, { playerId: d.id })).statusCode).toBe(200);
  });

  it('will not let a leader abandon a clan that still has people in it', async () => {
    const a = await founder('Chief3');
    const clan = await makeClan(a.cookie);
    const b = await joiner('Left behind');
    await post('/clan/join', b.cookie, { clanId: clan });

    expect((await post('/clan/leave', a.cookie)).json().error).toBe('passLeadershipFirst');

    // Handing over demotes the old leader in the same transaction.
    await post('/clan/role', a.cookie, { playerId: b.id, role: 'leader' });
    expect((await get('/clan', a.cookie)).json().role).toBe('elder');
    expect((await get('/clan', b.cookie)).json().role).toBe('leader');
    expect((await post('/clan/leave', a.cookie)).statusCode).toBe(200);
  });

  it('closes the clan when the last member leaves', async () => {
    const a = await founder('Solo');
    const clan = await makeClan(a.cookie);
    expect((await post('/clan/leave', a.cookie)).statusCode).toBe(200);
    expect(await db.clan.findUnique({ where: { id: clan } })).toBeNull();
  });

  it('carries chat between two members and refuses an outsider', async () => {
    const a = await founder('Talker');
    const clan = await makeClan(a.cookie);
    const b = await joiner('Listener');
    await post('/clan/join', b.cookie, { clanId: clan });
    const outsider = await joiner('Nobody');

    await post('/clan/messages', a.cookie, { body: '  hello   there  ' });
    const seen = (await get('/clan/messages', b.cookie)).json().messages;
    const chat = seen.filter((m: { kind: string }) => m.kind === 'chat');
    expect(chat).toHaveLength(1);
    expect(chat[0].body).toBe('hello there');
    expect(chat[0].mine).toBe(false);

    expect((await get('/clan/messages', outsider.cookie)).json().error).toBe('notInClan');
    expect((await post('/clan/messages', outsider.cookie, { body: 'hi' })).json().error).toBe('notInClan');
  });

  it('rate limits chat per player', async () => {
    const a = await founder('Flooder');
    await makeClan(a.cookie);
    for (let i = 0; i < CHAT_RATE_LIMIT; i++) {
      expect((await post('/clan/messages', a.cookie, { body: `line ${i}` })).statusCode).toBe(200);
    }
    const over = await post('/clan/messages', a.cookie, { body: 'one too many' });
    expect(over.statusCode).toBe(429);
    expect(over.json().error).toBe('tooFast');
  });

  it('lets an elder delete a line, and a member delete only their own', async () => {
    const a = await founder('Chief4');
    const clan = await makeClan(a.cookie);
    const b = await joiner('Chatty');
    await post('/clan/join', b.cookie, { clanId: clan });

    const mine = (await post('/clan/messages', b.cookie, { body: 'mine' })).json().message;
    const theirs = (await post('/clan/messages', a.cookie, { body: 'theirs' })).json().message;

    // A member cannot delete somebody else's line...
    expect((await post('/clan/messages/delete', b.cookie, { messageId: theirs.id })).json().error).toBe('notAllowed');
    // ...but can delete their own, and the leader can delete anything.
    expect((await post('/clan/messages/delete', b.cookie, { messageId: mine.id })).statusCode).toBe(200);
    const second = (await post('/clan/messages', b.cookie, { body: 'again' })).json().message;
    expect((await post('/clan/messages/delete', a.cookie, { messageId: second.id })).statusCode).toBe(200);
  });

  it('ranks the clan ladder by the trophies its members actually hold', async () => {
    const a = await founder('Big');
    const bigClan = await makeClan(a.cookie, { name: 'Big Clan', tag: 'BIG' });
    const b = await joiner('Heavy', 3000);
    await post('/clan/join', b.cookie, { clanId: bigClan });

    const c = await founder('Small');
    await makeClan(c.cookie, { name: 'Small Clan', tag: 'SML' });

    const top = (await get('/leaderboard/clans', a.cookie)).json().top;
    expect(top[0].tag).toBe('BIG');
    expect(top[0].rank).toBe(1);
    expect(top[0].trophies).toBe(400 + 3000);
    expect(top[0].isMine).toBe(true);
    expect(top[1].tag).toBe('SML');
  });
});
