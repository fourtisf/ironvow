import { describe, expect, it } from 'vitest';
import { BUILDABLE_CELLS, IN0, IN1, TYPES } from '@ironvow/config';
import { cellsFree, findFreeSpot, isPlaceable } from '../src/domain/placement.js';
import { planBuild, planMove } from '../src/domain/commands.js';
import type { PlayerView } from '../src/domain/commands.js';

/**
 * Placement rejection, including the move path (spec S12).
 *
 * Build and relocate share one function, so an overlap that a build refuses is
 * refused by a move too. That is the structural fix for prototype bug #2,
 * where two placement paths drifted apart and a move destroyed the building.
 */

const existing = [
  { id: 'k', type: 'keep' as const, gx: 26, gy: 26 },
  { id: 'm', type: 'mine' as const, gx: 23, gy: 26 },
];

describe('the buildable field', () => {
  it('is the 52 x 52 the spec calls for', () => {
    expect(IN1 - IN0).toBe(52);
    expect(BUILDABLE_CELLS).toBe(2704);
  });
});

describe('bounds', () => {
  it('accepts a footprint that sits exactly on each edge', () => {
    expect(isPlaceable('mine', IN0, IN0, [])).toBe(true);
    expect(isPlaceable('mine', IN1 - TYPES.mine.s, IN1 - TYPES.mine.s, [])).toBe(true);
  });

  it('refuses a footprint that hangs over any edge', () => {
    expect(cellsFree('mine', IN0 - 1, 10, [])).toBe('outOfBounds');
    expect(cellsFree('mine', 10, IN0 - 1, [])).toBe('outOfBounds');
    expect(cellsFree('mine', IN1 - 1, 10, [])).toBe('outOfBounds');
    expect(cellsFree('keep', IN1 - 2, 10, [])).toBe('outOfBounds');
  });

  it('refuses fractional coordinates rather than rounding them', () => {
    expect(cellsFree('mine', 10.5, 10, [])).toBe('notInteger');
  });
});

describe('overlap', () => {
  it('refuses a footprint that touches an existing one on any side', () => {
    // The keep occupies 26..28 in both axes.
    for (const [gx, gy] of [[25, 25], [27, 27], [28, 28], [25, 27], [27, 25]] as const) {
      expect(cellsFree('mine', gx, gy, existing)).toBe('overlaps');
    }
  });

  it('accepts a footprint that stops one cell short', () => {
    expect(isPlaceable('mine', 29, 26, existing)).toBe(true);
    expect(isPlaceable('mine', 26, 29, existing)).toBe(true);
  });

  it('lets a wall sit in a one-cell gap', () => {
    const row = [
      { id: 'a', type: 'wall' as const, gx: 10, gy: 10 },
      { id: 'c', type: 'wall' as const, gx: 12, gy: 10 },
    ];
    expect(isPlaceable('wall', 11, 10, row)).toBe(true);
    expect(cellsFree('wall', 12, 10, row)).toBe('overlaps');
  });
});

describe('the move path uses the same rules', () => {
  const player: PlayerView = {
    gold: 1_000_000n,
    iron: 1_000_000n,
    buildings: [
      { id: 'k', type: 'keep', gx: 26, gy: 26, level: 1 },
      { id: 'm', type: 'mine', gx: 23, gy: 26, level: 1 },
      { id: 'b', type: 'barr', gx: 30, gy: 26, level: 1 },
    ],
    army: {},
    queue: [],
  };

  it('lets a building move onto the cells it already occupies', () => {
    expect(planMove(player, 'm', 23, 26)).toEqual({ ok: true, value: { buildingId: 'm', gx: 23, gy: 26 } });
  });

  it('lets a building shuffle one cell into free space', () => {
    expect(planMove(player, 'm', 22, 26).ok).toBe(true);
  });

  it('refuses a move onto another building', () => {
    expect(planMove(player, 'm', 27, 27)).toEqual({ ok: false, error: 'overlaps' });
  });

  it('refuses a move off the field', () => {
    expect(planMove(player, 'm', 0, 0)).toEqual({ ok: false, error: 'outOfBounds' });
  });

  it('moves the Keep like anything else', () => {
    // The specification never said the Keep was fixed, and the first player
    // to try moving it took the refusal for a broken game.
    expect(planMove(player, 'k', 10, 10)).toMatchObject({ ok: true });
  });

  it('refuses to move a building that is not the player’s', () => {
    expect(planMove(player, 'someone-elses', 10, 10)).toEqual({ ok: false, error: 'unknownBuilding' });
  });

  it('agrees with planBuild about which cells are blocked', () => {
    for (let gx = 20; gx < 34; gx++) {
      for (let gy = 20; gy < 34; gy++) {
        const buildOk = planBuild(player, 'mine', gx, gy).ok;
        // A move of the existing mine to the same spot, ignoring its own footprint.
        const moveOk = planMove(player, 'm', gx, gy).ok;
        // They differ only where the mine's own cells are: a build cannot go
        // there, a move of that same mine can.
        const onItself = gx >= 22 && gx <= 24 && gy >= 25 && gy <= 27;
        if (!onItself) expect(moveOk).toBe(buildOk);
      }
    }
  });
});

describe('findFreeSpot', () => {
  it('finds the origin when it is clear', () => {
    expect(findFreeSpot('mine', 10, 10, [])).toEqual({ gx: 10, gy: 10 });
  });

  it('walks outward when the origin is taken', () => {
    const spot = findFreeSpot('mine', 26, 26, existing);
    expect(spot).not.toBeNull();
    expect(isPlaceable('mine', spot!.gx, spot!.gy, existing)).toBe(true);
  });
});
