import { BUILDING_TYPES, TRAP, TRAP_TYPES, TYPES, isTrap, trapDamage, trapSeconds } from '@ironvow/config';
import { describe, expect, it, vi } from 'vitest';
import { createBattle } from '@ironvow/sim';
import type { BaseSnapshot, SnapshotBuilding } from '@ironvow/types';
import { beginBattle, createWorld, showPreview, stepBattle, type World } from '../lib/game/world';

/**
 * Traps, client-side.
 *
 * The simulation knows where every trap is on both sides — it has to, or a live
 * raid and its replay would fire them on different ticks. What the client owes
 * the game is the other half: not drawing the attacker's ones until they go off.
 * That rule lives in one branch of the battle renderer, and this is what holds
 * it in place.
 */

const EVENTS = () => ({
  onSelect: vi.fn(), onModeChange: vi.fn(), onToast: vi.fn(),
  onPlayerChanged: vi.fn(), onBattleEnd: vi.fn(),
  onPlacementChanged: vi.fn(), onPlacementCommit: vi.fn(), onCameraMoved: vi.fn(), onBoard: vi.fn(),
});

function b(id: string, type: SnapshotBuilding['type'], gx: number, gy: number, level = 3): SnapshotBuilding {
  return { id, type, gx, gy, level };
}

const holdWithTraps = (): BaseSnapshot => ({
  version: 1, defenderId: 'd', defenderName: 'T', keepLevel: 3,
  pool: { g: 500, i: 200 },
  buildings: [b('k', 'keep', 28, 28), b('t1', 'spike', 22, 29), b('t2', 'snare', 24, 29)],
});

function raiding(kind: 'raid' | 'defend' = 'raid'): World {
  const w = createWorld(EVENTS());
  w.vp = { w: 800, h: 600, dpr: 1 };
  beginBattle(w, {
    raidId: 'r1', seed: 5, snapshot: holdWithTraps(),
    army: { raider: 6, archer: 0, lancer: 0, ram: 0, scaler: 0, bomber: 0 },
    hero: { level: 1, available: false }, troopLevels: {},
    expiresAt: new Date(Date.now() + 600_000).toISOString(), rerollCost: 0,
  }, kind);
  return w;
}

describe('the simulation knows where they are; the screen does not', () => {
  it('hands the renderer every trap, armed or not', () => {
    // Hiding inside the simulation would mean two different battles for two
    // views of the same fight, which is the one thing the replay cannot survive.
    expect(raiding().battle!.traps()).toHaveLength(2);
  });

  it('starts them all armed, so none is drawn on an attacker\'s first frame', () => {
    for (const t of raiding().battle!.traps()) expect(t.sprung).toBe(-1);
  });

  it('records the tick one fired on, which is when it becomes visible', () => {
    const w = raiding();
    const battle = w.battle!;
    battle.deploy('raider', 18, 29.5);
    for (let i = 0; i < 30 * 12 && battle.traps().every((t) => t.sprung < 0); i++) battle.step();
    const sprung = battle.traps().filter((t) => t.sprung >= 0);
    expect(sprung.length).toBeGreaterThan(0);
    expect(sprung[0]!.sprung).toBeGreaterThan(0);
  });

  it('leaves a burst behind when one goes off, so the moment reads', () => {
    const w = raiding();
    const battle = w.battle!;
    battle.deploy('raider', 18, 29.5);
    // Driven through `stepBattle` rather than `battle.step`, because it is
    // stepBattle that pumps the event reader that turns a trap event into the
    // flash on screen. Stepping the simulation alone would test nothing here.
    for (let i = 0; i < 400 && w.bursts.length === 0; i++) stepBattle(w, 1 / 30);
    expect(battle.events.some((e) => e.k === 'trap')).toBe(true);
    expect(w.bursts.length).toBeGreaterThan(0);
    expect(TRAP_TYPES).toContain(w.bursts[0]!.item);
  });
});

describe('the scout does not show them, which is the whole feature', () => {
  /*
   * The screen the feature hangs off.
   *
   * A raid opens with a look at the layout. Draw a Spike Trap on it and the
   * attacker walks round it, and the defender's guess about where somebody
   * would come in is answered before it is ever tested.
   */
  const previewing = (enemy: boolean) => {
    const w = createWorld(EVENTS());
    w.vp = { w: 800, h: 600, dpr: 1 };
    showPreview(w, holdWithTraps(), enemy);
    return w;
  };

  it('keeps the snapshot whole — the hiding is in the drawing, not the data', () => {
    // Stripping them from the snapshot would break the simulation, which needs
    // them on both sides to fire on the same tick.
    expect(previewing(true).preview!.buildings.filter((x) => isTrap(x.type))).toHaveLength(2);
  });

  it('flags somebody else\'s hold as the one to hide them on', () => {
    expect(previewing(true).previewEnemy).toBe(true);
    // And the player's own hold, on the landing page, shows everything.
    expect(previewing(false).previewEnemy).toBe(false);
  });
});

describe('a trap is a building everywhere a player touches one', () => {
  it('is offered in BUILD, priced, and capped', () => {
    for (const t of TRAP_TYPES) {
      expect(BUILDING_TYPES).toContain(t);
      expect(isTrap(t)).toBe(true);
      expect(TYPES[t].base.g + TYPES[t].base.i).toBeGreaterThan(0);
      expect(TYPES[t].s).toBe(1);
    }
  });

  it('is not counted as a defence, so nothing targets it', () => {
    for (const t of TRAP_TYPES) expect(TYPES[t].cat).toBe('trap');
  });

  it('grows with its level in the one way that type of trap grows', () => {
    expect(trapDamage('spike', 5)).toBeGreaterThan(trapDamage('spike', 1));
    expect(trapSeconds('snare', 5)).toBeGreaterThan(trapSeconds('snare', 1));
    // A Snare never does damage, at any level, or it stops being the trap that
    // is worth putting in front of a Mortar rather than instead of one.
    expect(trapDamage('snare', 9)).toBe(0);
  });

  it('always reaches further than it triggers', () => {
    // Otherwise a trap catches the one man who stepped on it and nobody else,
    // because troops arrive strung out in a column.
    for (const t of TRAP_TYPES) expect(TRAP[t].blast).toBeGreaterThan(TRAP[t].r);
  });
});
