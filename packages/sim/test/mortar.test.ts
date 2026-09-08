import { DEF_STAT, MORTAR_MIN, MORTAR_SPLASH, TICKS_PER_SECOND, dist } from '@ironvow/config';
import { describe, expect, it } from 'vitest';
import type { BaseSnapshot, BattleArmy, DeployCommand, SnapshotBuilding } from '@ironvow/types';
import { createBattle } from '../src/index.js';

/**
 * The Mortar.
 *
 * It exists to answer one thing. With only a Cannon and an Arrow Tower on the
 * field — both of which shoot the nearest man — the strongest opening in the
 * game is to dump the whole warband on one tile and walk it in as a block, and
 * nothing on a defending base ever charged the attacker for that. These pin the
 * two rules that do, and the two rules that keep it from being oppressive.
 */

const NONE: BattleArmy = { raider: 0, archer: 0, lancer: 0, ram: 0, scaler: 0 };

function snap(buildings: SnapshotBuilding[]): BaseSnapshot {
  return {
    version: 1, defenderId: 'd', defenderName: 'Test', keepLevel: 1,
    buildings, pool: { g: 1000, i: 500 },
  };
}

function b(id: string, type: SnapshotBuilding['type'], gx: number, gy: number, level = 1): SnapshotBuilding {
  return { id, type, gx, gy, level };
}

/**
 * A Mortar alone, with a Keep well out of its way. Centre is (29.5, 29.5).
 *
 * The Mortar is first in the list on purpose. A Ram prefers ramparts, and with
 * none on the field it falls through to whichever structure it considers first
 * — so a Keep listed ahead of the Mortar sends it walking across the map, and
 * every test below would measure a Ram that never came near the thing.
 */
const emplacement = () => snap([b('m', 'mortar', 28, 28, 5), b('k', 'keep', 46, 46, 1)]);
const MX = 29.5;
const MY = 29.5;

function play(
  spots: [number, number][], seconds: number,
  base = emplacement(), troop: 'raider' | 'ram' = 'raider',
) {
  const commands: DeployCommand[] = spots.map(([gx, gy], i) => ({
    tickIndex: i, troopType: troop, gx, gy,
  }));
  const battle = createBattle({
    snapshot: base, commands, army: { ...NONE, [troop]: spots.length }, seed: 5,
  });
  for (let i = 0; i < TICKS_PER_SECOND * seconds && !battle.step(); i++) { /* the clock */ }
  const mine = battle.units.filter((u) => u.side === 'atk');
  // Every one of these tests is worthless if the deploy was refused, which is
  // exactly what happens if a spot drifts inside DEPLOY_CLEARANCE. Assert it
  // here rather than discovering a vacuously passing suite later.
  expect(battle.result().rejected).toEqual([]);
  expect(mine).toHaveLength(spots.length);
  return { battle, hurt: mine.filter((u) => u.hp < u.maxHp).length, mine };
}

/** Ten men on one tile, at the far edge of the Mortar's reach. */
const stacked = (): [number, number][] =>
  Array.from({ length: 10 }, (_, i) => [36 + (i % 2) * 0.3, 30 + Math.floor(i / 2) * 0.3]);

/** The same ten, walked in along a line instead of in a block. */
const spread = (): [number, number][] =>
  Array.from({ length: 10 }, (_, i) => [36 - i * 0.15, 21 + i * 1.9]);

describe('a Mortar charges you for standing together', () => {
  it('hits several men with one shell, which nothing else in the game does', () => {
    // Two seconds: the opening shell and nothing after it, so what is measured
    // is one shot rather than a war of attrition.
    expect(play(stacked(), 2).hurt).toBeGreaterThan(2);
  });

  it('costs a block more than a line, same men, same seed, same clock', () => {
    expect(play(stacked(), 2).hurt).toBeGreaterThan(play(spread(), 2).hurt);
  });

  it('a Cannon does not care how they are standing, which is the contrast', () => {
    const guns = snap([b('c', 'cannon', 28, 28, 5), b('k', 'keep', 46, 46, 1)]);
    // Same block, same line, in front of a Cannon instead. One man either way.
    expect(play(stacked(), 2, guns).hurt).toBe(play(spread(), 2, guns).hurt);
  });
});

describe('a Mortar cannot defend itself, and that is the point of it', () => {
  /** Walk one Ram in until it is inside the dead zone, then hold it there. */
  const closeIn = (base = emplacement()) => {
    const battle = createBattle({
      snapshot: base,
      commands: [{ tickIndex: 0, troopType: 'ram', gx: 36, gy: 29.5 }],
      army: { ...NONE, ram: 1 }, seed: 5,
    });
    const u = () => battle.units[0]!;
    for (let i = 0; i < TICKS_PER_SECOND * 30; i++) {
      battle.step();
      if (dist(u().x, u().y, MX, MY) < MORTAR_MIN) break;
    }
    expect(dist(u().x, u().y, MX, MY)).toBeLessThan(MORTAR_MIN);
    return { battle, u };
  };

  it('stops hurting a man the moment he is inside the zone', () => {
    const { battle, u } = closeIn();
    const hp = u().hp;
    // Ten seconds is three shells it would have fired if it could.
    for (let i = 0; i < TICKS_PER_SECOND * 10; i++) battle.step();
    expect(u().hp).toBe(hp);
    expect(u().dead).toBe(false);
  });

  it('did hurt him on the way in, so the zone is what changed', () => {
    const { u } = closeIn();
    expect(u().hp).toBeLessThan(u().maxHp);
  });

  it('a Cannon has no such hole: it keeps firing at point blank', () => {
    const guns = snap([b('c', 'cannon', 28, 28, 5), b('k', 'keep', 46, 46, 1)]);
    const battle = createBattle({
      snapshot: guns,
      commands: [{ tickIndex: 0, troopType: 'ram', gx: 36, gy: 29.5 }],
      army: { ...NONE, ram: 1 }, seed: 5,
    });
    const u = () => battle.units[0]!;
    for (let i = 0; i < TICKS_PER_SECOND * 30; i++) {
      battle.step();
      if (dist(u().x, u().y, 29, 29) < MORTAR_MIN) break;
    }
    const hp = u().hp;
    for (let i = 0; i < TICKS_PER_SECOND * 6; i++) battle.step();
    expect(u().hp).toBeLessThan(hp);
  });

  it('leaves a hole worth walking into', () => {
    // Not an assertion about a number so much as about the shape of one: a dead
    // zone that is a tenth of the reach is a rounding error, not a decision.
    const st = DEF_STAT.mortar!(1);
    expect(st.min).toBe(MORTAR_MIN);
    expect(st.splash).toBe(MORTAR_SPLASH);
    expect(st.min! / st.rng).toBeGreaterThan(0.2);
  });
});

describe('the shell is committed the moment it leaves the barrel', () => {
  it('does not home, so walking out from under it works', () => {
    // A third of a second: long enough for the opening shell to be fired,
    // short enough that it is still in the air. It covers 6.5 cells at 7/s.
    const { battle } = play([[36, 30]], 0.35);
    const shell = battle.projs.find((p) => p.splash !== undefined);
    expect(shell).toBeDefined();
    expect(shell!.tgtUnit).toBe(-1);
    expect(shell!.splash).toBe(MORTAR_SPLASH);

    const aim = { tx: shell!.tx, ty: shell!.ty };
    battle.step();
    const still = battle.projs.find((p) => p.splash !== undefined);
    if (still) {
      expect(still.tx).toBe(aim.tx);
      expect(still.ty).toBe(aim.ty);
    }
  });
});

describe('nothing else on a base changed', () => {
  it('the Cannon and the Arrow Tower have neither splash nor a dead zone', () => {
    for (const t of ['cannon', 'tower'] as const) {
      const st = DEF_STAT[t]!(1);
      expect(st.splash).toBeUndefined();
      expect(st.min).toBeUndefined();
    }
  });
});
