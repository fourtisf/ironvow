import { TYPES } from '@ironvow/config';
import { describe, expect, it, vi } from 'vitest';
import { MUSTER_MAX, musterOf } from '../lib/game/render';
import type { ClientBuilding, PlayerState } from '../lib/game/types';
import { createWorld, type World, type WorldEvents } from '../lib/game/world';

/**
 * The parade ground.
 *
 * A warband was a number on a sheet; now it stands on the grass in front of
 * the Barracks. The part worth a test is not the paint but the arithmetic:
 * the field is laid out in the projection's own axes, because centring it in
 * grid coordinates — the obvious thing — slides it half its depth to the left
 * of the hall it belongs to. That was the first bug, and it is the one a test
 * catches without a canvas.
 */

function silent(): WorldEvents {
  return {
    onSelect: vi.fn(), onModeChange: vi.fn(), onToast: vi.fn(),
    onPlayerChanged: vi.fn(), onBattleEnd: vi.fn(),
    onPlacementChanged: vi.fn(), onPlacementCommit: vi.fn(), onCameraMoved: vi.fn(),
  };
}

function hold(army: Partial<Record<string, number>>, halls = 1): World {
  const w = createWorld(silent());
  const buildings: ClientBuilding[] = [
    { id: 'k', type: 'keep', gx: 26, gy: 26, level: 1, stock: 0, completesAt: null, upgradingTo: null },
  ];
  for (let i = 0; i < halls; i++) {
    buildings.push({
      id: `b${i}`, type: 'barr', gx: 30 + i * 4, gy: 26, level: 1, stock: 0,
      completesAt: null, upgradingTo: null,
    });
  }
  w.player = { buildings, army } as unknown as PlayerState;
  return w;
}

describe('the muster yard', () => {
  it('stays empty until there is both a hall and an army', () => {
    expect(musterOf(hold({ raider: 8 }, 0)).troops).toHaveLength(0);
    expect(musterOf(hold({})).troops).toHaveLength(0);
    expect(musterOf(hold({ raider: 0 })).yards).toHaveLength(0);
  });

  it('centres the ground under its hall on screen, not in grid space', () => {
    const { yards } = musterOf(hold({ raider: 12 }));
    expect(yards).toHaveLength(1);
    const y = yards[0]!;
    // The screen's horizontal axis is gx - gy. The field's middle and the
    // hall's middle have to agree on it, or the yard sits off to one side.
    const hall = 30 + TYPES.barr.s / 2 - 26 - TYPES.barr.s / 2;
    expect((y.gx + y.w / 2) - (y.gy + y.h / 2)).toBeCloseTo(hall, 6);
  });

  it('starts where the hall ends, so the ranks do not stand on the roof', () => {
    const { yards } = musterOf(hold({ raider: 12 }));
    const y = yards[0]!;
    // Depth is gx + gy; the hall's near corner is at gx + gy + 2 * size.
    expect(y.gx + y.gy).toBeGreaterThanOrEqual(30 + 26 + TYPES.barr.s * 2);
  });

  it('keeps every figure inside the ground it painted', () => {
    const { yards, troops } = musterOf(hold({ raider: 14, archer: 6, lancer: 4 }));
    const y = yards[0]!;
    for (const t of troops) {
      expect(t.gx).toBeGreaterThanOrEqual(y.gx);
      expect(t.gx).toBeLessThanOrEqual(y.gx + y.w);
      expect(t.gy).toBeGreaterThanOrEqual(y.gy);
      expect(t.gy).toBeLessThanOrEqual(y.gy + y.h);
    }
  });

  it('draws a crowd, not a parade: the yard is capped', () => {
    const { troops } = musterOf(hold({ raider: 200 }));
    expect(troops).toHaveLength(MUSTER_MAX);
  });

  it('deals the warband across every hall', () => {
    const { yards, troops } = musterOf(hold({ raider: 12 }, 2));
    expect(yards).toHaveLength(2);
    expect(troops).toHaveLength(12);
    // Each yard got half, so a second Barracks is somewhere the army is.
    const left = troops.filter((t) => t.gx + t.gy < 30 + 26 + 12).length;
    expect(left).toBe(6);
  });

  it('dresses each figure in the kit its War Lab paid for', () => {
    const w = hold({ raider: 2, archer: 2 });
    w.progressionLevels = { raider: 4, archer: 2 };
    const { troops } = musterOf(w);
    expect(troops.filter((t) => t.type === 'raider').every((t) => t.level === 4)).toBe(true);
    expect(troops.filter((t) => t.type === 'archer').every((t) => t.level === 2)).toBe(true);
  });
});
