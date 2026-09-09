import { ZOOM_MIN } from '@ironvow/config';
import { describe, expect, it, vi } from 'vitest';
import { boatAt, boatHit, boatScreen } from '../lib/render/boat';
import { generateTerrain } from '../lib/render/terrain';
import { createWorld, type World } from '../lib/game/world';
import type { Draw } from '../lib/render/primitives';
import type { Lake } from '../lib/render/water';

/**
 * The boat.
 *
 * ALFA: "dunia malam tuh kaya ada laut, nah lautnya ada kapal, nah pas klik
 * kapal tiba-tiba ke dunia malam." So the two things that have to hold are
 * that there is a boat at all, and that touching it crosses over. Both have
 * failed silently before in this codebase — the first because the terrain is
 * generated and could come back with no water, the second because a tap that
 * lands on something else is indistinguishable from a tap that does nothing.
 */

const events = (): Parameters<typeof createWorld>[0] => ({
  onSelect: vi.fn(), onModeChange: vi.fn(), onToast: vi.fn(),
  onPlayerChanged: vi.fn(), onBattleEnd: vi.fn(),
  onPlacementChanged: vi.fn(), onPlacementCommit: vi.fn(),
  onCameraMoved: vi.fn(), onBoard: vi.fn(),
});

function drawOf(w: World): Draw {
  return { ctx: null as never, cam: w.cam, vp: w.vp, t: 0, night: 0 };
}

const lake = (cx: number, cy: number, r: number): Lake => ({
  cx, cy,
  pts: [[cx - r, cy], [cx, cy - r], [cx + r, cy], [cx, cy + r]],
});

describe('where the boat sits', () => {
  it('picks the larger stretch of water', () => {
    const at = boatAt([lake(10, 10, 2), lake(70, 40, 9)]);
    expect(at).not.toBeNull();
    // Offset toward the plateau, so it is near the big lake and nowhere near
    // the small one.
    expect(Math.abs(at!.gx - 70)).toBeLessThan(4);
    expect(Math.abs(at!.gy - 40)).toBeLessThan(4);
  });

  it('has nowhere to float with no water', () => {
    expect(boatAt([])).toBeNull();
  });

  /*
   * The terrain is generated, so "there is a lake" is a property of the
   * generator rather than something written down anywhere. If it ever stops
   * producing one the boat quietly disappears and the only way across is the
   * button in the corner — which is exactly the thing ALFA asked to replace.
   */
  it('the generated field always has water to float on', () => {
    for (let i = 0; i < 5; i++) {
      expect(boatAt(generateTerrain().lakes)).not.toBeNull();
    }
  });

  it('the world puts one there on its own', () => {
    expect(createWorld(events()).boat).not.toBeNull();
  });
});

describe('touching it', () => {
  const w = createWorld(events());
  w.vp = { w: 800, h: 600, dpr: 2 };
  const at = w.boat!;

  it('counts a tap on the hull', () => {
    const [x, y] = boatScreen(drawOf(w), at);
    expect(boatHit(drawOf(w), at, x, y)).toBe(true);
  });

  it('reaches up to the sail, which is what a thumb aims for', () => {
    const [x, y] = boatScreen(drawOf(w), at);
    expect(boatHit(drawOf(w), at, x, y - 50 * w.cam.z)).toBe(true);
  });

  it('ignores a tap on the open water beside it', () => {
    const [x, y] = boatScreen(drawOf(w), at);
    expect(boatHit(drawOf(w), at, x + 200 * w.cam.z, y)).toBe(false);
    expect(boatHit(drawOf(w), at, x, y + 200 * w.cam.z)).toBe(false);
  });

  /*
   * Pulled all the way back it is still something a thumb can find.
   *
   * At the world's own scale a boat at ZOOM_MIN is about a dozen pixels of
   * hull, which is a boat nobody sees and nobody presses — and it is the only
   * way into the night base that is not a button in the corner.
   */
  it('stays big enough to press at the furthest zoom', () => {
    const far = createWorld(events());
    far.vp = { w: 430, h: 900, dpr: 2 };
    far.cam.z = ZOOM_MIN;
    const d = drawOf(far);
    const [x, y] = boatScreen(d, far.boat!);
    let wide = 0;
    while (boatHit(d, far.boat!, x + wide, y)) wide++;
    expect(wide).toBeGreaterThan(44);
  });

  /* The hitbox is in screen pixels, so it has to follow the camera. */
  it('follows the camera', () => {
    const [x, y] = boatScreen(drawOf(w), at);
    w.cam.x += 300;
    expect(boatHit(drawOf(w), at, x, y)).toBe(false);
  });
});
