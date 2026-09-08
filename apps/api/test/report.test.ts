import { N, TICK_SECONDS } from '@ironvow/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BaseSnapshot, DeployCommand } from '@ironvow/types';
import { buildApp } from '../src/app.js';
import { buildReport, compass } from '../src/domain/report.js';
import { db, hasDatabase, loginAs, makePlayer, migrate, resetDatabase } from './helpers.js';

/**
 * The breach report.
 *
 * A defender could already watch a raid back. Watching tells you that you lost.
 * It does not tell you that every one of them came in over the same corner, or
 * that the Mortar you paid four thousand gold for never fired a shot. That is
 * what this is for, and all of it is derived from the stored raid rather than
 * recorded during it.
 */

let app: Awaited<ReturnType<typeof buildApp>>;

const mid = N / 2;

function snap(buildings: BaseSnapshot['buildings']): BaseSnapshot {
  return {
    version: 1, defenderId: 'd', defenderName: 'T', keepLevel: 3,
    buildings, pool: { g: 800, i: 300 },
  };
}

const EMPTY = { raider: 0, archer: 0, lancer: 0, ram: 0, scaler: 0 };

function report(buildings: BaseSnapshot['buildings'], commands: DeployCommand[], raiders = 8) {
  return buildReport({
    snapshot: snap(buildings),
    commands,
    items: [],
    pouch: {},
    army: { ...EMPTY, raider: raiders },
    seed: 5,
    hero: { level: 1, available: false },
    troopLevels: {},
  });
}

describe('which way they came in', () => {
  it('reads eight points, because a corner is different advice from an edge', () => {
    expect(compass(1, 0)).toBe('east');
    expect(compass(-1, 0)).toBe('west');
    expect(compass(0, -1)).toBe('north');
    expect(compass(0, 1)).toBe('south');
    expect(compass(1, 1)).toBe('south-east');
    expect(compass(-1, -1)).toBe('north-west');
    expect(compass(0, 0)).toBe('everywhere');
  });

  it('names the side a one-sided attack came from', () => {
    const r = report(
      [{ id: 'k', type: 'keep', gx: mid - 1, gy: mid - 1, level: 3 }],
      Array.from({ length: 6 }, (_, i): DeployCommand => ({
        tickIndex: i, troopType: 'raider', gx: mid + 12, gy: mid + (i % 3) * 0.4,
      })),
    );
    expect(r.side).toBe('east');
    expect(r.concentration).toBeGreaterThan(0.9);
  });

  it('says "everywhere" rather than inventing a side that is not there', () => {
    // Four deploys, one per compass point. There is no thin side to report and
    // pretending otherwise would be worse than saying nothing.
    const r = report(
      [{ id: 'k', type: 'keep', gx: mid - 1, gy: mid - 1, level: 3 }],
      [
        { tickIndex: 0, troopType: 'raider', gx: mid + 12, gy: mid },
        { tickIndex: 1, troopType: 'raider', gx: mid - 12, gy: mid },
        { tickIndex: 2, troopType: 'raider', gx: mid, gy: mid + 12 },
        { tickIndex: 3, troopType: 'raider', gx: mid, gy: mid - 12 },
      ],
    );
    expect(r.side).toBe('everywhere');
    expect(r.concentration).toBeLessThan(0.35);
  });
});

describe('what never fired', () => {
  it('names a defence the attack never walked into', () => {
    /*
     * The single most useful line in the report, and the one thing a defender
     * cannot see by watching: a Cannon covering ground nobody crossed looks
     * exactly like a Cannon doing its job until you count its shots.
     */
    // Two raiders against a maxed gun: they die on the near side and the far
    // one never sees anybody. With a full warband they would eventually walk
    // the whole map and every gun on it would get a shot off, which is true
    // and useless.
    const r = report(
      [
        { id: 'k', type: 'keep', gx: mid - 1, gy: mid - 1, level: 3 },
        { id: 'near', type: 'cannon', gx: mid + 4, gy: mid, level: 9 },
        { id: 'far', type: 'cannon', gx: 8, gy: 8, level: 9 },
      ],
      [
        { tickIndex: 0, troopType: 'raider', gx: mid + 12, gy: mid },
        { tickIndex: 1, troopType: 'raider', gx: mid + 12, gy: mid + 0.4 },
      ],
      2,
    );
    const idle = r.idle.map((x) => x.type);
    expect(idle).toContain('cannon');
    // Exactly one of the two: the near gun fired, the far one never saw anybody.
    expect(r.idle).toHaveLength(1);
  });

  it('reports nothing idle when every gun got a shot off', () => {
    const r = report(
      [
        { id: 'k', type: 'keep', gx: mid - 1, gy: mid - 1, level: 3 },
        { id: 'c', type: 'cannon', gx: mid + 4, gy: mid, level: 3 },
      ],
      Array.from({ length: 8 }, (_, i): DeployCommand => ({
        tickIndex: i, troopType: 'raider', gx: mid + 10, gy: mid + (i % 3) * 0.4,
      })),
    );
    expect(r.idle).toHaveLength(0);
  });

  it('never counts a trap or a rampart as an idle defence', () => {
    // Neither fires. Listing them would bury the one line that matters.
    const r = report(
      [
        { id: 'k', type: 'keep', gx: mid - 1, gy: mid - 1, level: 3 },
        { id: 'w', type: 'wall', gx: 8, gy: 8, level: 3 },
        { id: 't', type: 'spike', gx: 9, gy: 9, level: 3 },
      ],
      [{ tickIndex: 0, troopType: 'raider', gx: mid + 12, gy: mid }],
      1,
    );
    expect(r.idle).toHaveLength(0);
  });
});

describe('what fell, and what was never found', () => {
  it('lists the buildings that went, earliest first, and leaves ramparts out', () => {
    const r = report(
      [
        { id: 'k', type: 'keep', gx: mid - 1, gy: mid - 1, level: 1 },
        { id: 'm', type: 'mine', gx: mid + 6, gy: mid, level: 1 },
        { id: 'w', type: 'wall', gx: mid + 5, gy: mid, level: 1 },
      ],
      Array.from({ length: 10 }, (_, i): DeployCommand => ({
        tickIndex: i, troopType: 'raider', gx: mid + 10, gy: mid + (i % 3) * 0.4,
      })),
      10,
    );
    expect(r.fell.length).toBeGreaterThan(0);
    expect(r.fell.map((f) => f.type)).not.toContain('wall');
    for (let i = 1; i < r.fell.length; i++) {
      expect(r.fell[i]!.at).toBeGreaterThanOrEqual(r.fell[i - 1]!.at);
    }
  });

  it('says which traps were found and which were never touched', () => {
    const r = report(
      [
        { id: 'k', type: 'keep', gx: mid - 1, gy: mid - 1, level: 3 },
        { id: 'hit', type: 'spike', gx: mid + 6, gy: mid, level: 3 },
        { id: 'miss', type: 'spike', gx: 8, gy: 8, level: 3 },
      ],
      Array.from({ length: 8 }, (_, i): DeployCommand => ({
        tickIndex: i, troopType: 'raider', gx: mid + 12, gy: mid + (i % 3) * 0.4,
      })),
    );
    expect(r.traps).toHaveLength(2);
    expect(r.traps.filter((t) => t.sprung)).toHaveLength(1);
    expect(r.traps.find((t) => t.sprung)!.at).toBeGreaterThan(0);
    expect(r.traps.find((t) => !t.sprung)!.at).toBeNull();
  });

  it('measures in seconds, not ticks, because nobody thinks in thirtieths', () => {
    const r = report(
      [{ id: 'k', type: 'keep', gx: mid - 1, gy: mid - 1, level: 1 }],
      [{ tickIndex: 0, troopType: 'raider', gx: mid + 10, gy: mid }],
      1,
    );
    expect(r.seconds).toBeGreaterThan(TICK_SECONDS);
  });
});

describe.skipIf(!hasDatabase)('over the wire', () => {
  beforeAll(async () => {
    migrate();
    app = await buildApp();
    await app.ready();
  });
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await app.close(); await db.$disconnect(); });

  /** Open a raid, submit it, and hand back the id and both cookies. */
  async function fought() {
    const attacker = await makePlayer('att', { keepLevel: 5, gold: 9_000, iron: 9_000 });
    const cookie = await loginAs(app, attacker);
    const found = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie } })).json();
    await app.inject({
      method: 'POST', url: `/raid/${found.raidId}/submit`, headers: { cookie },
      payload: {
        commands: Array.from({ length: 4 }, (_, i) => ({
          tickIndex: i, troopType: 'raider', gx: 20, gy: 30 + i * 0.3,
        })),
      },
    });
    return { raidId: found.raidId as string, cookie, attacker };
  }

  it('answers for a raid you were part of', async () => {
    const { raidId, cookie } = await fought();
    const res = await app.inject({ method: 'GET', url: `/raid/${raidId}/report`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.side).toBe('string');
    expect(Array.isArray(body.idle)).toBe(true);
    // Names resolved server-side, so the client holds no second copy of them.
    for (const row of [...body.idle, ...body.fell, ...body.traps]) {
      expect(typeof row.n).toBe('string');
      expect(row.n.length).toBeGreaterThan(0);
    }
  });

  it('refuses one you had nothing to do with', async () => {
    const { raidId } = await fought();
    const other = await makePlayer('nosy');
    const res = await app.inject({
      method: 'GET', url: `/raid/${raidId}/report`,
      headers: { cookie: await loginAs(app, other) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a raid that was never submitted', async () => {
    const attacker = await makePlayer('open', { keepLevel: 5 });
    const cookie = await loginAs(app, attacker);
    const found = (await app.inject({ method: 'POST', url: '/raid/find', headers: { cookie } })).json();
    const res = await app.inject({
      method: 'GET', url: `/raid/${found.raidId}/report`, headers: { cookie },
    });
    expect(res.statusCode).toBe(409);
  });
});
