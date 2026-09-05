import { describe, expect, it } from 'vitest';
import {
  BASE_STORAGE,
  CAPACITY,
  OFFLINE_CAP_SECONDS,
  START_GOLD,
  START_IRON,
  costOf,
  mineRate,
  stockCapOf,
  storageCapOf,
} from '@ironvow/config';
import { accrueProduction, collectStock, grant } from '../src/domain/production.js';
import { planBuild, planTrain, planUpgrade } from '../src/domain/commands.js';
import type { PlayerView } from '../src/domain/commands.js';

/**
 * Economy properties (spec S12).
 *
 * These run on the pure domain layer, so they exercise the same code the
 * routes call without needing a database. The invariants asserted here are the
 * ones that make the server authoritative: resources cannot exceed capacity,
 * cannot go negative, and cannot grow without the server itself deciding to
 * grant them.
 */

const mid = 26;

function player(over: Partial<PlayerView> = {}): PlayerView {
  return {
    gold: 900n,
    iron: 320n,
    buildings: [
      { id: 'k', type: 'keep', gx: mid, gy: mid, level: 1 },
      { id: 'm', type: 'mine', gx: mid - 3, gy: mid, level: 1 },
      { id: 'b', type: 'barr', gx: mid + 3, gy: mid, level: 1 },
    ],
    army: {},
    queue: [],
    ...over,
  };
}

describe('starting position', () => {
  it('leaves room for the first collection (bug #1)', () => {
    expect(START_GOLD).toBeLessThan(BASE_STORAGE);
    expect(START_IRON).toBeLessThan(BASE_STORAGE);
  });
});

describe('production accrual', () => {
  it('pays the documented rate per minute', () => {
    const out = accrueProduction({
      lastTickAt: new Date(0),
      now: new Date(60_000),
      buildings: [{ id: 'm', type: 'mine', level: 3, stock: 0 }],
    });
    expect(out.updated[0]!.stock).toBeCloseTo(mineRate(3), 9);
  });

  it('stops at the twelve-minute buffer however long you were away', () => {
    const out = accrueProduction({
      lastTickAt: new Date(0),
      now: new Date(50 * 3_600_000),
      buildings: [{ id: 'm', type: 'mine', level: 5, stock: 0 }],
    });
    expect(out.updated[0]!.stock).toBe(stockCapOf('mine', 5));
  });

  it('never pays more than the four-hour offline window', () => {
    const out = accrueProduction({
      lastTickAt: new Date(0),
      now: new Date(99 * 3_600_000),
      buildings: [],
    });
    expect(out.elapsedSeconds).toBe(OFFLINE_CAP_SECONDS);
  });

  it('pays nothing for a clock that runs backwards', () => {
    const out = accrueProduction({
      lastTickAt: new Date(10_000),
      now: new Date(0),
      buildings: [{ id: 'm', type: 'mine', level: 1, stock: 0 }],
    });
    expect(out.elapsedSeconds).toBe(0);
    expect(out.updated).toEqual([]);
  });

  it('is monotonic: a longer absence is never worth less', () => {
    let previous = -1;
    for (const minutes of [0, 1, 5, 12, 60, 240, 1440]) {
      const out = accrueProduction({
        lastTickAt: new Date(0),
        now: new Date(minutes * 60_000),
        buildings: [{ id: 'm', type: 'mine', level: 4, stock: 0 }],
      });
      const stock = out.updated[0]?.stock ?? 0;
      expect(stock).toBeGreaterThanOrEqual(previous);
      previous = stock;
    }
  });
});

describe('collection', () => {
  it('clamps to storage capacity and reports what overflowed', () => {
    const out = collectStock({
      gold: BigInt(BASE_STORAGE - 10),
      iron: 0n,
      buildings: [{ id: 'm', type: 'mine', level: 9, stock: 5000 }],
    });
    expect(out.gold).toBe(BigInt(BASE_STORAGE));
    expect(out.collected.gold).toBe(10);
    expect(out.wasted.gold).toBe(4990);
  });

  it('counts a Vault toward capacity', () => {
    const buildings = [
      { id: 'm', type: 'mine' as const, level: 9, stock: 100_000 },
      { id: 's', type: 'store' as const, level: 3, stock: 0 },
    ];
    const cap = BASE_STORAGE + CAPACITY(3);
    expect(storageCapOf(buildings.map((b) => ({ type: b.type, level: b.level })))).toBe(cap);
    const out = collectStock({ gold: 0n, iron: 0n, buildings });
    expect(out.gold).toBe(BigInt(cap));
  });

  it('ignores a producer holding less than a whole unit', () => {
    const out = collectStock({
      gold: 0n, iron: 0n,
      buildings: [{ id: 'm', type: 'mine', level: 1, stock: 0.4 }],
    });
    expect(out.cleared).toEqual([]);
    expect(out.gold).toBe(0n);
  });

  it('never lets a balance exceed capacity across any sequence of collections', () => {
    const buildings = [
      { id: 'm1', type: 'mine' as const, level: 9, stock: 0 },
      { id: 'm2', type: 'mine' as const, level: 7, stock: 0 },
      { id: 'f', type: 'forge' as const, level: 6, stock: 0 },
      { id: 's', type: 'store' as const, level: 2, stock: 0 },
    ];
    const cap = BigInt(storageCapOf(buildings.map((b) => ({ type: b.type, level: b.level }))));
    let gold = 0n;
    let iron = 0n;
    for (let round = 0; round < 200; round++) {
      const filled = buildings.map((b) => ({ ...b, stock: stockCapOf(b.type, b.level) }));
      const out = collectStock({ gold, iron, buildings: filled });
      gold = out.gold;
      iron = out.iron;
      expect(gold).toBeLessThanOrEqual(cap);
      expect(iron).toBeLessThanOrEqual(cap);
      expect(gold).toBeGreaterThanOrEqual(0n);
      expect(iron).toBeGreaterThanOrEqual(0n);
    }
    expect(gold).toBe(cap);
  });
});

describe('grants', () => {
  it('clamps a raid payout to capacity and refuses a negative one', () => {
    const owned = [{ type: 'keep' as const, level: 1 }];
    expect(grant(0n, 0n, 999_999, 999_999, owned)).toEqual({
      gold: BigInt(BASE_STORAGE), iron: BigInt(BASE_STORAGE),
    });
    expect(grant(100n, 100n, -500, -500, owned)).toEqual({ gold: 100n, iron: 100n });
  });
});

describe('costs are derived, never accepted', () => {
  it('prices the nth building of a type at 1.55^owned', () => {
    expect(costOf('mine', 0, 0)).toEqual({ g: 150, i: 0 });
    expect(costOf('mine', 0, 1)).toEqual({ g: Math.round(150 * 1.55), i: 0 });
    expect(costOf('mine', 0, 2)).toEqual({ g: Math.round(150 * 1.55 * 1.55), i: 0 });
  });

  it('refuses a build the player cannot pay for', () => {
    expect(planBuild(player({ gold: 10n }), 'mine', 10, 10)).toEqual({ ok: false, error: 'cannotAfford' });
  });

  it('refuses a build past the Keep-level count limit', () => {
    // A Keep 1 permits three mines; the player already has three.
    const buildings = [
      { id: 'k', type: 'keep' as const, gx: mid, gy: mid, level: 1 },
      { id: 'm1', type: 'mine' as const, gx: 6, gy: 6, level: 1 },
      { id: 'm2', type: 'mine' as const, gx: 9, gy: 6, level: 1 },
      { id: 'm3', type: 'mine' as const, gx: 12, gy: 6, level: 1 },
    ];
    expect(planBuild(player({ gold: 10_000_000n, buildings }), 'mine', 15, 6))
      .toEqual({ ok: false, error: 'atCountLimit' });
  });

  it('refuses to raise anything above the Keep', () => {
    expect(planUpgrade(player({ gold: 10_000_000n, iron: 10_000_000n }), 'm'))
      .toEqual({ ok: false, error: 'atKeepCap' });
  });

  it('stops the Keep at level 9', () => {
    const buildings = [{ id: 'k', type: 'keep' as const, gx: mid, gy: mid, level: 9 }];
    expect(planUpgrade(player({ gold: 10n ** 12n, iron: 10n ** 12n, buildings }), 'k'))
      .toEqual({ ok: false, error: 'atMaxLevel' });
  });
});

describe('training', () => {
  it('refuses a troop the Barracks cannot unlock yet', () => {
    expect(planTrain(player({ gold: 10_000n, iron: 10_000n }), 'lancer'))
      .toEqual({ ok: false, error: 'barracksTooLow' });
  });

  it('refuses to overfill the warband', () => {
    // One Barracks at level 1 is 14 slots; 14 raiders fill it exactly.
    const p = player({ gold: 10_000n, iron: 10_000n, army: { raider: 14 } });
    expect(planTrain(p, 'raider')).toEqual({ ok: false, error: 'warbandFull' });
  });

  it('counts queued troops against the warband, not just trained ones', () => {
    const p = player({ gold: 10_000n, iron: 10_000n, army: { raider: 10 }, queue: ['raider', 'raider', 'raider', 'raider'] });
    expect(planTrain(p, 'raider')).toEqual({ ok: false, error: 'warbandFull' });
  });
});
