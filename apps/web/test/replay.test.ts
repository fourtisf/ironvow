import { TICK_SECONDS } from '@ironvow/config';
import { generateOpponent } from '@ironvow/sim';
import type { BattleArmy, DeployCommand } from '@ironvow/types';
import { describe, expect, it, vi } from 'vitest';
import { beginBattle, createWorld, deployAt, stepBattle, type World } from '../lib/game/world';

/**
 * A replay has to be the fight.
 *
 * This is here because it was not. The recorded commands were pushed into
 * `battleCommands` after `beginBattle` had already built the tick schedule —
 * and that array is the outbox, the record of what the player did, read only
 * when a raid is submitted. Nothing consumed it, so every replay in the game
 * ran an empty attack: three minutes of a base standing untouched, which looks
 * exactly like a raid where the attacker did nothing rather than like a bug.
 *
 * It survived because nothing failed. There is no error in an empty schedule.
 */

const ARMY: BattleArmy = { raider: 8, archer: 0, lancer: 0, ram: 0, scaler: 0, bomber: 0 };

function world(): World {
  return createWorld({
    onSelect: vi.fn(), onModeChange: vi.fn(), onToast: vi.fn(),
    onPlayerChanged: vi.fn(), onBattleEnd: vi.fn(),
    onPlacementChanged: vi.fn(), onPlacementCommit: vi.fn(), onCameraMoved: vi.fn(), onBoard: vi.fn(),
  });
}

const snapshot = () => generateOpponent(4, 'ai', 'Target', 11);

function scouted() {
  return {
    raidId: 'r1', seed: 5, snapshot: snapshot(), army: ARMY,
    hero: { level: 1, available: false },
    troopLevels: {}, pouch: {},
    expiresAt: new Date().toISOString(), rerollCost: 0,
  };
}

/**
 * Eight raiders dropped in a ring, a few ticks apart, the way a player does.
 *
 * Wide on purpose. A deploy inside `DEPLOY_CLEARANCE` of a building is refused,
 * so a tighter ring silently lands fewer troops than it names — and a test that
 * counts units would then be measuring the clearance rule rather than the thing
 * it is about.
 */
const RING: [number, number][] = [
  [9, 27], [27, 9], [45, 27], [27, 45], [13, 13], [41, 13], [13, 41], [41, 41],
];

function recorded(): DeployCommand[] {
  return RING.map(([gx, gy], i) => ({ tickIndex: i * 3, troopType: 'raider' as const, gx, gy }));
}

/** Run the battle forward by whole seconds. */
function run(w: World, seconds: number): void {
  for (let i = 0; i < seconds / TICK_SECONDS; i++) stepBattle(w, TICK_SECONDS);
}

describe('watching a recorded raid', () => {
  it('puts the recorded troops on the field', () => {
    const w = world();
    beginBattle(w, scouted(), 'raid', { commands: recorded(), items: [] });
    run(w, 6);
    expect(w.battle!.result().rejected).toEqual([]);
    expect(w.battle!.units.length).toBe(RING.length);
  });

  it('damages the base, which is the whole difference from the bug', () => {
    const w = world();
    beginBattle(w, scouted(), 'raid', { commands: recorded(), items: [] });
    run(w, 45);
    expect(w.battle!.destroyedPct()).toBeGreaterThan(0);
  });

  it('leaves the base untouched when there is nothing recorded', () => {
    // The other half of the same fact: an empty schedule is a quiet field, and
    // that is exactly what every replay looked like.
    const w = world();
    beginBattle(w, scouted(), 'raid', { commands: [], items: [] });
    run(w, 45);
    expect(w.battle!.units.length).toBe(0);
    expect(w.battle!.destroyedPct()).toBe(0);
  });

  it('will not let a viewer add a troop that was never in the fight', () => {
    const w = world();
    beginBattle(w, scouted(), 'raid', { commands: recorded(), items: [] });
    run(w, 6);
    const before = w.battle!.units.length;

    w.selectedTroop = 'raider';
    deployAt(w, ...RING[0]!);
    expect(w.battle!.units.length).toBe(before);
    expect(w.battleCommands).toHaveLength(0);
  });

  it('is a live raid again when no recording is handed over', () => {
    /*
     * `watching` must not be sticky: the same world plays a raid after watching
     * one, and a player unable to deploy in their own attack is a far louder
     * bug than the one this flag fixes.
     */
    const w = world();
    beginBattle(w, scouted(), 'raid', { commands: recorded(), items: [] });
    expect(w.watching).toBe(true);

    beginBattle(w, scouted());
    expect(w.watching).toBe(false);
    w.selectedTroop = 'raider';
    deployAt(w, ...RING[0]!);
    expect(w.battleCommands).toHaveLength(1);
  });
});
