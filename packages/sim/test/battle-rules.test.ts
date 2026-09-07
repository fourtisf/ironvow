import { describe, expect, it } from 'vitest';
import { TYPES, hpOf, starsFor } from '@ironvow/config';
import type { BaseSnapshot, BattleArmy, DeployCommand, SnapshotBuilding } from '@ironvow/types';
import { createBattle, generateOpponent, simulate } from '../src/index.js';

const NONE: BattleArmy = { raider: 0, archer: 0, lancer: 0, ram: 0, scaler: 0 };

function snap(buildings: SnapshotBuilding[], pool = { g: 1000, i: 500 }): BaseSnapshot {
  return { version: 1, defenderId: 'd', defenderName: 'Test', keepLevel: 1, buildings, pool };
}

function b(id: string, type: SnapshotBuilding['type'], gx: number, gy: number, level = 1): SnapshotBuilding {
  return { id, type, gx, gy, level };
}

describe('star scoring', () => {
  it('follows the prototype thresholds', () => {
    expect(starsFor(0.49, false)).toBe(0);
    expect(starsFor(0.5, false)).toBe(1);
    expect(starsFor(0.2, true)).toBe(1);
    expect(starsFor(0.5, true)).toBe(2);
    expect(starsFor(1, true)).toBe(3);
  });

  it('awards three stars for a total wipe of a one-building base', () => {
    const out = simulate({
      snapshot: snap([b('k', 'keep', 27, 27)]),
      commands: Array.from({ length: 8 }, (_, i): DeployCommand => ({
        tickIndex: i, troopType: 'raider', gx: 22, gy: 27,
      })),
      army: { ...NONE, raider: 8 },
      seed: 1,
    });
    expect(out.endedBy).toBe('wiped');
    expect(out.stars).toBe(3);
    expect(out.destroyedPct).toBe(1);
  });
});

describe('loot', () => {
  it('splits the pool evenly across non-wall structures and pays out as they fall', () => {
    // Four carriers plus a rampart: the rampart carries nothing.
    const out = simulate({
      snapshot: snap(
        [b('k', 'keep', 27, 27), b('m1', 'mine', 22, 27), b('m2', 'mine', 32, 27), b('m3', 'mine', 27, 22), b('w', 'wall', 20, 20)],
        { g: 1000, i: 500 },
      ),
      commands: Array.from({ length: 20 }, (_, i): DeployCommand => ({
        tickIndex: i * 2, troopType: 'raider', gx: 18, gy: 34,
      })),
      army: { ...NONE, raider: 20 },
      seed: 7,
    });
    // Every carrier destroyed pays 1000/4 gold; nothing can exceed the pool.
    expect(out.loot.g).toBeLessThanOrEqual(1000);
    expect(out.loot.i).toBeLessThanOrEqual(500);
    expect(out.loot.g % 250 === 0 || out.loot.g === 1000).toBe(true);
  });

  it('pays nothing for a base of ramparts alone', () => {
    const out = simulate({
      snapshot: snap([b('w1', 'wall', 27, 27), b('w2', 'wall', 28, 27)], { g: 900, i: 900 }),
      commands: [{ tickIndex: 0, troopType: 'ram', gx: 22, gy: 27 }],
      army: { ...NONE, ram: 1 },
      seed: 3,
    });
    expect(out.loot).toEqual({ g: 0, i: 0 });
  });
});

describe('targeting preferences', () => {
  it('sends a lancer past economy buildings to the nearest defence', () => {
    // A mine sits between the lancer and a distant cannon. The cannon dies first.
    const out = simulate({
      snapshot: snap([b('k', 'keep', 40, 40), b('m', 'mine', 20, 27), b('c', 'cannon', 30, 27)]),
      commands: [{ tickIndex: 0, troopType: 'lancer', gx: 14, gy: 27 }],
      army: { ...NONE, lancer: 1 },
      seed: 5,
    }, { timeline: true });
    // structs are indexed in snapshot order: 0 keep, 1 mine, 2 cannon.
    // A lone lancer loses this fight, so assert what it swings at, not what dies.
    const firstHit = out.timeline!.events.find((e) => e.k === 'hitStruct');
    expect(firstHit).toMatchObject({ k: 'hitStruct', struct: 2 });
  });

  it('sends a ram at a rampart before the mine behind it', () => {
    const out = simulate({
      snapshot: snap([b('k', 'keep', 40, 40), b('m', 'mine', 30, 27), b('w', 'wall', 24, 27)]),
      commands: [{ tickIndex: 0, troopType: 'ram', gx: 18, gy: 27 }],
      army: { ...NONE, ram: 1 },
      seed: 5,
    }, { timeline: true });
    const deaths = out.timeline!.events.filter((e) => e.k === 'structDead');
    expect(deaths[0]).toMatchObject({ struct: 2 });
  });
});

describe('ramparts block pathing', () => {
  it('makes a raider stop and break a wall it walks into rather than clipping through', () => {
    // A solid wall run between the raider and the keep it wants.
    const walls = Array.from({ length: 9 }, (_, i) => b('w' + i, 'wall', 24, 23 + i));
    const out = simulate({
      snapshot: snap([b('k', 'keep', 30, 27), ...walls]),
      commands: [{ tickIndex: 0, troopType: 'raider', gx: 18, gy: 27.5 }],
      army: { ...NONE, raider: 1 },
      seed: 11,
    }, { timeline: true });
    const firstDeath = out.timeline!.events.find((e) => e.k === 'structDead');
    // Index 0 is the keep; anything above it is a rampart.
    expect(firstDeath && firstDeath.k === 'structDead' && firstDeath.struct).toBeGreaterThan(0);
  });
});

describe('defences fire back', () => {
  it('kills a lone raider that walks into a high-level cannon', () => {
    const out = simulate({
      snapshot: snap([b('k', 'keep', 40, 40), b('c', 'cannon', 27, 27, 9)]),
      commands: [{ tickIndex: 0, troopType: 'raider', gx: 20, gy: 27 }],
      army: { ...NONE, raider: 1 },
      seed: 13,
    }, { timeline: true });
    expect(out.timeline!.events.some((e) => e.k === 'unitDead')).toBe(true);
    expect(out.stars).toBe(0);
  });
});

describe('ported building maths', () => {
  it('matches the prototype hit point curve', () => {
    expect(hpOf('keep', 1)).toBe(1500);
    expect(hpOf('wall', 1)).toBe(340);
    expect(hpOf('keep', 9)).toBe(Math.round(1500 * TYPES.keep.hpG ** 8));
  });
});

describe('the Scaler goes over ramparts', () => {
  /**
   * Two columns of stout ramparts across the approach, with the Keep behind
   * them. Anything that does not climb has to stop and chew through the wall;
   * a Scaler walks over it and is on the Keep in seconds. This is the whole
   * reason the unit exists, and without a test the climb flag could be deleted
   * and nothing else in the suite would notice.
   */
  const walled = (): BaseSnapshot => snap([
    b('k', 'keep', 27, 27),
    ...Array.from({ length: 9 }, (_, i) => b(`wa${i}`, 'wall', 22, 23 + i, 6)),
    ...Array.from({ length: 9 }, (_, i) => b(`wb${i}`, 'wall', 23, 23 + i, 6)),
  ]);

  /** Seven seconds in — long enough to cross the field, nowhere near long
   *  enough to break a level 6 rampart with ten raiders. */
  const TICKS = 210;

  function play(troopType: 'raider' | 'scaler', count: number) {
    const battle = createBattle({
      snapshot: walled(),
      commands: Array.from({ length: count }, (_, i): DeployCommand => ({
        tickIndex: i, troopType, gx: 18, gy: 27,
      })),
      army: { ...NONE, [troopType]: count },
      seed: 5,
    });
    for (let i = 0; i < TICKS && !battle.step(); i++) { /* run the clock */ }
    const keep = battle.structs.find((s) => s.id === 'k')!;
    return {
      keepDamaged: keep.hp < keep.maxHp,
      wallsAlive: battle.structs.filter((s) => s.t === 'wall' && !s.dead).length,
    };
  }

  it('is on the Keep while a raider is still working on the wall', () => {
    // Same count, same spot, same seed. The only difference is the rampart.
    expect(play('scaler', 10).keepDamaged).toBe(true);
    expect(play('raider', 10).keepDamaged).toBe(false);
  });

  it('leaves every rampart standing, because it never targets one', () => {
    expect(play('scaler', 10).wallsAlive).toBe(18);
  });
});

/**
 * The garrison: troops a clan gave the defender, standing in the hold when a
 * raid opens. They are on the field from the first tick rather than released
 * by a trigger, because a garrison the attacker cannot see coming is one they
 * cannot play around — and playing around it is what makes one worth asking a
 * clanmate for.
 */
describe('a defender fights with what their clan gave them', () => {
  const withGuards = (): BaseSnapshot => ({
    ...generateOpponent(3),
    garrison: [
      { type: 'raider', x: 28, y: 30, scale: 1 },
      { type: 'lancer', x: 30, y: 28, scale: 1 },
    ],
  });

  it('puts them on the field, on the defending side, before a tick runs', () => {
    const battle = createBattle({
      snapshot: withGuards(), commands: [], army: { ...NONE, raider: 8 }, seed: 5,
    });
    const defenders = battle.units.filter((u) => u.side === 'def');
    expect(defenders).toHaveLength(2);
    expect(defenders.map((u) => u.t).sort()).toEqual(['lancer', 'raider']);
  });

  it('an empty garrison leaves the field to the attacker alone', () => {
    const battle = createBattle({
      snapshot: generateOpponent(3), commands: [], army: { ...NONE, raider: 8 }, seed: 5,
    });
    expect(battle.units.filter((u) => u.side === 'def')).toHaveLength(0);
  });

  it('costs the attacker something: the same raid goes worse against one', () => {
    const run = (guarded: boolean) => {
      const battle = createBattle({
        snapshot: guarded ? withGuards() : generateOpponent(3),
        commands: [], army: { ...NONE, raider: 6 }, seed: 5,
      });
      for (let i = 0; i < 6; i++) battle.deploy('raider', 20 + i, 40);
      for (let i = 0; i < 2000; i++) if (battle.step()) break;
      return battle.destroyedPct();
    };
    expect(run(true)).toBeLessThanOrEqual(run(false));
  });
});
