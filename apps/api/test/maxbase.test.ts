import {
  BUILDING_TYPES, IN0, IN1, KEEP_MAX, NIGHT, NIGHT_KEEP_MAX, TYPES, buildableAtNight, capOf,
} from '@ironvow/config';
import { describe, expect, it } from 'vitest';
import { cellsFree, type PlacedBuilding } from '../src/domain/placement.js';
import { OUTWORKS, maxBase } from '../src/domain/maxbase.js';

/**
 * The finished hold `scripts/max-player.ts` writes.
 *
 * A dev tool, and tested anyway, because of where its output goes: straight
 * into the database, skipping every check the server runs on a build. An
 * overlapping footprint or a wall off the edge of the field would be a live
 * account in a state the game has no way to reach and no way to describe —
 * and nothing would fail, it would simply look wrong.
 */
describe('a maxed base', () => {
  const base = maxBase();

  it('fits on the field', () => {
    expect(base.missed).toBe(0);
  });

  it('places every building where the server would have allowed it', () => {
    /*
     * The same function `POST /build` runs, fed the base one piece at a time in
     * the order it was laid — which is the only way to catch an overlap, since
     * checking a finished list against itself would compare every building with
     * itself and find nothing.
     */
    const sofar: PlacedBuilding[] = [];
    for (const [i, b] of base.buildings.entries()) {
      const why = cellsFree(b.type, b.gx, b.gy, sofar);
      expect(why, `${b.type} #${i} at ${b.gx},${b.gy}`).toBeNull();
      sofar.push({ id: String(i), type: b.type, gx: b.gx, gy: b.gy });
    }
  });

  it('builds exactly as many of each as the Town Hall allows', () => {
    const counts = new Map<string, number>();
    for (const b of base.buildings) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
    for (const type of BUILDING_TYPES) {
      expect(counts.get(type) ?? 0, type).toBe(capOf(type, KEEP_MAX));
    }
  });

  it('takes every one of them to the top level', () => {
    for (const b of base.buildings) expect(b.level, b.type).toBe(KEEP_MAX);
  });

  it('keeps the whole thing inside the buildable ground', () => {
    for (const b of base.buildings) {
      const s = TYPES[b.type].s;
      expect(b.gx, b.type).toBeGreaterThanOrEqual(IN0);
      expect(b.gy, b.type).toBeGreaterThanOrEqual(IN0);
      expect(b.gx + s, b.type).toBeLessThanOrEqual(IN1);
      expect(b.gy + s, b.type).toBeLessThanOrEqual(IN1);
    }
  });

  it('puts the Town Hall in the middle, where the camera looks', () => {
    const keep = base.buildings.find((b) => b.type === 'keep');
    const mid = Math.floor((IN0 + IN1) / 2);
    expect(keep).toBeDefined();
    expect(Math.abs(keep!.gx - mid)).toBeLessThanOrEqual(2);
    expect(Math.abs(keep!.gy - mid)).toBeLessThanOrEqual(2);
  });

  it('puts the walls and traps outside everything else', () => {
    /*
     * A wall inside the base blocks nothing and a trap under a building is
     * never stepped on, so the outworks are only worth laying if they are
     * genuinely outside the core.
     */
    const core = base.buildings.filter((b) => !OUTWORKS.includes(b.type));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of core) {
      const s = TYPES[b.type].s;
      x0 = Math.min(x0, b.gx); y0 = Math.min(y0, b.gy);
      x1 = Math.max(x1, b.gx + s - 1); y1 = Math.max(y1, b.gy + s - 1);
    }
    for (const b of base.buildings.filter((x) => OUTWORKS.includes(x.type))) {
      const outside = b.gx < x0 || b.gx > x1 || b.gy < y0 || b.gy > y1;
      expect(outside, `${b.type} at ${b.gx},${b.gy} is inside the core`).toBe(true);
    }
  });

  it('lays a smaller hold for a smaller Town Hall', () => {
    // The same function has to answer for a level 4 hold, or the script cannot
    // ever be used for anything but the top.
    const small = maxBase(4);
    expect(small.missed).toBe(0);
    expect(small.buildings.length).toBeLessThan(base.buildings.length);
    for (const b of small.buildings) expect(b.level).toBe(4);
  });
});

/**
 * And the same for the base across the water.
 *
 * The night world does not have the whole catalogue, and a maxed night base
 * holding a Laboratory would be an account in a state no player could reach —
 * the exact failure this file exists to catch, one world over.
 */
describe('a maxed night base', () => {
  const night = maxBase(NIGHT_KEEP_MAX, NIGHT);

  it('fits on the field', () => {
    expect(night.missed).toBe(0);
  });

  it('holds nothing the night world refuses to build', () => {
    for (const b of night.buildings) {
      expect(buildableAtNight(b.type), b.type).toBe(true);
    }
  });

  it('still builds everything the night world does allow, to its cap', () => {
    const counts = new Map<string, number>();
    for (const b of night.buildings) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
    for (const type of BUILDING_TYPES.filter(buildableAtNight)) {
      expect(counts.get(type) ?? 0, type).toBe(capOf(type, NIGHT_KEEP_MAX));
    }
  });

  it('places every building where the server would have allowed it', () => {
    const sofar: PlacedBuilding[] = [];
    for (const [i, b] of night.buildings.entries()) {
      const why = cellsFree(b.type, b.gx, b.gy, sofar);
      expect(why, `${b.type} #${i} at ${b.gx},${b.gy}`).toBeNull();
      sofar.push({ id: String(i), type: b.type, gx: b.gx, gy: b.gy });
    }
  });

  /*
   * The one that would have gone unnoticed: the two bases are laid by the same
   * planner, so a night base that came out identical to the day one would mean
   * the world argument was being ignored rather than that the two agree.
   */
  it('is not simply the day base again', () => {
    expect(night.buildings.length).toBeLessThan(maxBase().buildings.length);
  });
});
