import { DEF_STAT, TYPES } from '@ironvow/config';
import { describe, expect, it } from 'vitest';
import { isoX, isoY } from '../lib/render/camera';
import { rangeRadii } from '../lib/game/render';

/**
 * The ring a defence paints on the ground has to be the envelope the server
 * actually fires in, not a circle that looks about right.
 *
 * The simulation shoots when the plain Euclidean distance in grid space is
 * within `rng`. A circle in grid space is not a circle on an isometric screen:
 * it comes out as an axis-aligned ellipse, wider than it is tall in the same
 * ratio as a tile. Getting that wrong would draw a ring that lies — a Raider
 * standing just inside it would walk past untouched, and nothing about the
 * code would look wrong.
 */

/** Where a grid point lands on screen, relative to the ring's centre. */
function offset(cx: number, cy: number, gx: number, gy: number): [number, number] {
  return [isoX(gx, gy) - isoX(cx, cy), isoY(gx, gy) - isoY(cx, cy)];
}

/** 1 exactly on the ring, below 1 inside it, above 1 outside. */
function onRing(dx: number, dy: number, rx: number, ry: number): number {
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
}

describe('the firing envelope a defence draws', () => {
  const CENTRE = [20, 20] as const;

  for (const type of ['cannon', 'tower'] as const) {
    const r = DEF_STAT[type]!(1).rng;
    const { rx, ry } = rangeRadii(r, 1);

    it(`${type}: every point at exactly its range lands on the ring`, () => {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
        const gx = CENTRE[0] + Math.cos(a) * r;
        const gy = CENTRE[1] + Math.sin(a) * r;
        const [dx, dy] = offset(CENTRE[0], CENTRE[1], gx, gy);
        expect(onRing(dx, dy, rx, ry)).toBeCloseTo(1, 6);
      }
    });

    it(`${type}: a step further out is outside it, a step in is inside`, () => {
      for (const [scale, expected] of [[0.9, true], [1.1, false]] as const) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
          const gx = CENTRE[0] + Math.cos(a) * r * scale;
          const gy = CENTRE[1] + Math.sin(a) * r * scale;
          const [dx, dy] = offset(CENTRE[0], CENTRE[1], gx, gy);
          expect(onRing(dx, dy, rx, ry) < 1).toBe(expected);
        }
      }
    });

    it(`${type}: the ring scales with the camera`, () => {
      const zoomed = rangeRadii(r, 2);
      expect(zoomed.rx).toBeCloseTo(rx * 2, 6);
      expect(zoomed.ry).toBeCloseTo(ry * 2, 6);
    });
  }

  it('an Arrow Tower reaches further than a Cannon', () => {
    // The thing a player is actually reading off the two rings.
    expect(DEF_STAT.tower!(1).rng).toBeGreaterThan(DEF_STAT.cannon!(1).rng);
  });

  it('only defences have a range at all', () => {
    for (const type of Object.keys(TYPES) as (keyof typeof TYPES)[]) {
      const defensive = TYPES[type].cat === 'def' && type !== 'wall';
      expect(Boolean(DEF_STAT[type]), type).toBe(defensive);
    }
  });
});
