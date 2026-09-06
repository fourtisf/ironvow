import { describe, expect, it } from 'vitest';
import { TROOP, heroStats, troopPower } from '@ironvow/config';
import type { BaseSnapshot, BattleArmy, DeployCommand, SnapshotBuilding } from '@ironvow/types';
import { createBattle, generateOpponent, simulate } from '../src/index.js';

/**
 * The hero and the troop lab.
 *
 * Both change how strong a unit is, so both have to be inputs the server
 * freezes and replays. The tests that matter are the ones proving a client
 * cannot field a hero it does not have, or a stronger raider than its lab
 * has paid for.
 */

const NONE: BattleArmy = { raider: 0, archer: 0, lancer: 0, ram: 0, scaler: 0 };

function snap(buildings: SnapshotBuilding[], pool = { g: 0, i: 0 }): BaseSnapshot {
  return { version: 1, defenderId: 'd', defenderName: 'Test', keepLevel: 1, buildings, pool };
}

const b = (id: string, type: SnapshotBuilding['type'], gx: number, gy: number, level = 1): SnapshotBuilding =>
  ({ id, type, gx, gy, level });

describe('hero statistics', () => {
  it('grows with level and is stronger than any troop at the same tier', () => {
    expect(heroStats(1).hp).toBe(1400);
    expect(heroStats(9).hp).toBeGreaterThan(heroStats(1).hp * 3);
    expect(heroStats(1).dmg).toBeGreaterThan(TROOP.ram.dmg * 0.7);
  });

  it('is clamped rather than extrapolated past the maximum', () => {
    expect(heroStats(99)).toEqual(heroStats(9));
    expect(heroStats(0)).toEqual(heroStats(1));
  });
});

describe('the hero on the field', () => {
  const opponent = generateOpponent(5);

  it('is refused when it is still recovering', () => {
    const out = simulate({
      snapshot: opponent,
      commands: [{ tickIndex: 0, troopType: 'hero', gx: 18, gy: 27 }],
      army: NONE,
      seed: 1,
      hero: { level: 5, available: false },
    });
    expect(out.rejected).toEqual([{ index: 0, reason: 'heroUnavailable' }]);
    expect(out.heroDeployed).toBe(false);
  });

  it('is refused a second time — there is only ever one', () => {
    const out = simulate({
      snapshot: opponent,
      commands: [
        { tickIndex: 0, troopType: 'hero', gx: 18, gy: 27 },
        { tickIndex: 30, troopType: 'hero', gx: 20, gy: 20 },
      ],
      army: NONE,
      seed: 1,
      hero: { level: 3, available: true },
    });
    expect(out.rejected).toEqual([{ index: 1, reason: 'heroAlreadyDeployed' }]);
    expect(out.heroDeployed).toBe(true);
  });

  it('reports when it falls, which is what drives the respawn timer', () => {
    // One hero alone against a base full of high-level defences.
    const out = simulate({
      snapshot: snap([
        b('k', 'keep', 27, 27, 9),
        b('c1', 'cannon', 23, 27, 9), b('c2', 'cannon', 31, 27, 9),
        b('c3', 'cannon', 27, 23, 9), b('c4', 'cannon', 27, 31, 9),
        b('t1', 'tower', 23, 23, 9), b('t2', 'tower', 31, 31, 9),
      ]),
      commands: [{ tickIndex: 0, troopType: 'hero', gx: 18, gy: 27 }],
      army: NONE,
      seed: 9,
      hero: { level: 1, available: true },
    });
    expect(out.heroDeployed).toBe(true);
    expect(out.heroDied).toBe(true);
  });

  it('survives a base it can actually beat', () => {
    const out = simulate({
      snapshot: snap([b('k', 'keep', 27, 27), b('m', 'mine', 23, 27)]),
      commands: [{ tickIndex: 0, troopType: 'hero', gx: 18, gy: 27 }],
      army: NONE,
      seed: 4,
      hero: { level: 6, available: true },
    });
    expect(out.heroDied).toBe(false);
    expect(out.stars).toBe(3);
  });

  it('does not consume warband room', () => {
    const out = simulate({
      snapshot: snap([b('k', 'keep', 27, 27)]),
      commands: [
        { tickIndex: 0, troopType: 'hero', gx: 18, gy: 27 },
        { tickIndex: 1, troopType: 'raider', gx: 19, gy: 27 },
      ],
      army: { ...NONE, raider: 1 },
      seed: 2,
      hero: { level: 4, available: true },
    });
    expect(out.rejected).toEqual([]);
  });

  it('keeps the clock running while the hero is still in hand', () => {
    // Every troop spent, but the hero uncommitted: the raid must not end.
    const out = simulate({
      snapshot: generateOpponent(2),
      commands: [{ tickIndex: 0, troopType: 'raider', gx: 18, gy: 27 }],
      army: { ...NONE, raider: 1 },
      seed: 3,
      hero: { level: 2, available: true },
    });
    expect(out.endedBy).not.toBe('exhausted');
  });
});

describe('troop lab levels', () => {
  const base = snap([b('k', 'keep', 27, 27, 5)]);
  const commands: DeployCommand[] = Array.from({ length: 6 }, (_, i) => ({
    tickIndex: i, troopType: 'raider', gx: 21, gy: 27,
  }));
  const army: BattleArmy = { ...NONE, raider: 6 };

  it('multiplies damage and hit points by the documented step', () => {
    expect(troopPower(1)).toBe(1);
    expect(troopPower(5)).toBeCloseTo(1.48, 6);
    expect(troopPower(99)).toBe(troopPower(9));
  });

  it('makes upgraded raiders visibly faster at breaking a keep', () => {
    const plain = simulate({ snapshot: base, commands, army, seed: 5 });
    const upgraded = simulate({ snapshot: base, commands, army, seed: 5, troopLevels: { raider: 9 } });

    // Both flatten an undefended Keep, so the upgrade shows up as time saved,
    // not as more damage. On a defended base that time is what survives.
    expect(plain.destroyedPct).toBe(1);
    expect(upgraded.ticks).toBeLessThan(plain.ticks);
    expect(upgraded.checksum).not.toBe(plain.checksum);
  });

  it('turns a raid that fails into one that succeeds when the base fights back', () => {
    const defended = snap([
      b('k', 'keep', 27, 27, 4),
      b('c1', 'cannon', 23, 27, 4),
      b('c2', 'cannon', 31, 27, 4),
    ]);
    const wave: DeployCommand[] = Array.from({ length: 10 }, (_, i) => ({
      tickIndex: i, troopType: 'raider', gx: 20, gy: 22,
    }));
    const ten: BattleArmy = { ...NONE, raider: 10 };

    const plain = simulate({ snapshot: defended, commands: wave, army: ten, seed: 8 });
    const upgraded = simulate({ snapshot: defended, commands: wave, army: ten, seed: 8, troopLevels: { raider: 9 } });

    expect(upgraded.destroyedPct).toBeGreaterThan(plain.destroyedPct);
    expect(upgraded.stars).toBeGreaterThanOrEqual(plain.stars);
  });

  it('treats a missing level as level 1 rather than as zero', () => {
    const implicit = simulate({ snapshot: base, commands, army, seed: 5 });
    const explicit = simulate({ snapshot: base, commands, army, seed: 5, troopLevels: { raider: 1 } });
    expect(explicit.checksum).toBe(implicit.checksum);
  });

  it('folds hero and lab levels into the checksum, so a forged loadout cannot match', () => {
    const honest = simulate({ snapshot: base, commands, army, seed: 5, troopLevels: { raider: 2 } });
    const inflated = simulate({ snapshot: base, commands, army, seed: 5, troopLevels: { raider: 7 } });
    expect(inflated.checksum).not.toBe(honest.checksum);
  });
});

describe('live play with a hero replays identically', () => {
  it('matches the server replay of the same commands', () => {
    const snapshot = generateOpponent(6);
    const army: BattleArmy = { raider: 8, archer: 4, lancer: 2, ram: 1, scaler: 0 };
    const hero = { level: 7, available: true };
    const troopLevels = { raider: 4, archer: 3, lancer: 2, ram: 5 };

    const battle = createBattle({ snapshot, commands: [], army, seed: 777, hero, troopLevels });
    const spots: [number, number][] = [[18, 27], [20, 20], [27, 18], [36, 20], [38, 27]];
    const recorded: DeployCommand[] = [];
    let i = 0;

    expect(battle.heroReady()).toBe(true);

    while (!battle.step()) {
      if (battle.tick % 12 === 0 && i < 16) {
        const type = i === 0 ? 'hero' : (['ram', 'lancer', 'archer', 'raider'] as const)[i % 4]!;
        const spot = spots[i % spots.length]!;
        const out = battle.deploy(type, spot[0], spot[1]);
        if (out.ok) recorded.push(out.command);
        i++;
      }
    }

    const live = battle.result();
    const replay = simulate({ snapshot, commands: recorded, army, seed: 777, hero, troopLevels });

    expect(replay.checksum).toBe(live.checksum);
    expect(replay.stars).toBe(live.stars);
    expect(replay.heroDied).toBe(live.heroDied);
    expect(replay.heroDeployed).toBe(live.heroDeployed);
    expect(replay.rejected).toEqual([]);
  });
});
