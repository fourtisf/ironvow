import { TYPES } from '@ironvow/config';
import { describe, expect, it, vi } from 'vitest';
import type { ClientBuilding, PlayerState } from '../lib/game/types';
import {
  createWorld, movePlacementTo, snapPlacement, startPlacement,
  type World, type WorldEvents,
} from '../lib/game/world';

/**
 * Placing a building is one tap now: the ghost goes where the finger went and
 * the job starts. That removed a confirmation, which means the check that used
 * to sit behind it — a greyed-out PLACE button over a red footprint — is gone
 * too, and the only thing standing between a stray tap and a building dropped
 * on top of the Keep is `ok`.
 *
 * Which makes `ok` worth a test of its own. The input layer commits when and
 * only when it is true; these assert it says what it should.
 */

function silent(): WorldEvents {
  return {
    onSelect: vi.fn(), onModeChange: vi.fn(), onToast: vi.fn(),
    onPlayerChanged: vi.fn(), onBattleEnd: vi.fn(),
    onPlacementChanged: vi.fn(), onPlacementCommit: vi.fn(), onCameraMoved: vi.fn(),
  };
}

function hold(): { w: World; events: WorldEvents } {
  const events = silent();
  const w = createWorld(events);
  const building = (id: string, type: 'keep' | 'mine', gx: number, gy: number): ClientBuilding => ({
    id, type, gx, gy, level: 1, stock: 0,
    completesAt: null, upgradingTo: null,
  });
  w.player = {
    buildings: [building('k', 'keep', 26, 26), building('m', 'mine', 22, 26)],
  } as unknown as PlayerState;
  return { w, events };
}

describe('a tap only commits a spot that is legal', () => {
  it('marks open ground as placeable', () => {
    const { w } = hold();
    startPlacement(w, 'cannon', null);
    movePlacementTo(w, 34, 34);
    expect(w.placement?.ok).toBe(true);
  });

  it('refuses a spot that overlaps something already standing', () => {
    const { w } = hold();
    startPlacement(w, 'cannon', null);
    // The Keep is three cells square from (26,26); its middle is (27,27).
    movePlacementTo(w, 27, 27);
    expect(w.placement?.ok).toBe(false);
  });

  it('pulls a tap past the edge back onto the field rather than refusing it', () => {
    /*
     * The ghost is clamped inside the buildable range, so a tap in the far
     * distance lands the building at the nearest legal cell instead of
     * nowhere. Worth pinning down now that a tap also commits: the rule is
     * "the ghost is always somewhere you can see and somewhere legal", and if
     * that ever stopped being true a stray tap would start a job off the map.
     */
    const { w } = hold();
    startPlacement(w, 'cannon', null);
    movePlacementTo(w, -40, -40);
    expect(w.placement?.gx).toBe(2);
    expect(w.placement?.gy).toBe(2);
    expect(w.placement?.ok).toBe(true);

    movePlacementTo(w, 900, 900);
    const size = TYPES.cannon.s;
    expect(w.placement?.gx).toBe(56 - 2 - size);
    expect(w.placement?.gy).toBe(56 - 2 - size);
    expect(w.placement?.ok).toBe(true);
  });

  it('lets a building being moved sit back down on its own cells', () => {
    // Otherwise nudging a building one tile would be refused by its own
    // footprint, which is what "move is not a delete and a build" means.
    const { w } = hold();
    startPlacement(w, 'mine', 'm');
    const size = TYPES.mine.s;
    movePlacementTo(w, 22 + size / 2, 26 + size / 2);
    expect(w.placement?.ok).toBe(true);
  });

  it('tells the bar every time the ghost moves', () => {
    // The bar is React and the ghost is not; without this it kept saying
    // Blocked over a footprint that had long since turned green.
    const { w, events } = hold();
    startPlacement(w, 'cannon', null);
    (events.onPlacementChanged as ReturnType<typeof vi.fn>).mockClear();
    movePlacementTo(w, 34, 34);
    expect(events.onPlacementChanged).toHaveBeenCalled();
  });
});

/**
 * ALFA: "saya baru ngerjain task d suruh bangun mala ga ada bangunan perbaiki
 * ini harusnya ada tugas kita cuman mindahin ke tempat yang kita suka aja"
 *
 * A War Order said build a Rampart, and BUILD opened on "Blocked — pick
 * another spot" with the ghost sitting on top of their own buildings. The ghost
 * started four cells south of the Keep, which was open ground right up until a
 * new hold started coming with two Muster Fields in exactly that spot.
 */
describe('a building is never offered on ground it cannot stand on', () => {
  function crowded(): World {
    const events = silent();
    const w = createWorld(events);
    const at = (id: string, type: 'keep' | 'camp', gx: number, gy: number): ClientBuilding => ({
      id, type, gx, gy, level: 1, stock: 0, completesAt: null, upgradingTo: null,
    });
    w.player = {
      // The opening layout: a Keep at 26,26 and the two fields the ghost used
      // to be dropped straight on top of.
      buildings: [
        at('k', 'keep', 26, 26), at('c1', 'camp', 25, 30), at('c2', 'camp', 30, 30),
      ],
    } as unknown as PlayerState;
    return w;
  }

  it('opens somewhere legal instead of on top of the Muster Fields', () => {
    const w = crowded();
    startPlacement(w, 'wall', null);
    expect(w.placement?.ok).toBe(true);
  });

  it('slides a tap on something already built to the nearest free ground', () => {
    const w = crowded();
    startPlacement(w, 'wall', null);
    // Straight onto the Keep, which is three cells square from 26,26.
    movePlacementTo(w, 27, 27);
    expect(w.placement?.ok).toBe(false);
    snapPlacement(w);
    expect(w.placement?.ok).toBe(true);
    // Near the tap, not across the map.
    expect(Math.abs(w.placement!.gx - 27)).toBeLessThanOrEqual(5);
    expect(Math.abs(w.placement!.gy - 27)).toBeLessThanOrEqual(5);
  });

  it('leaves a legal spot exactly where the finger put it', () => {
    const w = crowded();
    startPlacement(w, 'wall', null);
    movePlacementTo(w, 40, 40);
    const before = `${w.placement!.gx},${w.placement!.gy}`;
    snapPlacement(w);
    expect(`${w.placement!.gx},${w.placement!.gy}`).toBe(before);
  });

  it('picks an existing building up where it stands, without teleporting it', () => {
    const w = crowded();
    startPlacement(w, 'camp', 'c1');
    expect(w.placement?.gx).toBe(25);
    expect(w.placement?.gy).toBe(30);
    expect(w.placement?.ok).toBe(true);
  });
});
