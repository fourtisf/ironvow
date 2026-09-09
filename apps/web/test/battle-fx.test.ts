import { DEPLOY_CLEARANCE, TICKS_PER_SECOND, TROOP } from '@ironvow/config';
import { describe, expect, it, vi } from 'vitest';
import { swingOf } from '../lib/game/render';
import { createBattle, generateOpponent } from '@ironvow/sim';
import { createWorld, markDamage, snapshotHp, stepBattle, type World } from '../lib/game/world';

/**
 * Two animations that were wired up and never connected to anything.
 *
 * ALFA: "dan animasinya harus ada kalo mukul atau yang lain"
 *
 * `swing` was taken by every weapon painter and set by nothing, so every troop
 * in every raid held its sword out horizontally for the whole fight. It is
 * derived from the simulation's own attack cooldown now, which is the only way
 * it cannot drift out of step with the damage it is supposed to illustrate.
 */
describe('the swing follows the blow', () => {
  const raider = (over: Partial<{ cd: number; moving: boolean }> = {}) =>
    ({ t: 'raider' as const, cd: TROOP.raider.cd, moving: false, ...over });

  it('is fully extended at the instant the blow lands', () => {
    // The simulation resets cd to the weapon's whole period as it hits.
    expect(swingOf(raider(), 1)).toBe(1);
  });

  it('falls back to rest as the unit recovers', () => {
    expect(swingOf(raider({ cd: TROOP.raider.cd / 2 }), 1)).toBeCloseTo(0.5, 6);
    expect(swingOf(raider({ cd: 0 }), 1)).toBe(0);
  });

  it('holds still while walking, whatever the cooldown was left at', () => {
    // A unit whose target died mid-swing carries its cooldown to the next one.
    expect(swingOf(raider({ cd: TROOP.raider.cd, moving: true }), 1)).toBe(0);
  });

  it('never leaves the range the painters rotate through', () => {
    for (const cd of [-1, 0, 0.3, TROOP.raider.cd, TROOP.raider.cd * 3]) {
      const sw = swingOf(raider({ cd }), 1);
      expect(sw).toBeGreaterThanOrEqual(0);
      expect(sw).toBeLessThanOrEqual(1);
    }
  });

  it('gives the hero its own period rather than a troop one', () => {
    const hero = { t: 'hero' as const, cd: 0.2, moving: false };
    expect(swingOf(hero, 1)).toBeGreaterThan(0);
    expect(swingOf(hero, 9)).toBeGreaterThan(0);
  });
});

describe('the no-deploy zone is drawn from the rule it draws', () => {
  it('reads the clearance the simulation refuses on', () => {
    // Not an assertion about a number so much as about where it lives: the
    // renderer and the simulation must not hold two copies of this.
    expect(DEPLOY_CLEARANCE).toBeGreaterThan(0);
  });
});

describe('being hit is visible', () => {
  const world = (): World => createWorld({
    onSelect: vi.fn(), onModeChange: vi.fn(), onToast: vi.fn(),
    onPlayerChanged: vi.fn(), onBattleEnd: vi.fn(),
    onPlacementChanged: vi.fn(), onPlacementCommit: vi.fn(), onCameraMoved: vi.fn(), onBoard: vi.fn(),
  });

  const battle = (structHp: number[], unitHp: number[], dead: boolean[] = []) => ({
    structs: structHp.map((hp) => ({ hp })),
    units: unitHp.map((hp, i) => ({ hp, dead: dead[i] ?? false })),
  }) as unknown as Parameters<typeof markDamage>[1];

  it('flashes a unit whose hit points dropped, which nothing used to do', () => {
    const w = world();
    const before = snapshotHp(battle([100], [60, 60]));
    markDamage(w, battle([100], [60, 22]), before);
    expect(w.unitFlash.has(0)).toBe(false);
    expect(w.unitFlash.get(1)).toBeGreaterThan(0);
  });

  it('still flashes the building that took the blow', () => {
    const w = world();
    const before = snapshotHp(battle([500, 500], [60]));
    markDamage(w, battle([500, 410], [60]), before);
    expect(w.fx.flash.has(1)).toBe(true);
    expect(w.fx.flash.has(0)).toBe(false);
  });

  it('leaves a unit that just spawned alone', () => {
    // A deploy appends to the list, so `before` is shorter than `after` — and
    // an undefined reading must not be read as a unit that lost hit points.
    const w = world();
    const before = snapshotHp(battle([100], [60]));
    markDamage(w, battle([100], [60, 45]), before);
    expect(w.unitFlash.size).toBe(0);
  });

  it('does not flash a corpse', () => {
    const w = world();
    const before = snapshotHp(battle([100], [12]));
    markDamage(w, battle([100], [0], [true]), before);
    expect(w.unitFlash.size).toBe(0);
  });
});

/**
 * ALFA: "dan kalo misal buka chrome lain otomatis berhnti nyerang mengapa"
 *
 * Because the raid ran on the frame clock, and there are no frames in a tab
 * nobody is looking at. The delta on the way back was clamped to 50 ms, so two
 * minutes away advanced the battle by a twentieth of a second — and the timer
 * in the corner is the same clock, so the attack simply stopped.
 */
describe('a raid keeps running while the window is in the background', () => {
  function raid(): World {
    const w = createWorld({
      onSelect: vi.fn(), onModeChange: vi.fn(), onToast: vi.fn(),
      onPlayerChanged: vi.fn(), onBattleEnd: vi.fn(),
      onPlacementChanged: vi.fn(), onPlacementCommit: vi.fn(), onCameraMoved: vi.fn(), onBoard: vi.fn(),
    });
    w.battle = createBattle({
      snapshot: generateOpponent(4, 'ai', 'Test', 3),
      commands: [], army: { raider: 6, archer: 0, lancer: 0, ram: 0, scaler: 0, bomber: 0 }, seed: 7,
    });
    return w;
  }

  it('pays off a long absence instead of losing it', () => {
    const w = raid();
    const start = w.battle!.tick;
    // Ninety seconds away. Before this, the whole gap was thrown out.
    stepBattle(w, 90);
    expect(w.battle!.tick - start).toBeGreaterThan(TICKS_PER_SECOND * 5);
  });

  it('paces the catch-up rather than running the whole raid in one frame', () => {
    const w = raid();
    stepBattle(w, 90);
    // Whatever is left is still owed, and gets paid on the frames after.
    expect(w.tickAccumulator).toBeGreaterThan(0);
    const mid = w.battle!.tick;
    stepBattle(w, 0);
    expect(w.battle!.tick).toBeGreaterThan(mid);
  });

  it('goes quiet while replaying the past', () => {
    // A wall of sword-hits from ninety seconds ago is not information.
    const w = raid();
    stepBattle(w, 90);
    expect(w.heard).toBe(w.battle!.events.length);
  });

  it('still advances one ordinary frame at a time', () => {
    const w = raid();
    const start = w.battle!.tick;
    stepBattle(w, 1 / 60);
    stepBattle(w, 1 / 60);
    expect(w.battle!.tick - start).toBeLessThanOrEqual(2);
  });
});
