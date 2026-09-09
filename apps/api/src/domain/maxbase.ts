import {
  BUILDING_TYPES, DAY, IN0, IN1, KEEP_MAX, TYPES, buildableAtNight, capOf,
  type BuildingType, type World,
} from '@ironvow/config';
import { cellsFree, type PlacedBuilding } from './placement.js';

/**
 * A finished hold, laid out.
 *
 * Used by `scripts/max-player.ts` to fill the operator's own account. It lives
 * here rather than in the script so it can be tested, because the one thing
 * that could go wrong quietly is writing a base the game would never have
 * accepted — overlapping footprints or a building off the edge would be in the
 * database before anybody looked at the screen.
 *
 * Every count is `capOf` and every position goes through `cellsFree`, the same
 * function the server runs on every single build. Nothing here knows a rule the
 * game does not.
 */

/** Walls and traps are laid after the core, so they are placed separately. */
export const OUTWORKS: BuildingType[] = ['wall', 'spike', 'snare'];

export interface PlannedBuilding {
  type: BuildingType;
  gx: number;
  gy: number;
  level: number;
}

/**
 * Biggest first.
 *
 * A 4x4 Army Camp cannot squeeze into the gaps a hundred 2x2 buildings leave
 * behind, so the order matters: place what is hard to fit while there is still
 * room to fit it.
 */
function coreOrder(world: World): BuildingType[] {
  return BUILDING_TYPES
    .filter((t) => !OUTWORKS.includes(t))
    .filter((t) => world === DAY || buildableAtNight(t))
    .sort((a, b) => TYPES[b].s - TYPES[a].s);
}

/**
 * The first free spot, searched outward from the middle.
 *
 * A ring at a time rather than a raster scan, so the base grows round the Town
 * Hall instead of filling the north-west corner and trailing off.
 */
function spiralSpot(
  type: BuildingType, placed: PlacedBuilding[],
): { gx: number; gy: number } | null {
  const mid = Math.floor((IN0 + IN1) / 2);
  for (let r = 1; r < IN1 - IN0; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        // Only the edge of this ring: the inside was searched on earlier passes.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const gx = mid + dx;
        const gy = mid + dy;
        if (cellsFree(type, gx, gy, placed) === null) return { gx, gy };
      }
    }
  }
  return null;
}

/** A rectangular ring of cells one step outside a box. */
function ring(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  for (let x = x0; x <= x1; x++) { out.push([x, y0], [x, y1]); }
  for (let y = y0 + 1; y < y1; y++) { out.push([x0, y], [x1, y]); }
  return out;
}

export interface MaxBase {
  buildings: PlannedBuilding[];
  /** How many the field had no room for. Zero on a field this size. */
  missed: number;
}

/**
 * `world` decides the catalogue, not the layout.
 *
 * The night world has no Laboratory and none of the vanity pieces, so a night
 * base laid from the day's list would be a base holding buildings the game
 * would refuse to let anybody build. It reads that from `buildableAtNight`
 * rather than a list of its own, so the two can never disagree.
 */
export function maxBase(level = KEEP_MAX, world: World = DAY): MaxBase {
  const placed: PlacedBuilding[] = [];
  const buildings: PlannedBuilding[] = [];
  const mid = Math.floor((IN0 + IN1) / 2);
  let missed = 0;

  const add = (type: BuildingType, gx: number, gy: number): void => {
    placed.push({ id: `${type}${placed.length}`, type, gx, gy });
    buildings.push({ type, gx, gy, level });
  };

  // The Town Hall first and in the middle: everything else is arranged around
  // it, and the opening frame centres on whatever base it finds.
  add('keep', mid - 1, mid - 1);

  for (const type of coreOrder(world)) {
    if (type === 'keep') continue;
    for (let i = 0; i < capOf(type, level); i++) {
      const spot = spiralSpot(type, placed);
      if (!spot) { missed++; continue; }
      add(type, spot.gx, spot.gy);
    }
  }

  /*
   * Walls and traps go round the outside, which is the only place they are
   * worth anything: a wall inside the base blocks nothing, and a trap under a
   * building is never stepped on.
   */
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of placed) {
    const s = TYPES[b.type].s;
    x0 = Math.min(x0, b.gx); y0 = Math.min(y0, b.gy);
    x1 = Math.max(x1, b.gx + s - 1); y1 = Math.max(y1, b.gy + s - 1);
  }

  for (const type of OUTWORKS.filter((t) => world === DAY || buildableAtNight(t))) {
    let left = capOf(type, level);
    for (let out = 1; left > 0 && out < 14; out++) {
      for (const [gx, gy] of ring(x0 - out, y0 - out, x1 + out, y1 + out)) {
        if (left === 0) break;
        if (cellsFree(type, gx, gy, placed) !== null) continue;
        add(type, gx, gy);
        left--;
      }
    }
    missed += left;
  }

  return { buildings, missed };
}
