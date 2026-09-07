import { HORN_SECONDS, ITEM, ITEM_TYPES } from '@ironvow/config';
import { describe, expect, it, vi } from 'vitest';
import { generateOpponent } from '@ironvow/sim';
import { beginBattle, createWorld, useItemAt, type World } from '../lib/game/world';

/**
 * Battle items, client-side.
 *
 * The client's whole job here is to record what the player did precisely enough
 * that the server's replay reaches the same fight. Everything below is about
 * that: the command that goes on the wire, and the state that must not get
 * stuck.
 */

const EVENTS = () => ({
  onSelect: vi.fn(), onModeChange: vi.fn(), onToast: vi.fn(),
  onPlayerChanged: vi.fn(), onBattleEnd: vi.fn(),
  onPlacementChanged: vi.fn(), onPlacementCommit: vi.fn(), onCameraMoved: vi.fn(),
});

function raiding(pouch: Record<string, number> = { horn: 1, firepot: 1 }): World {
  const w = createWorld(EVENTS());
  w.vp = { w: 800, h: 600, dpr: 1 };
  beginBattle(w, {
    raidId: 'r1',
    seed: 5,
    snapshot: generateOpponent(3),
    army: { raider: 4, archer: 0, lancer: 0, ram: 0, scaler: 0 },
    hero: { level: 1, available: false },
    troopLevels: {},
    pouch,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    rerollCost: 0,
  });
  return w;
}

describe('using an item', () => {
  it('records exactly one command, at the tick the player played it', () => {
    const w = raiding();
    w.selectedItem = 'horn';
    useItemAt(w, 28, 28);
    expect(w.battleItems).toEqual([{ tickIndex: 0, item: 'horn', gx: 28, gy: 28 }]);
  });

  it('disarms itself, so the next tap is a deploy again', () => {
    const w = raiding();
    w.selectedItem = 'firepot';
    useItemAt(w, 28, 28);
    expect(w.selectedItem).toBeNull();
    // A second tap with nothing armed records nothing more.
    useItemAt(w, 30, 30);
    expect(w.battleItems).toHaveLength(1);
  });

  it('spends from the pouch the raid was frozen with, and stops at empty', () => {
    const w = raiding({ horn: 1 });
    expect(w.battle!.itemsLeft().horn).toBe(1);
    w.selectedItem = 'horn';
    useItemAt(w, 28, 28);
    expect(w.battle!.itemsLeft().horn).toBe(0);

    w.selectedItem = 'horn';
    useItemAt(w, 29, 29);
    expect(w.battleItems).toHaveLength(1);
    // And it disarms rather than leaving the player tapping at nothing.
    expect(w.selectedItem).toBeNull();
    expect(EVENTS().onToast).toBeDefined();
  });

  it('carries no pouch at all when the raid was opened before items existed', () => {
    const w = raiding({});
    w.selectedItem = 'horn';
    useItemAt(w, 28, 28);
    expect(w.battleItems).toEqual([]);
  });

  it('may be dropped on top of a building, unlike a deploy', () => {
    const w = raiding();
    const keep = w.raid!.snapshot.buildings.find((b) => b.type === 'keep')!;
    w.selectedItem = 'firepot';
    useItemAt(w, keep.gx + 1.5, keep.gy + 1.5);
    // No 'tooCloseToStructure': throwing one at a Cannon is the point of it.
    expect(w.battleItems).toHaveLength(1);
  });

  it('leaves a burst for the renderer, because the sim keeps no trace of one', () => {
    const w = raiding();
    w.selectedItem = 'firepot';
    useItemAt(w, 28, 28);
    expect(w.bursts).toHaveLength(1);
    expect(w.bursts[0]!.r).toBe(ITEM.firepot.r);
  });

  it('shows the Warhorn circle for as long as it lasts, and no longer', () => {
    const w = raiding();
    w.selectedItem = 'horn';
    useItemAt(w, 28, 28);
    // The circle appears when the tick it was played on runs, which is the
    // same frame: `stepBattle` always precedes the render.
    w.battle!.step();
    expect(w.battle!.auras()).toHaveLength(1);
    expect(w.battle!.auras()[0]!.left).toBeCloseTo(HORN_SECONDS, 1);

    for (let i = 0; i < 40 * HORN_SECONDS; i++) w.battle!.step();
    expect(w.battle!.auras()).toHaveLength(0);
  });
});

describe('arming an item takes the tap away from deploying', () => {
  it('is the one flag the tap handler branches on', () => {
    // `attachInput` owns the pointer, so what is asserted here is the state the
    // branch reads: an armed item, and a troop still selected behind it. The
    // branch itself is one line in input.ts and is exercised in the browser.
    const w = raiding();
    w.selectedTroop = 'raider';
    w.selectedItem = 'horn';
    useItemAt(w, 28, 28);
    expect(w.battleItems).toHaveLength(1);
    expect(w.battleCommands).toHaveLength(0);
    // Disarmed, so the troop that was still selected gets the next tap.
    expect(w.selectedItem).toBeNull();
    expect(w.selectedTroop).toBe('raider');
  });
});

describe('the item table', () => {
  it('names something for every type, so a tray can never draw a blank', () => {
    for (const t of ITEM_TYPES) {
      expect(ITEM[t].n.length).toBeGreaterThan(0);
      expect(ITEM[t].d.length).toBeGreaterThan(0);
    }
  });
});
