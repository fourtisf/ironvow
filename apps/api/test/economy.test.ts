import { describe, expect, it } from 'vitest';
import {
  BASE_STORAGE,
  CAPACITY,
  OFFLINE_CAP_SECONDS,
  START_GOLD,
  START_IRON,
  KEEP_MAX,
  MAX_CAMPS,
  STARTING_CAMPS,
  campSlots,
  capOf,
  costOf,
  lootCarriers,
  mineRate,
  stockCapOf,
  storageCapOf,
  QUESTS,
  TROOP,
  TYPES,
} from '@ironvow/config';
import { snapshotBase } from '../src/domain/raid.js';
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
      // Warband room comes from the fields, so a fixture without them has a
      // capacity of zero — under which every training assertion below passes
      // for the wrong reason. See CAMP_NOTE in @ironvow/config.
      { id: 'c1', type: 'camp', gx: mid - 2, gy: mid + 4, level: 1 },
      { id: 'c2', type: 'camp', gx: mid + 3, gy: mid + 4, level: 1 },
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

  /*
   * The larger sibling of bug #1, and the easier one to reintroduce: raise a
   * production rate or the stock buffer, leave storage alone, and a player who
   * was away overnight is shown a full pouch and silently loses most of it.
   * Asserted at the worst moment — level 1, no Vault, the starting purse still
   * untouched, which is the only point where a player cannot make room.
   */
  it('lets a new player bank a full producer, not just part of one', () => {
    const room = BASE_STORAGE - Math.max(START_GOLD, START_IRON);
    expect(stockCapOf('mine', 1)).toBeLessThanOrEqual(room);
    expect(stockCapOf('forge', 1)).toBeLessThanOrEqual(room);
  });

  /*
   * ALFA hit this live: 9.3K gold, 20 iron, and a task list saying "raise a
   * Cannon" — which costs 80 iron. Iron has one buildable source and the order
   * that puts it up was seventh.
   */
  it('never asks for iron before the order that produces it', () => {
    const forgeAt = QUESTS.findIndex(
      (q) => q.metric.kind === 'buildingCount' && q.metric.type === 'forge',
    );
    const ironAt = QUESTS.findIndex((q) => {
      const m = q.metric;
      if (m.kind === 'buildingCount') return TYPES[m.type].base.i > 0;
      if (m.kind === 'keepLevel') return TYPES.keep.up.i > 0;
      return false;
    });
    expect(forgeAt).toBeGreaterThanOrEqual(0);
    expect(ironAt).toBeGreaterThan(forgeAt);
  });

  it('leaves the Iron Forge payable in gold alone', () => {
    // It is the only way out of an empty iron purse.
    expect(costOf('forge', 0, 0).i).toBe(0);
  });

  it('covers the tutorial and the War Orders that follow it', () => {
    // The four coach steps cost nothing. These are the purchases the first
    // nine War Orders ask for, before a single collection or any raid loot.
    const asked = costOf('mine', 0, 1).g          // a second Gold Mine
      + costOf('forge', 0, 0).g                   // the Iron Forge
      + costOf('cannon', 0, 0).g
      + TROOP.raider.cost.g * 5
      + costOf('keep', 1, 0).g
      + Array.from({ length: 8 }, (_, n) => costOf('wall', 0, n).g)
        .reduce((a, b) => a + b, 0);              // eight Ramparts
    expect(asked).toBeLessThan(START_GOLD);

    // And the same in iron, which is the one that ran out.
    const iron = costOf('cannon', 0, 0).i
      + costOf('keep', 1, 0).i
      + Array.from({ length: 8 }, (_, n) => costOf('wall', 0, n).i)
        .reduce((a, b) => a + b, 0);
    expect(iron).toBeLessThan(START_IRON);
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
  it('clamps a raid payout to capacity and reports what it threw away', () => {
    const owned = [{ type: 'keep' as const, level: 1 }];
    const over = grant(0n, 0n, 999_999, 999_999, owned);
    expect(over.gold).toBe(BigInt(BASE_STORAGE));
    expect(over.iron).toBe(BigInt(BASE_STORAGE));
    // The overflow is surfaced rather than swallowed: a payout that vanishes
    // against a full purse is prototype bug #1 in a different coat.
    expect(over.wasted.gold).toBe(999_999 - BASE_STORAGE);
    expect(over.wasted.iron).toBe(999_999 - BASE_STORAGE);
  });

  it('refuses a negative payout and reports no waste', () => {
    const owned = [{ type: 'keep' as const, level: 1 }];
    const nothing = grant(100n, 100n, -500, -500, owned);
    expect(nothing.gold).toBe(100n);
    expect(nothing.iron).toBe(100n);
    expect(nothing.wasted).toEqual({ gold: 0, iron: 0 });
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

  it('lets a warband with room in it train', () => {
    // The opening two fields are sixteen slots. Asserted from the other side
    // as well, because a capacity of zero would make every refusal below pass
    // without meaning anything.
    const p = player({ gold: 10_000n, iron: 10_000n, army: { raider: 15 } });
    expect(planTrain(p, 'raider').ok).toBe(true);
  });

  it('refuses to overfill the warband', () => {
    // Two level-1 Muster Fields is sixteen slots; sixteen raiders fill them.
    const p = player({ gold: 10_000n, iron: 10_000n, army: { raider: campSlots(1) * 2 } });
    expect(planTrain(p, 'raider')).toEqual({ ok: false, error: 'warbandFull' });
  });

  it('counts queued troops against the warband, not just trained ones', () => {
    const p = player({
      gold: 10_000n, iron: 10_000n, army: { raider: 12 },
      queue: ['raider', 'raider', 'raider', 'raider'],
    });
    expect(planTrain(p, 'raider')).toEqual({ ok: false, error: 'warbandFull' });
  });
});

/**
 * ALFA: "lapanganya harus di beli dan awal pemain udh dpt 2 maximal 10 bisa
 * beli setiap beli harga naik".
 *
 * Every clause of that is a number somewhere, and numbers drift. These pin
 * them to the one place they are allowed to live.
 */
describe('the Muster Field is bought, and the price climbs', () => {
  it('gives a new hold two and never allows more than ten', () => {
    expect(capOf('camp', 1)).toBe(STARTING_CAMPS);
    expect(capOf('camp', KEEP_MAX)).toBe(MAX_CAMPS);
    // Monotonic: raising the Keep may never take a field away.
    for (let lv = 2; lv <= KEEP_MAX; lv++) {
      expect(capOf('camp', lv)).toBeGreaterThanOrEqual(capOf('camp', lv - 1));
    }
  });

  it('charges more for each one you already own', () => {
    let last = 0;
    for (let owned = 0; owned < MAX_CAMPS; owned++) {
      const price = costOf('camp', 0, owned).g;
      expect(price).toBeGreaterThan(last);
      last = price;
    }
  });

  it('refuses the eleventh at any Keep level', () => {
    const fields = Array.from({ length: MAX_CAMPS }, (_, i) => ({
      id: `f${i}`, type: 'camp' as const, gx: 4 + i * 4, gy: 4, level: 1,
    }));
    const p = player({ gold: 10_000_000n, iron: 10_000_000n, keepLevel: KEEP_MAX, buildings: [
      { id: 'k', type: 'keep', gx: mid, gy: mid, level: KEEP_MAX }, ...fields,
    ] });
    expect(planBuild(p, 'camp', 4, 20)).toEqual({ ok: false, error: 'atCountLimit' });
  });

  it('is what carries warband room, and grows with its level', () => {
    for (let lv = 1; lv < KEEP_MAX; lv++) {
      expect(campSlots(lv + 1)).toBeGreaterThan(campSlots(lv));
    }
  });
});

describe('vanity is a sink and nothing else', () => {
  it('is left out of a raid snapshot entirely', () => {
    const snapshot = snapshotBase({
      id: 'd', name: 'Defender', keepLevel: 6, gold: 50_000n, iron: 20_000n,
      buildings: [
        { id: 'k', type: 'keep', gx: 27, gy: 27, level: 6 },
        { id: 'm', type: 'mine', gx: 22, gy: 27, level: 6 },
        { id: 's', type: 'statue', gx: 32, gy: 27, level: 3 },
        { id: 'b', type: 'brazier', gx: 30, gy: 30, level: 1 },
      ],
    });
    const types = snapshot.buildings.map((b) => b.type);
    expect(types).toContain('keep');
    expect(types).toContain('mine');
    // Not a target, not a carrier, not part of the hit points a star is
    // measured against. A statue must cost a raider nothing and earn them
    // nothing, or owning one becomes a decision about defence.
    expect(types).not.toContain('statue');
    expect(types).not.toContain('brazier');
  });

  it('does not dilute the loot pool', () => {
    const carriers = [
      { type: 'keep' as const }, { type: 'mine' as const },
      { type: 'wall' as const }, { type: 'statue' as const },
    ];
    expect(lootCarriers(carriers)).toBe(2);
  });

  it('costs gold only, so it can never be an iron bottleneck', () => {
    for (const type of ['statue', 'brazier', 'standard'] as const) {
      expect(costOf(type, 0, 0).i).toBe(0);
      expect(costOf(type, 3, 0).i).toBe(0);
      expect(costOf(type, 0, 0).g).toBeGreaterThan(1000);
    }
  });

  it('opens at Keep 3 and not before', () => {
    for (const type of ['statue', 'brazier', 'standard'] as const) {
      expect(capOf(type, 2)).toBe(0);
      expect(capOf(type, 3)).toBeGreaterThan(0);
    }
  });
});
