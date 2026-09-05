import { IN0, IN1, TYPES, type BuildingType } from '@ironvow/config';

/**
 * Placement validation.
 *
 * This runs on the server for every build and every move. The client runs the
 * same rules to draw the red-or-green footprint, but its answer decides
 * nothing — a rejected placement here is rejected regardless of what the
 * player saw.
 */

export interface PlacedBuilding {
  id: string;
  type: BuildingType;
  gx: number;
  gy: number;
}

export type PlacementError = 'outOfBounds' | 'overlaps' | 'notInteger';

/**
 * Ported from the prototype's `cellsFree`.
 *
 * `ignoreId` is what makes relocation work: a building being moved must not
 * collide with the footprint it is currently standing on. Placement and
 * relocation go through this one function — prototype bug #2 was two code
 * paths drifting apart until a move destroyed the building and charged for it.
 */
export function cellsFree(
  type: BuildingType,
  gx: number,
  gy: number,
  existing: readonly PlacedBuilding[],
  ignoreId?: string,
): PlacementError | null {
  if (!Number.isInteger(gx) || !Number.isInteger(gy)) return 'notInteger';

  const s = TYPES[type].s;
  if (gx < IN0 || gy < IN0 || gx + s > IN1 || gy + s > IN1) return 'outOfBounds';

  for (const b of existing) {
    if (ignoreId && b.id === ignoreId) continue;
    const bs = TYPES[b.type].s;
    if (gx < b.gx + bs && gx + s > b.gx && gy < b.gy + bs && gy + s > b.gy) return 'overlaps';
  }
  return null;
}

/** Whether a footprint fits, ignoring cost and count limits. */
export function isPlaceable(
  type: BuildingType,
  gx: number,
  gy: number,
  existing: readonly PlacedBuilding[],
  ignoreId?: string,
): boolean {
  return cellsFree(type, gx, gy, existing, ignoreId) === null;
}

/** First free spot spiralling out from a origin. Used to seed a new base. */
export function findFreeSpot(
  type: BuildingType,
  originX: number,
  originY: number,
  existing: readonly PlacedBuilding[],
): { gx: number; gy: number } | null {
  const s = TYPES[type].s;
  const max = IN1 - IN0;
  for (let radius = 0; radius <= max; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        // Only walk the shell of each square, so the search stays outward-first.
        if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const gx = originX + dx;
        const gy = originY + dy;
        if (gx < IN0 || gy < IN0 || gx + s > IN1 || gy + s > IN1) continue;
        if (isPlaceable(type, gx, gy, existing)) return { gx, gy };
      }
    }
  }
  return null;
}
