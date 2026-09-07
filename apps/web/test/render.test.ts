import { TYPES, type BuildingType } from '@ironvow/config';
import type { DeployableType } from '@ironvow/types';
import { describe, expect, it } from 'vitest';
import { ANIMATED, drawBuildingBody, drawBuildingFx } from '../lib/render/buildings';
import { drawUnitUncached, type DrawableUnit } from '../lib/render/units';
import { newCamera, onScreen, structOnScreen, type Viewport } from '../lib/render/camera';
import { isoBox, type Draw } from '../lib/render/primitives';

/**
 * Guards on the two invariants the sprite cache rests on.
 *
 * The renderer used to re-issue every path of every building every frame:
 * ~4,700 canvas operations for a 164-building base, which measured at 10fps
 * against a CPU throttled to stand in for a mid-range phone. The fix rasterises
 * each structure's static art once per (type, level, livery, zoom) and blits it.
 *
 * That is only correct while the static half really is static. If someone adds
 * a flicker to a forge's body, the first frame it happens to be drawn on gets
 * baked into the bitmap and every forge in the game freezes on that frame — and
 * nothing about the code would look wrong. So it is asserted here instead.
 */

/** Records the call stream instead of drawing, so two runs can be compared. */
function recorder(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const methods = [
    'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse',
    'quadraticCurveTo', 'fill', 'stroke', 'fillRect', 'fillText', 'strokeText',
    'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'drawImage',
    'clip',
  ];
  const fmt = (a: unknown): string => (typeof a === 'number' ? a.toFixed(3) : String(a));
  const target: Record<string, unknown> = {};
  for (const name of methods) {
    target[name] = (...args: unknown[]): void => {
      log.push(`${name}(${args.map(fmt).join(',')})`);
    };
  }

  /*
   * Gradients are part of the drawing, so they are part of the record.
   *
   * The shading on every wall and roof is a gradient, and a colour stop that
   * moved with the clock would be exactly the bug this file exists to catch —
   * baked into a sprite on whichever frame it was first rasterised. So each
   * gradient gets an identity, its stops are logged against it, and assigning
   * it to `fillStyle` logs that identity through `toString`.
   */
  let made = 0;
  const gradient = (kind: string, args: unknown[]): unknown => {
    const id = `${kind}#${made++}(${args.map(fmt).join(',')})`;
    log.push(id);
    return {
      addColorStop: (at: number, col: string): void => {
        log.push(`stop(${id},${at.toFixed(3)},${col})`);
      },
      toString: () => id,
    };
  };
  target['createLinearGradient'] = (...args: unknown[]): unknown => gradient('linear', args);
  target['createRadialGradient'] = (...args: unknown[]): unknown => gradient('radial', args);
  const ctx = new Proxy(target, {
    set(obj, key, value) {
      log.push(`${String(key)}=${String(value)}`);
      obj[String(key)] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

function draw(t: number): { d: Draw; log: string[] } {
  const { ctx, log } = recorder();
  const cam = newCamera();
  const vp: Viewport = { w: 400, h: 800, dpr: 2 };
  return { d: { ctx, cam, vp, t }, log };
}

const ALL = Object.keys(TYPES) as BuildingType[];

describe('building bodies are cacheable', () => {
  for (const type of ALL) {
    it(`${type} draws identically whatever the clock says`, () => {
      const a = draw(0);
      const b = draw(97.3);
      drawBuildingBody(a.d, { type, gx: 4, gy: 4, level: 5 }, false);
      drawBuildingBody(b.d, { type, gx: 4, gy: 4, level: 5 }, false);
      expect(a.log).toEqual(b.log);
      expect(a.log.length).toBeGreaterThan(0);
    });
  }

  it('varies with everything the cache key carries', () => {
    const key = (level: number, enemy: boolean, z: number): string[] => {
      const { d, log } = draw(0);
      d.cam.z = z;
      drawBuildingBody(d, { type: 'keep', gx: 4, gy: 4, level }, enemy);
      return log;
    };
    const base = key(5, false, 1);
    expect(key(6, false, 1)).not.toEqual(base);
    expect(key(5, true, 1)).not.toEqual(base);
    expect(key(5, false, 0.6)).not.toEqual(base);
  });
});

describe('ANIMATED lists exactly the types with a moving part', () => {
  for (const type of ALL) {
    it(type, () => {
      const a = draw(0);
      const b = draw(97.3);
      drawBuildingFx(a.d, { type, gx: 4, gy: 4, level: 5 }, false);
      drawBuildingFx(b.d, { type, gx: 4, gy: 4, level: 5 }, false);
      if (ANIMATED.has(type)) {
        expect(a.log.length).toBeGreaterThan(0);
        // A cannon's barrel is the one animated part that does not move on its
        // own: it tracks the target the simulation gave it.
        if (type !== 'cannon') expect(a.log).not.toEqual(b.log);
      } else {
        expect(a.log).toEqual([]);
      }
    });
  }
});

describe('structures off screen are culled', () => {
  const vp: Viewport = { w: 400, h: 800, dpr: 2 };

  it('keeps what is under the camera', () => {
    const cam = newCamera();
    expect(structOnScreen(cam, vp, 0, 0, 3)).toBe(true);
  });

  it('drops what is far away', () => {
    const cam = newCamera();
    expect(structOnScreen(cam, vp, 60, 60, 1)).toBe(false);
    expect(structOnScreen(cam, vp, -60, -60, 1)).toBe(false);
  });

  it('keeps a tall structure whose roof still pokes into frame', () => {
    const cam = newCamera();
    // Its footprint is a little above the top edge, but a Keep is drawn far
    // enough upward that the roof is still visible. Culling on the anchor alone
    // used to make the tallest buildings blink out at the edge of the screen.
    const g = -15;
    expect(structOnScreen(cam, vp, g, g, 3)).toBe(true);
    // The same point fails the anchor-only test, which is the whole reason
    // structOnScreen exists.
    expect(onScreen(cam, vp, g, g)).toBe(false);
  });
});

describe('troop kit is cacheable, and changes with the level', () => {
  const TROOPS: DeployableType[] = ['raider', 'archer', 'lancer', 'scaler', 'ram', 'hero'];

  const unit = (type: DeployableType, level: number, over: Partial<DrawableUnit> = {}) => ({
    type, x: 2, y: 2, mine: true, hp: 1, maxHp: 1,
    moving: false, face: 1 as const, swing: 0, flash: 0, born: 0, level, ...over,
  });

  /*
   * The kit a troop wears is rasterised once per (type, level, livery, facing,
   * scale) and blitted, exactly like a building body. If anything in it ever
   * reads the clock, the frame it happened to be rasterised on is baked into
   * the bitmap and every troop of that kind freezes on it. A standing unit is
   * the case to assert: with no walk and no swing there is nothing left that
   * is allowed to differ between two clock values.
   */
  for (const type of TROOPS) {
    it(`${type} stands still identically whatever the clock says`, () => {
      const a = draw(0);
      const b = draw(97.3);
      drawUnitUncached(a.d, unit(type, 5));
      drawUnitUncached(b.d, unit(type, 5));
      expect(a.log).toEqual(b.log);
      expect(a.log.length).toBeGreaterThan(0);
    });
  }

  /*
   * The point of the tiers is that an upgrade is visible. A refactor that
   * dropped the level on its way to the art would leave every War Lab level
   * looking the same, which is exactly the state this replaced — and nothing
   * about the code would look wrong.
   */
  for (const type of TROOPS) {
    it(`${type} looks different at each tier`, () => {
      const at = (level: number): string[] => {
        const { d, log } = draw(0);
        drawUnitUncached(d, unit(type, level));
        return log;
      };
      const looks = [at(1), at(4), at(6), at(9)].map((l) => l.join('\n'));
      expect(new Set(looks).size).toBe(4);
    });
  }

  it('draws a flashing unit rather than caching one', () => {
    // The flash repaints every colour, so it must not become a second sprite
    // for every troop in the game.
    const { d, log } = draw(0);
    drawUnitUncached(d, unit('raider', 5, { flash: 0.5 }));
    expect(log.some((l) => l.includes('#ffd8c2'))).toBe(true);
  });
});

/**
 * The level badge is part of a building's silhouette, so it has to be part of
 * the sprite key — bounds are measured once per shape and reused at every zoom,
 * and a badged and an unbadged Keep sharing one entry would clip whichever was
 * rasterised second. `blitBuilding` carries it; this pins the half that can be
 * tested without a canvas, which is that it changes the drawing at all.
 *
 * Off only for key art: a field of numbers is the one thing in a banner that
 * says "menu" rather than "kingdom". See `/banner`.
 */
describe('the level badge can be turned off', () => {
  it('draws less without it, and the rest identically', () => {
    const on = draw(0);
    const off = draw(0);
    drawBuildingBody(on.d, { type: 'keep', gx: 4, gy: 4, level: 9 }, false);
    drawBuildingBody(off.d, { type: 'keep', gx: 4, gy: 4, level: 9, pips: false }, false);
    expect(off.log.length).toBeLessThan(on.log.length);
    // The badge is the last thing the body draws, so what is left is a prefix.
    expect(on.log.slice(0, off.log.length)).toEqual(off.log);
  });

  it('is on unless it is asked not to be', () => {
    const implied = draw(0);
    const explicit = draw(0);
    drawBuildingBody(implied.d, { type: 'cannon', gx: 4, gy: 4, level: 3 }, false);
    drawBuildingBody(explicit.d, { type: 'cannon', gx: 4, gy: 4, level: 3, pips: true }, false);
    expect(implied.log).toEqual(explicit.log);
  });
});

/**
 * ALFA: "bangunanya masih patah2 itu perbaiki".
 *
 * `isoBox` drew the wrong pair of walls. With `isoX = (gx - gy)·TW/2` and
 * `isoY = (gx + gy)·TH/2`, the corner at `(gx, gy)` is the *north* point of the
 * diamond and the two faces turned toward the camera are the runs west→south
 * and east→south. It drew west→south and north→west — one you can see and one
 * you never can — so the whole east half of every box in the game had no wall
 * on it and you could see straight through a Keep.
 *
 * Pinned here because nothing about the old code looked wrong: the hidden face
 * was drawn first and the top covered most of the evidence.
 */
describe('a box has walls on both sides you can see', () => {
  it('covers its own footprint, east half included', () => {
    const { d, log } = draw(0);
    d.cam.z = 1;
    d.cam.x = 0;
    d.cam.y = 0;
    isoBox(d, 0, 0, 2, 2, 40, '#888888', '#444444', '#666666');

    // Every filled polygon this drew, as its own list of points.
    const polys: [number, number][][] = [];
    let cur: [number, number][] = [];
    for (const line of log) {
      if (line.startsWith('beginPath')) cur = [];
      const m = /^(?:moveTo|lineTo)\(([-\d.]+),([-\d.]+)\)$/.exec(line);
      if (m) cur.push([Number(m[1]), Number(m[2])]);
      if (line === 'fill()' && cur.length >= 3) polys.push(cur);
    }

    /*
     * The south corner is the box's lowest point, and it is where the two
     * faces you can see meet — so exactly two filled shapes must reach it.
     * Written against the geometry rather than absolute coordinates, so it
     * does not care where the camera happens to be.
     */
    const bottom = Math.max(...polys.flat().map(([, y]) => y));
    const atSouth = polys.filter((p) => p.some(([, y]) => Math.abs(y - bottom) < 0.6));
    expect(atSouth).toHaveLength(2);
    // And they are on opposite sides of it: one runs west, one runs east.
    const spans = atSouth.map((p) => {
      const xs = p.map(([x]) => x);
      return { lo: Math.min(...xs), hi: Math.max(...xs) };
    });
    const southX = polys.flat().find(([, y]) => Math.abs(y - bottom) < 0.6)![0];
    expect(spans.some((sp) => sp.lo < southX - 1)).toBe(true);
    expect(spans.some((sp) => sp.hi > southX + 1)).toBe(true);
  });
});
