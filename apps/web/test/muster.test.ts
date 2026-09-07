import { TYPES, armyCapOf, campSlots } from '@ironvow/config';
import { describe, expect, it, vi } from 'vitest';
import { MUSTER_MAX, musterOf } from '../lib/game/render';
import type { ClientBuilding, PlayerState } from '../lib/game/types';
import { createWorld, type World, type WorldEvents } from '../lib/game/world';

/**
 * The Muster Field.
 *
 * A warband was a number on a sheet; now it stands on ground the player bought
 * and placed. The part worth a test is not the paint but the arithmetic: every
 * figure has to land inside the four cells of the field it belongs to, because
 * a figure half a tile outside the railing reads as a troop that wandered off
 * rather than an army that is mustered.
 */

function silent(): WorldEvents {
  return {
    onSelect: vi.fn(), onModeChange: vi.fn(), onToast: vi.fn(),
    onPlayerChanged: vi.fn(), onBattleEnd: vi.fn(),
    onPlacementChanged: vi.fn(), onPlacementCommit: vi.fn(), onCameraMoved: vi.fn(),
  };
}

const FIELDS: [number, number][] = [[26, 32], [32, 32], [38, 32]];

function hold(army: Partial<Record<string, number>>, fields = 1): World {
  const w = createWorld(silent());
  const buildings: ClientBuilding[] = [
    { id: 'k', type: 'keep', gx: 26, gy: 26, level: 1, stock: 0, completesAt: null, upgradingTo: null },
  ];
  for (let i = 0; i < fields; i++) {
    const [gx, gy] = FIELDS[i]!;
    buildings.push({
      id: `c${i}`, type: 'camp', gx, gy, level: 1, stock: 0,
      completesAt: null, upgradingTo: null,
    });
  }
  w.player = { buildings, army } as unknown as PlayerState;
  return w;
}

describe('the muster', () => {
  it('stays empty until there is both a field and an army', () => {
    expect(musterOf(hold({ raider: 8 }, 0)).troops).toHaveLength(0);
    expect(musterOf(hold({})).troops).toHaveLength(0);
    expect(musterOf(hold({ raider: 0 })).troops).toHaveLength(0);
  });

  it('leaves a field that is still going up empty', () => {
    const w = hold({ raider: 6 });
    const field = w.player!.buildings.find((b) => b.type === 'camp')!;
    field.completesAt = new Date(Date.now() + 60_000).toISOString();
    expect(musterOf(w).troops).toHaveLength(0);
  });

  it('keeps every figure inside the four cells of its own field', () => {
    const { troops } = musterOf(hold({ raider: 9 }));
    const [fx, fy] = FIELDS[0]!;
    const s = TYPES.camp.s;
    for (const t of troops) {
      expect(t.gx).toBeGreaterThanOrEqual(fx);
      expect(t.gx).toBeLessThanOrEqual(fx + s);
      expect(t.gy).toBeGreaterThanOrEqual(fy);
      expect(t.gy).toBeLessThanOrEqual(fy + s);
    }
  });

  it('leaves the corners to the tents and the middle to the warband', () => {
    // The field draws a tent in each of its four corners, so a figure has to
    // stand clear of them or it is billeted inside one.
    const { troops } = musterOf(hold({ raider: 6 }));
    const [fx, fy] = FIELDS[0]!;
    for (const t of troops) {
      expect(t.gx).toBeGreaterThanOrEqual(fx + 0.9);
      expect(t.gy).toBeGreaterThanOrEqual(fy + 0.9);
      expect(t.gx).toBeLessThanOrEqual(fx + TYPES.camp.s - 0.9);
      expect(t.gy).toBeLessThanOrEqual(fy + TYPES.camp.s - 0.9);
    }
  });

  it('centres a half-empty field rather than filling one corner of it', () => {
    const { troops } = musterOf(hold({ raider: 1 }));
    const [fx, fy] = FIELDS[0]!;
    const s = TYPES.camp.s;
    expect(troops).toHaveLength(1);
    expect(troops[0]!.gx).toBeCloseTo(fx + s / 2, 6);
    expect(troops[0]!.gy).toBeCloseTo(fy + s / 2, 6);
  });

  it('deals the warband round the fields instead of filling one', () => {
    const { troops } = musterOf(hold({ raider: 12 }, 2));
    expect(troops).toHaveLength(12);
    const onFirst = troops.filter((t) => t.gx < 32).length;
    expect(onFirst).toBe(6);
  });

  it('draws a crowd, not a parade: each field takes six and no more', () => {
    // Two ranks of three. A level-9 field has room for thirty-two troops, and
    // drawing thirty-two would hide the field they are standing on.
    expect(musterOf(hold({ raider: 200 })).troops).toHaveLength(6);
    expect(musterOf(hold({ raider: 200 }, 3)).troops).toHaveLength(18);
  });

  it('never draws more figures than the hold as a whole is allowed', () => {
    const w = hold({ raider: 500 }, 3);
    // Ten fields' worth of roster, dealt across three: the global cap is what
    // keeps a maxed hold from putting a hundred sprites in one frame.
    expect(musterOf(w).troops.length).toBeLessThanOrEqual(MUSTER_MAX);
  });

  it('dresses each figure in the kit its War Lab paid for', () => {
    const w = hold({ raider: 2, archer: 2 });
    w.progressionLevels = { raider: 4, archer: 2 };
    const { troops } = musterOf(w);
    expect(troops.filter((t) => t.type === 'raider').every((t) => t.level === 4)).toBe(true);
    expect(troops.filter((t) => t.type === 'archer').every((t) => t.level === 2)).toBe(true);
  });
});

describe('warband room comes from the fields', () => {
  it('counts Muster Fields and nothing else', () => {
    const owned = [
      { type: 'camp' as const, level: 1 },
      { type: 'camp' as const, level: 3 },
      { type: 'barr' as const, level: 9 },
    ];
    expect(armyCapOf(owned)).toBe(campSlots(1) + campSlots(3));
  });

  it('opens a new hold with room for the tutorial and then some', () => {
    // Two level-1 fields is what a hold is created with; the tutorial asks for
    // five Raiders at one slot each.
    expect(campSlots(1) * 2).toBeGreaterThanOrEqual(14);
  });
});
