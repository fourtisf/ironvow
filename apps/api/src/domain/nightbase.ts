import { N, TYPES, type BuildingType } from '@ironvow/config';
import { cellsFree, type PlacedBuilding } from './placement.js';

/**
 * The base a player finds the first time they cross over.
 *
 * Not empty ground. A player arriving here has already run one hold and knows
 * what a Gold Mine is; making them place the first five buildings again is
 * teaching a lesson they have already learned. What it is not is a head start —
 * everything is level 1, and the Town Hall is level 1, so the night world's
 * progression starts where the day one did.
 *
 * Deliberately a different shape from the day opening: two mines rather than
 * one and no Barracks, because the night world's first job is to have something
 * worth defending before it has an army to attack with.
 */
export function startingNight(): { type: BuildingType; gx: number; gy: number }[] {
  const mid = Math.floor(N / 2) - 1;
  const plan: [BuildingType, number, number][] = [
    ['keep', mid, mid],
    ['mine', mid - 4, mid],
    ['mine', mid + 4, mid],
    ['forge', mid, mid - 4],
    ['camp', mid - 3, mid + 4],
    ['camp', mid + 2, mid + 4],
  ];

  /*
   * Laid through `cellsFree`, the same rule the server applies to every build.
   * A hand-written layout that overlaps would be written straight into the
   * database, and the first thing the player would see of their new world is a
   * base the game itself would have refused to let them make.
   */
  const placed: PlacedBuilding[] = [];
  const out: { type: BuildingType; gx: number; gy: number }[] = [];
  for (const [type, gx, gy] of plan) {
    if (cellsFree(type, gx, gy, placed) !== null) continue;
    placed.push({ id: `${type}${out.length}`, type, gx, gy });
    out.push({ type, gx, gy });
  }
  return out;
}

/** Every type the opening night base contains, for a test to check against. */
export function startingNightTypes(): BuildingType[] {
  return [...new Set(startingNight().map((b) => b.type))].sort();
}

/** Whether the plan covers the whole board it claims to. */
export function nightKeepAt(): { gx: number; gy: number } {
  const keep = startingNight().find((b) => b.type === 'keep');
  const mid = Math.floor(N / 2) - 1;
  return keep ?? { gx: mid, gy: mid, type: 'keep' } as never;
}

/** The footprint the opening base occupies, for framing the first view. */
export function nightSpan(): { w: number; h: number } {
  const base = startingNight();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of base) {
    const s = TYPES[b.type].s;
    x0 = Math.min(x0, b.gx); y0 = Math.min(y0, b.gy);
    x1 = Math.max(x1, b.gx + s); y1 = Math.max(y1, b.gy + s);
  }
  return { w: x1 - x0, h: y1 - y0 };
}
