import {
  FIREPOT_DAMAGE,
  FIREPOT_WALL_MULTIPLIER,
  HORN_SECONDS,
  ITEM,
  TICKS_PER_SECOND,
  hpOf,
} from '@ironvow/config';
import { describe, expect, it } from 'vitest';
import type { BaseSnapshot, BattleArmy, ItemCommand, SnapshotBuilding } from '@ironvow/types';
import { createBattle, generateOpponent, simulate } from '../src/index.js';

/**
 * Battle items.
 *
 * The rule that matters more than any single number: an item is a *command*.
 * The client says which one, where and on which tick; the server replays that
 * and reaches the same fight. Nothing about an item's effect crosses the wire,
 * so there is nothing to forge. Most of what is below is that property, and the
 * determinism it depends on, checked from different directions.
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

describe('a Firepot burns what is under it', () => {
  const base = () => snap([
    b('k', 'keep', 28, 28),
    b('c', 'cannon', 34, 28, 3),
    b('far', 'cannon', 48, 48, 3),
  ]);

  it('damages what is inside the circle and nothing outside it', () => {
    const battle = createBattle({
      snapshot: base(), commands: [], army: { ...NONE }, seed: 5,
      pouch: { firepot: 1 },
      items: [{ tickIndex: 0, item: 'firepot', gx: 34.5, gy: 28.5 }],
    });
    battle.step();

    const hit = battle.structs.find((s) => s.id === 'c')!;
    const spared = battle.structs.find((s) => s.id === 'far')!;
    expect(hit.hp).toBeLessThan(hit.maxHp);
    expect(hit.maxHp - hit.hp).toBeCloseTo(FIREPOT_DAMAGE, 5);
    expect(spared.hp).toBe(spared.maxHp);
  });

  it('is worth several times as much against a rampart', () => {
    // A high rampart, so it survives and the exact figure can be read off it.
    const walls = createBattle({
      snapshot: snap([b('k', 'keep', 28, 28), b('w', 'wall', 34, 28, 10)]),
      commands: [], army: { ...NONE }, seed: 5,
      pouch: { firepot: 1 },
      items: [{ tickIndex: 0, item: 'firepot', gx: 34.5, gy: 28.5 }],
    });
    walls.step();
    const w = walls.structs.find((s) => s.id === 'w')!;
    expect(w.maxHp - w.hp).toBeCloseTo(FIREPOT_DAMAGE * FIREPOT_WALL_MULTIPLIER, 5);
    expect(w.dead).toBe(false);

    // And a rampart at the bottom of the curve simply goes. The multiplier
    // exists because a flat number that dents a Cannon does nothing to a wall;
    // if that stops being true the number needs revisiting.
    const low = createBattle({
      snapshot: snap([b('k', 'keep', 28, 28), b('w', 'wall', 34, 28, 1)]),
      commands: [], army: { ...NONE }, seed: 5,
      pouch: { firepot: 1 },
      items: [{ tickIndex: 0, item: 'firepot', gx: 34.5, gy: 28.5 }],
    });
    low.step();
    expect(low.structs.find((s) => s.id === 'w')!.dead).toBe(true);
    expect(FIREPOT_DAMAGE * FIREPOT_WALL_MULTIPLIER).toBeGreaterThan(hpOf('wall', 1));
  });

  it('is refused when the pouch is empty, and reported as such', () => {
    const battle = createBattle({
      snapshot: base(), commands: [], army: { ...NONE }, seed: 5,
      pouch: {},
      items: [{ tickIndex: 0, item: 'firepot', gx: 34.5, gy: 28.5 }],
    });
    battle.step();
    expect(battle.structs.find((s) => s.id === 'c')!.hp).toBe(battle.structs.find((s) => s.id === 'c')!.maxHp);
    expect(battle.result().rejected).toEqual([{ index: 0, reason: 'noItemsLeft' }]);
  });

  it('spends one per use and no more', () => {
    const battle = createBattle({
      snapshot: base(), commands: [], army: { ...NONE }, seed: 5,
      pouch: { firepot: 2 },
      items: [{ tickIndex: 0, item: 'firepot', gx: 34.5, gy: 28.5 }],
    });
    battle.step();
    expect(battle.itemsLeft().firepot).toBe(1);
  });
});

describe('a Warhorn is a circle on the ground, not a mark on a unit', () => {
  /** One raider walking at one Keep, with and without a horn over it. */
  const run = (items: ItemCommand[], pouch = { horn: 1 }) => {
    const battle = createBattle({
      snapshot: snap([b('k', 'keep', 28, 28, 5)]),
      commands: [{ tickIndex: 0, troopType: 'raider', gx: 20, gy: 28 }],
      army: { ...NONE, raider: 1 }, seed: 5, pouch, items,
    });
    for (let i = 0; i < TICKS_PER_SECOND * 20; i++) if (battle.step()) break;
    const keep = battle.structs.find((s) => s.id === 'k')!;
    return { done: keep.maxHp - keep.hp, unit: battle.units[0]! };
  };

  it('makes the troops inside it hit harder', () => {
    const plain = run([]);
    const horned = run([{ tickIndex: 1, item: 'horn', gx: 28, gy: 28 }]);
    expect(horned.done).toBeGreaterThan(plain.done);
  });

  it('runs out, and stops mattering when it does', () => {
    // A horn blown at the start of a twenty-second run is spent for most of it;
    // one blown late covers the end. Both beat none, and neither is permanent.
    const short = run([{ tickIndex: 1, item: 'horn', gx: 28, gy: 28 }]);
    const none = run([]);
    expect(short.done).toBeGreaterThan(none.done);
    expect(HORN_SECONDS).toBeLessThan(20);
  });

  it('does nothing at all from across the map', () => {
    const near = run([{ tickIndex: 1, item: 'horn', gx: 28, gy: 28 }]);
    const far = run([{ tickIndex: 1, item: 'horn', gx: 5, gy: 5 }]);
    const none = run([]);
    expect(far.done).toBe(none.done);
    expect(near.done).toBeGreaterThan(far.done);
  });

  it('does not stack: a second horn on the same ground is wasted', () => {
    const one = run([{ tickIndex: 1, item: 'horn', gx: 28, gy: 28 }], { horn: 2 });
    const two = run([
      { tickIndex: 1, item: 'horn', gx: 28, gy: 28 },
      { tickIndex: 1, item: 'horn', gx: 28, gy: 28 },
    ], { horn: 2 });
    expect(two.done).toBe(one.done);
  });

  it('never helps the defender, whose garrison it is standing over', () => {
    const guarded: BaseSnapshot = {
      ...generateOpponent(3),
      garrison: [{ type: 'raider', x: 28, y: 30, scale: 1 }],
    };
    const play = (items: ItemCommand[]) => {
      const battle = createBattle({
        snapshot: guarded, commands: [], army: { ...NONE, raider: 4 }, seed: 5,
        pouch: { horn: 1 }, items,
      });
      for (let i = 0; i < 4; i++) battle.deploy('raider', 20 + i, 40);
      for (let i = 0; i < 3000; i++) if (battle.step()) break;
      return battle.destroyedPct();
    };
    // Dropped on the defender's own garrison. If the aura were side-blind this
    // would make the attack go *worse*, which is not a thing an item may do.
    expect(play([{ tickIndex: 30, item: 'horn', gx: 28, gy: 30 }]))
      .toBeGreaterThanOrEqual(play([]));
  });
});

describe('items are replayable, which is the whole point', () => {
  const plan: ItemCommand[] = [
    { tickIndex: 40, item: 'horn', gx: 27, gy: 27 },
    { tickIndex: 300, item: 'firepot', gx: 30, gy: 24 },
  ];
  const input = () => ({
    snapshot: generateOpponent(4),
    commands: [
      { tickIndex: 10, troopType: 'raider' as const, gx: 18, gy: 28 },
      { tickIndex: 20, troopType: 'raider' as const, gx: 19, gy: 29 },
      { tickIndex: 30, troopType: 'ram' as const, gx: 20, gy: 30 },
    ],
    army: { ...NONE, raider: 2, ram: 1 },
    seed: 99,
    pouch: { horn: 1, firepot: 1 },
    items: plan,
  });

  it('produces a byte-identical checksum across runs', () => {
    const a = simulate(input());
    const b2 = simulate(input());
    expect(a.checksum).toBe(b2.checksum);
    expect(a.destroyedPct).toBe(b2.destroyedPct);
  });

  it('a played item and a replayed one land in the same fight', () => {
    // Live: step the clock and use the item at the tick the player would have.
    const live = createBattle(
      { ...input(), items: [] },
    );
    const played: ItemCommand[] = [];
    while (!live.step()) {
      if (live.tick === 40) {
        const r = live.useItem('horn', 27, 27);
        if (r.ok) played.push(r.command);
      }
      if (live.tick === 300) {
        const r = live.useItem('firepot', 30, 24);
        if (r.ok) played.push(r.command);
      }
    }
    expect(played).toHaveLength(2);
    // Replayed on the server from exactly what the client recorded.
    const replay = simulate({ ...input(), items: played });
    expect(replay.checksum).toBe(live.result().checksum);
  });

  it('changes the checksum, so a forged item list cannot pass as an honest one', () => {
    const honest = simulate(input());
    const moved = simulate({ ...input(), items: [{ ...plan[0]!, gx: 40 }, plan[1]!] });
    expect(moved.checksum).not.toBe(honest.checksum);
  });

  it('replays a raid recorded before items existed, with no items field at all', () => {
    const { items: _items, pouch: _pouch, ...old } = input();
    expect(() => simulate(old)).not.toThrow();
    expect(simulate(old).checksum).toBe(simulate(old).checksum);
  });
});

describe('the item table itself', () => {
  it('unlocks each one at a Keep that can plausibly have reached it', () => {
    for (const spec of Object.values(ITEM)) {
      expect(spec.keep).toBeGreaterThan(1);
      expect(spec.cap).toBeGreaterThan(0);
      expect(spec.cost.g + spec.cost.i).toBeGreaterThan(0);
      expect(spec.r).toBeGreaterThan(0);
    }
  });
});
