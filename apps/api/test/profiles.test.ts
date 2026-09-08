import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * Finding somebody, and looking at them.
 *
 * The game had a ladder and a clan list and no way to look for one specific
 * person: a friend could tell you the name of their hold and there was nothing
 * you could do with it. And you could raid somebody without ever learning a
 * thing about them beyond a name and a star count.
 *
 * The rule that shapes both: a profile is a way to find somebody, not a way to
 * scout them. Nothing here is anything a raid would not already show, and
 * nothing here is a layout — a profile that scouted for free would make the
 * reroll cost meaningless.
 */

let app: Awaited<ReturnType<typeof buildApp>>;

describe.skipIf(!hasDatabase)('search and profiles', () => {
  beforeAll(async () => {
    migrate();
    app = await buildApp();
    await app.ready();
  });
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await app.close(); await db.$disconnect(); });

  const search = async (id: string, q: string) => app.inject({
    method: 'GET', url: `/players?q=${encodeURIComponent(q)}`,
    headers: { cookie: await loginAs(app, id) },
  });

  it('finds a hold by the name a friend told you', async () => {
    const me = await makePlayer('Seeker');
    await makePlayer('Ironhold', { trophies: 400 });
    const rows = (await search(me, 'Ironhold')).json().players;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Ironhold');
    expect(rows[0].trophies).toBe(400);
  });

  it('finds it from half of the name, and ignores the case', async () => {
    const me = await makePlayer('Seeker');
    await makePlayer('Ironhold');
    expect((await search(me, 'ironh')).json().players).toHaveLength(1);
    expect((await search(me, 'HOLD')).json().players).toHaveLength(1);
  });

  it('says nothing at all for one letter', async () => {
    // Otherwise the first keystroke returns a slice of the whole player table,
    // which is neither useful nor cheap.
    const me = await makePlayer('Seeker');
    await makePlayer('Ironhold');
    expect((await search(me, 'i')).json().players).toEqual([]);
  });

  it('marks the reader in their own results', async () => {
    const me = await makePlayer('Ironhold');
    const rows = (await search(me, 'Ironhold')).json().players;
    expect(rows[0].isMe).toBe(true);
  });

  it('puts the strongest first', async () => {
    const me = await makePlayer('Seeker');
    await makePlayer('Ironlow', { trophies: 10 });
    await makePlayer('Ironhigh', { trophies: 900 });
    const rows = (await search(me, 'Iron')).json().players;
    expect(rows.map((r: { name: string }) => r.name)).toEqual(['Ironhigh', 'Ironlow']);
  });

  it('shows a profile with the same rank the ladder would', async () => {
    const me = await makePlayer('Me', { trophies: 100 });
    const them = await makePlayer('Them', { trophies: 500, keepLevel: 6 });
    await makePlayer('Top', { trophies: 900 });

    const res = await app.inject({
      method: 'GET', url: `/player/${them}`, headers: { cookie: await loginAs(app, me) },
    });
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.name).toBe('Them');
    expect(p.keepLevel).toBe(6);
    expect(p.rank).toBe(2);
    expect(p.isMe).toBe(false);
    expect(typeof p.since).toBe('string');
  });

  it('never hands out a layout, which is what scouting is for', async () => {
    const me = await makePlayer('Me');
    const them = await makePlayer('Them');
    const p = (await app.inject({
      method: 'GET', url: `/player/${them}`, headers: { cookie: await loginAs(app, me) },
    })).json();
    expect(p.buildings).toBeUndefined();
    expect(p.snapshot).toBeUndefined();
    // Nor anything a raid would not already reveal.
    expect(p.gold).toBeUndefined();
    expect(p.iron).toBeUndefined();
    expect(p.email).toBeUndefined();
  });

  it('names the clan they are in, and says nothing when they are in none', async () => {
    const me = await makePlayer('Me');
    const them = await makePlayer('Them');
    const clan = await db.clan.create({ data: { name: 'The Vow', tag: 'VOW' } });
    await db.clanMember.create({ data: { clanId: clan.id, playerId: them, role: 'elder' } });

    const cookie = await loginAs(app, me);
    const withClan = (await app.inject({ method: 'GET', url: `/player/${them}`, headers: { cookie } })).json();
    expect(withClan.clan.name).toBe('The Vow');
    expect(withClan.clan.role).toBe('elder');

    const alone = (await app.inject({ method: 'GET', url: `/player/${me}`, headers: { cookie } })).json();
    expect(alone.clan).toBeNull();
  });

  it('404s a hold that does not exist', async () => {
    const me = await makePlayer('Me');
    const res = await app.inject({
      method: 'GET', url: '/player/nope', headers: { cookie: await loginAs(app, me) },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe.skipIf(!hasDatabase)('layout slots', () => {
  beforeAll(async () => {
    migrate();
    app = await buildApp();
    await app.ready();
  });
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await app.close(); await db.$disconnect(); });

  it('offers four now that there are four things to lay out for', async () => {
    const me = await makePlayer('Builder');
    const res = await app.inject({
      method: 'GET', url: '/layouts', headers: { cookie: await loginAs(app, me) },
    });
    const slots = res.json().layouts.map((l: { slot: string }) => l.slot);
    expect(slots).toEqual(['defence', 'farming', 'war', 'push']);
  });

  it('saves and reads back one of the new ones', async () => {
    const me = await makePlayer('Builder');
    const cookie = await loginAs(app, me);
    const save = await app.inject({
      method: 'POST', url: '/layouts/save', headers: { cookie },
      payload: { slot: 'war', name: 'Star bait' },
    });
    expect(save.statusCode).toBe(200);
    const row = (await app.inject({ method: 'GET', url: '/layouts', headers: { cookie } }))
      .json().layouts.find((l: { slot: string }) => l.slot === 'war');
    expect(row.saved).toBe(true);
    expect(row.name).toBe('Star bait');
    expect(row.buildings).toBeGreaterThan(0);
  });

  it('still refuses a slot that is not one of them', async () => {
    const me = await makePlayer('Builder');
    const res = await app.inject({
      method: 'POST', url: '/layouts/save',
      headers: { cookie: await loginAs(app, me) },
      payload: { slot: 'nonsense' },
    });
    expect(res.statusCode).toBe(400);
  });
});
