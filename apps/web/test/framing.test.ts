import { TYPES, ZOOM_MIN } from '@ironvow/config';
import { isoX, isoY, w2s } from '../lib/render/camera';
import { describe, expect, it, vi } from 'vitest';
import { HOME_ZOOM_MAX, centerOnKeep, createWorld, type World } from '../lib/game/world';
import type { ClientBuilding } from '../lib/game/types';

/**
 * What the player sees when the game opens.
 *
 * ALFA, looking at it on a monitor: "perbaiki tampilanya". The opening frame
 * fitted the whole 56-tile plateau, so the zoom was decided by the size of the
 * ground rather than by the size of the base standing on it — and on a 1920px
 * window a five-building hold came out about a fifth of the size it is on a
 * phone. Both ended up pinned at `ZOOM_MIN`, which is what made it invisible:
 * the number was the same everywhere, so nothing looked broken anywhere.
 */

function world(w: number, h: number): World {
  const world = createWorld({
    onSelect: vi.fn(), onModeChange: vi.fn(), onToast: vi.fn(),
    onPlayerChanged: vi.fn(), onBattleEnd: vi.fn(),
    onPlacementChanged: vi.fn(), onPlacementCommit: vi.fn(), onCameraMoved: vi.fn(), onBoard: vi.fn(),
  });
  world.vp = { w, h, dpr: 2 };
  return world;
}

const at = (type: keyof typeof TYPES, gx: number, gy: number): ClientBuilding => ({
  id: `${type}-${gx}-${gy}`, type, gx, gy, level: 1, stock: 0,
  completesAt: null, upgradingTo: null,
});

/** The opening layout: a Town Hall and a few things around it. */
const SMALL: ClientBuilding[] = [
  at('keep', 27, 27), at('mine', 24, 27), at('barr', 30, 27),
  at('camp', 25, 31), at('camp', 30, 31),
];

/** A hold that has grown out across the plateau. */
const LARGE: ClientBuilding[] = [
  at('keep', 27, 27), at('mine', 10, 10), at('forge', 44, 44),
  at('cannon', 10, 44), at('tower', 44, 10),
];

function zoomFor(vw: number, vh: number, buildings: ClientBuilding[]): number {
  const w = world(vw, vh);
  w.player = { buildings } as unknown as World['player'];
  centerOnKeep(w);
  return w.cam.z;
}

describe('the opening frame follows the base, not the ground', () => {
  it('shows a small base larger on a bigger screen', () => {
    /*
     * The whole bug in one assertion. Fitting the plateau, every viewport from
     * a phone to a monitor computed a zoom under `ZOOM_MIN` and was clamped to
     * it, so a desktop showed the same tiny base a phone did — in a window four
     * times the size.
     */
    const phone = zoomFor(420, 900, SMALL);
    const desktop = zoomFor(1920, 960, SMALL);
    expect(desktop).toBeGreaterThan(phone);
  });

  it('pulls back for a base that has grown', () => {
    expect(zoomFor(1920, 960, LARGE)).toBeLessThan(zoomFor(1920, 960, SMALL));
  });

  it('never pushes closer than the cap, however few buildings there are', () => {
    const one = zoomFor(1920, 960, [at('keep', 27, 27)]);
    expect(one).toBeLessThanOrEqual(HOME_ZOOM_MAX);
    // A single Town Hall filling a monitor is the other way to get this wrong.
    expect(one).toBeGreaterThan(ZOOM_MIN);
  });

  it('never pulls back past the floor, however far the base spreads', () => {
    expect(zoomFor(420, 900, LARGE)).toBeGreaterThanOrEqual(ZOOM_MIN);
  });

  it('looks at the base, not at the middle of the map', () => {
    // A hold built in one corner: the camera has to go to it.
    const w = world(1920, 960);
    w.player = { buildings: [at('keep', 12, 12), at('mine', 15, 12)] } as unknown as World['player'];
    centerOnKeep(w);
    const corner = { x: w.cam.x, y: w.cam.y };

    const mid = world(1920, 960);
    mid.player = { buildings: SMALL } as unknown as World['player'];
    centerOnKeep(mid);

    expect(corner).not.toEqual({ x: mid.cam.x, y: mid.cam.y });
    // And it is genuinely off toward that corner rather than nudged.
    expect(corner.y).toBeLessThan(mid.cam.y);
  });

  it('survives a player with nothing built', () => {
    /*
     * Reachable: the field renders for a beat before /me lands, and a camera
     * that goes NaN there takes the whole canvas with it silently.
     */
    const w = world(1920, 960);
    centerOnKeep(w);
    expect(Number.isFinite(w.cam.x)).toBe(true);
    expect(Number.isFinite(w.cam.y)).toBe(true);
    expect(w.cam.z).toBeGreaterThan(0);
  });

  it.each([[420, 900], [820, 1180], [1920, 960], [2560, 1440]])(
    'crops nothing off the base at %ix%i',
    (vw, vh) => {
      /*
       * The point of framing: every corner of every footprint has to land on
       * screen. A zoom that is merely "bigger" is not the fix if it pushes the
       * Barracks off the edge — and the corners are what matters, because an
       * isometric bounding box is a diamond and its widest point is not a
       * corner of the grid rectangle.
       */
      const w = world(vw, vh);
      w.player = { buildings: SMALL } as unknown as World['player'];
      centerOnKeep(w);

      for (const b of SMALL) {
        const s = TYPES[b.type].s;
        for (const [gx, gy] of [
          [b.gx, b.gy], [b.gx + s, b.gy], [b.gx, b.gy + s], [b.gx + s, b.gy + s],
        ] as const) {
          const [sx, sy] = w2s(w.cam, w.vp, isoX(gx, gy), isoY(gx, gy));
          expect(sx, `${b.type} x`).toBeGreaterThanOrEqual(0);
          expect(sx, `${b.type} x`).toBeLessThanOrEqual(vw);
          expect(sy, `${b.type} y`).toBeGreaterThanOrEqual(0);
          expect(sy, `${b.type} y`).toBeLessThanOrEqual(vh);
        }
      }
    },
  );
});
