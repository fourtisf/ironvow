import { TICKS_PER_SECOND, TRAP, TROOP, trapDamage, trapSeconds } from '@ironvow/config';
import { describe, expect, it } from 'vitest';
import type { BaseSnapshot, BattleArmy, DeployCommand, SnapshotBuilding } from '@ironvow/types';
import { createBattle, simulate } from '../src/index.js';

/**
 * Traps.
 *
 * The only thing on a defending base an attacker cannot see before they commit,
 * which makes them the first thing that ever made laying out a base a decision.
 * The rules worth pinning are the structural ones: a trap is not a building, it
 * fires once, it fires for the defender only, and none of it breaks the replay.
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

/** A Keep with a trap on the road to it. Raiders come in from the west. */
const field = (trap: 'spike' | 'snare' | null) => snap([
  b('k', 'keep', 30, 29, 3),
  ...(trap ? [b('t', trap, 24, 30, 3)] : []),
]);

function run(base: BaseSnapshot, n: number, seconds: number) {
  const commands: DeployCommand[] = Array.from({ length: n }, (_, i) => ({
    tickIndex: i, troopType: 'raider' as const, gx: 18, gy: 30 + (i % 3) * 0.3,
  }));
  const battle = createBattle({ snapshot: base, commands, army: { ...NONE, raider: n }, seed: 5 });
  for (let i = 0; i < TICKS_PER_SECOND * seconds && !battle.step(); i++) { /* the clock */ }
  expect(battle.result().rejected).toEqual([]);
  return battle;
}

describe('a trap is not a building', () => {
  it('cannot be attacked, and never appears among the structures', () => {
    const battle = run(field('spike'), 1, 1);
    expect(battle.structs.map((s) => s.t)).toEqual(['keep']);
  });

  it('counts for nothing towards destruction', () => {
    // Flattening a hold with traps in it must still be a hundred per cent, or
    // a defender could buy their way out of three stars with hardware nobody
    // is allowed to break.
    const withTraps = simulate({
      snapshot: snap([b('k', 'keep', 30, 29, 1), b('t1', 'spike', 24, 30, 1), b('t2', 'snare', 25, 32, 1)]),
      commands: Array.from({ length: 12 }, (_, i) => ({
        tickIndex: i, troopType: 'raider' as const, gx: 26 + (i % 3) * 0.4, gy: 26,
      })),
      army: { ...NONE, raider: 12 }, seed: 5,
    });
    expect(withTraps.stars).toBe(3);
    expect(withTraps.destroyedPct).toBe(1);
  });

  it('does not draw a Lancer across the map, the way a defence would', () => {
    // A Lancer prefers defensive buildings. A trap must not read as one, or a
    // hold could bait the whole warband into a corner with a cheap hole.
    const battle = createBattle({
      snapshot: snap([b('k', 'keep', 30, 29, 3), b('t', 'spike', 50, 50, 3)]),
      commands: [{ tickIndex: 0, troopType: 'lancer', gx: 20, gy: 29 }],
      army: { ...NONE, lancer: 1 }, seed: 5,
    });
    for (let i = 0; i < TICKS_PER_SECOND * 8; i++) battle.step();
    const u = battle.units[0]!;
    // Walking east towards the Keep, not south-east towards the trap.
    expect(u.x).toBeGreaterThan(20);
    expect(u.y).toBeLessThan(35);
  });
});

describe('a Spike Trap springs once, on whoever walked onto it', () => {
  it('hurts the men who were standing on it', () => {
    const battle = run(field('spike'), 6, 8);
    expect(battle.units.filter((u) => u.hp < u.maxHp).length).toBeGreaterThan(1);
  });

  it('leaves an identical raid with no trap untouched at that point', () => {
    const clean = run(field(null), 6, 4);
    expect(clean.units.every((u) => u.hp === u.maxHp)).toBe(true);
  });

  it('fires exactly once, however many more walk over it', () => {
    const battle = run(field('spike'), 8, 20);
    const t = battle.traps()[0]!;
    expect(t.sprung).toBeGreaterThanOrEqual(0);
    // Still one trap, still one spring tick: nothing re-arms mid-raid.
    expect(battle.traps()).toHaveLength(1);
    const at = t.sprung;
    for (let i = 0; i < TICKS_PER_SECOND * 5; i++) battle.step();
    expect(battle.traps()[0]!.sprung).toBe(at);
  });

  it('hurts enough to matter, but not enough to be a Cannon', () => {
    // A trap that one-shots a Raider at level 1 makes the guess a coin toss for
    // the whole raid; one that tickles is a waste of a cell.
    expect(trapDamage('spike', 1)).toBeGreaterThan(TROOP.raider.hp * 0.8);
    expect(trapDamage('spike', 1)).toBeLessThan(TROOP.lancer.hp);
    expect(trapDamage('spike', 9)).toBeGreaterThan(trapDamage('spike', 1));
    // A level 9 Spike Trap should be able to finish a Ram and no more.
    expect(trapDamage('spike', 9)).toBeLessThan(TROOP.ram.hp * 1.2);
  });
});

describe('a Snare holds them instead of hurting them', () => {
  it('does no damage at all', () => {
    const battle = run(field('snare'), 6, 8);
    expect(battle.traps()[0]!.sprung).toBeGreaterThanOrEqual(0);
    expect(battle.units.every((u) => u.hp === u.maxHp)).toBe(true);
    expect(TRAP.snare.dmg).toBe(0);
  });

  it('costs them ground: the same raid is further along without one', () => {
    const held = run(field('snare'), 4, 5).units[0]!;
    const free = run(field(null), 4, 5).units[0]!;
    expect(held.x).toBeLessThan(free.x);
  });

  it('wears off, so it is a delay and not a wall', () => {
    const battle = run(field('snare'), 4, 3);
    const sprung = battle.traps()[0]!.sprung;
    expect(sprung).toBeGreaterThanOrEqual(0);
    const before = battle.units[0]!.x;
    // Well past the snare's life at level 3.
    for (let i = 0; i < TICKS_PER_SECOND * (trapSeconds('snare', 3) + 6); i++) battle.step();
    expect(battle.units[0]!.x).toBeGreaterThan(before);
  });

  it('never stops anybody dead, however many overlap', () => {
    // Snares do not stack: the deepest wins. A cluster is a wider net, not a
    // troop frozen in place, which would be a win button rather than a trap.
    expect(TRAP.snare.slow).toBeGreaterThan(0);
    const battle = run(snap([
      b('k', 'keep', 30, 29, 3),
      b('t1', 'snare', 24, 30, 3), b('t2', 'snare', 25, 30, 3), b('t3', 'snare', 26, 30, 3),
    ]), 3, 4);
    const at = battle.units[0]!.x;
    for (let i = 0; i < TICKS_PER_SECOND * 2; i++) battle.step();
    expect(battle.units[0]!.x).toBeGreaterThan(at);
  });
});

describe('a trap is the defender\'s, and only the defender\'s', () => {
  it('is not sprung by the garrison standing on it', () => {
    // Donated troops stand in the hold. If they set off its traps, giving a
    // clanmate troops would be an attack on them.
    const guarded: BaseSnapshot = {
      ...snap([b('k', 'keep', 30, 29, 3), b('t', 'spike', 26, 30, 3)]),
      garrison: [{ type: 'raider', x: 26.5, y: 30.5, scale: 1 }],
    };
    const battle = createBattle({
      snapshot: guarded, commands: [], army: { ...NONE, raider: 2 }, seed: 5,
    });
    for (let i = 0; i < TICKS_PER_SECOND * 3; i++) battle.step();
    expect(battle.traps()[0]!.sprung).toBe(-1);
    expect(battle.units.every((u) => u.hp === u.maxHp)).toBe(true);
  });
});

describe('none of it breaks the replay', () => {
  const input = () => ({
    snapshot: snap([
      b('k', 'keep', 30, 29, 3),
      b('t1', 'spike', 24, 30, 4), b('t2', 'snare', 26, 31, 4),
    ]),
    commands: Array.from({ length: 6 }, (_, i) => ({
      tickIndex: i * 4, troopType: 'raider' as const, gx: 18, gy: 30 + (i % 3) * 0.3,
    })),
    army: { ...NONE, raider: 6 },
    seed: 77,
  });

  it('is byte-identical across runs', () => {
    expect(simulate(input()).checksum).toBe(simulate(input()).checksum);
  });

  it('folds the springing into the checksum, so a moved trap is a different fight', () => {
    const moved = input();
    moved.snapshot.buildings[1] = b('t1', 'spike', 27, 30, 4);
    expect(simulate(moved).checksum).not.toBe(simulate(input()).checksum);
  });

  it('a hold with no traps replays exactly as it always did', () => {
    const plain = { ...input(), snapshot: snap([b('k', 'keep', 30, 29, 3)]) };
    expect(() => simulate(plain)).not.toThrow();
    expect(simulate(plain).checksum).toBe(simulate(plain).checksum);
  });
});
