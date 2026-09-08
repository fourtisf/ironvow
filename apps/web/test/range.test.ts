import { DEF_STAT, MORTAR_MIN, TYPES } from '@ironvow/config';
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

  for (const type of ['cannon', 'tower', 'mortar'] as const) {
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

  /*
   * The Mortar's dead zone.
   *
   * The ring is drawn as a donut — a hole cut out of the wash and a second
   * dashed line round it — and that hole is the only thing on screen that says
   * where the building is helpless. If the inner radius stops matching the
   * simulation's `min`, a player is being shown safe ground that is not safe,
   * or asked to defend ground that defends itself.
   */
  it('a Mortar draws its dead zone at exactly the radius it cannot fire inside', () => {
    const st = DEF_STAT.mortar!(1);
    expect(st.min).toBe(MORTAR_MIN);
    const hole = rangeRadii(st.min!, 1);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const gx = CENTRE[0] + Math.cos(a) * st.min!;
      const gy = CENTRE[1] + Math.sin(a) * st.min!;
      const [dx, dy] = offset(CENTRE[0], CENTRE[1], gx, gy);
      expect(onRing(dx, dy, hole.rx, hole.ry)).toBeCloseTo(1, 6);
    }
  });

  it('a Mortar reaches further than anything else, and is the only one with a hole', () => {
    for (const type of ['cannon', 'tower'] as const) {
      expect(DEF_STAT.mortar!(1).rng).toBeGreaterThan(DEF_STAT[type]!(1).rng);
      expect(DEF_STAT[type]!(1).min).toBeUndefined();
    }
  });

  it('the dead zone is smaller than the reach, or the building could never fire', () => {
    for (let lv = 1; lv <= 9; lv++) {
      const st = DEF_STAT.mortar!(lv);
      expect(st.min!).toBeLessThan(st.rng);
    }
  });

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
