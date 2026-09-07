import { KEEP_MAX, N, TYPES, capOf, type BuildingType } from '@ironvow/config';
import type { BaseSnapshot, SnapshotBuilding } from '@ironvow/types';

/**
 * The hold on the landing page.
 *
 * ALFA: "landing page gamenya yang sudah level semua maximal"
 *
 * It used to be a generated garrison at stage four, which is a mid-game
 * opponent: level-three buildings, a thin ring of walls, and none of the art
 * the game spends its levels on. That is the first thing anyone ever sees of
 * IRONVOW, and it was showing them the middle of the game rather than the end
 * of it.
 *
 * So this is a finished hold: every building at the Keep's own ceiling, laid
 * out by hand rather than generated, because the door is the one screen where
 * composition matters more than variety. Four-fold symmetry about the Keep,
 * which is what a player who has spent a year on a base ends up with anyway.
 *
 * It is drawn in the player's own colours rather than an enemy's. The blue and
 * gold is the livery someone is being invited to build, not one to attack.
 */

/** Everything is at the ceiling. That is the whole point of the picture. */
const LV = KEEP_MAX;

/**
 * The mirror line.
 *
 * The Keep is three cells at 27, so it spans 27..29 and its middle is 28.5.
 * Reflecting a footprint of size `s` at `g` about that line puts it at
 * `57 - g - s`, which leaves the Keep exactly where it is — the one placement
 * everything else is arranged around.
 */
const MIRROR = 57;

interface Plan {
  type: BuildingType;
  gx: number;
  gy: number;
}

/** One building, and its three reflections. Duplicates on an axis collapse. */
function quad(type: BuildingType, gx: number, gy: number): Plan[] {
  const s = TYPES[type].s;
  const x2 = MIRROR - gx - s;
  const y2 = MIRROR - gy - s;
  const out: Plan[] = [];
  for (const [x, y] of [[gx, gy], [x2, gy], [gx, y2], [x2, y2]] as const) {
    if (!out.some((p) => p.gx === x && p.gy === y)) out.push({ type, gx: x, gy: y });
  }
  return out;
}

/** A left-and-right pair, for the things there are only two of. */
function pair(type: BuildingType, gx: number, gy: number): Plan[] {
  const s = TYPES[type].s;
  return [{ type, gx, gy }, { type, gx: MIRROR - gx - s, gy }];
}

/**
 * The curtain wall: the perimeter of a square, with the middle of each run
 * left open. A wall with no gates reads as a box; a wall with four reads as
 * something somebody decided.
 */
function curtain(lo: number, hi: number): Plan[] {
  const out: Plan[] = [];
  const mid = (lo + hi) / 2;
  for (let g = lo; g <= hi; g++) {
    const gate = Math.abs(g - mid) < 1;
    for (const [gx, gy] of [[g, lo], [g, hi], [lo, g], [hi, g]] as const) {
      if (gate && (gx === g || gy === g)) {
        // The gate itself: skip the cells the road runs through.
        if ((gx === g && (gy === lo || gy === hi)) || (gy === g && (gx === lo || gx === hi))) continue;
      }
      if (!out.some((p) => p.gx === gx && p.gy === gy)) out.push({ type: 'wall', gx, gy });
    }
  }
  return out;
}

const PLAN: Plan[] = [
  { type: 'keep', gx: 27, gy: 27 },

  // Inside the curtain: the fires and the colours, which only a hold with
  // nothing left to buy ever puts up.
  ...quad('brazier', 25, 25),
  ...quad('standard', 28, 25),
  ...quad('standard', 25, 28),

  ...curtain(23, 33),

  // Defences on the corners and the approaches, outside the wall where they
  // cover it.
  ...quad('cannon', 20, 20),
  ...quad('cannon', 20, 26),
  ...quad('tower', 25, 18),
  ...quad('tower', 18, 25),

  // The economy, in its own ring.
  ...quad('store', 18, 14),
  ...quad('mine', 22, 14),
  ...quad('mine', 14, 22),
  ...quad('forge', 29, 14),
  ...quad('forge', 14, 29),

  // The army: two halls, one Lab, and the fields the warband stands on.
  ...pair('barr', 24, 11),
  { type: 'lab', gx: 27, gy: 11 },
  ...quad('camp', 13, 13),

  // And the statues, which cost a fortune and do nothing.
  ...quad('statue', 25, 35),
];

/**
 * Built once and kept: nothing here depends on the clock, the player, or the
 * camera, and the door mounts and unmounts it every time somebody signs in.
 */
let cached: BaseSnapshot | null = null;

export function showcaseHold(): BaseSnapshot {
  if (cached) return cached;

  const buildings: SnapshotBuilding[] = [];
  for (const p of PLAN) {
    const s = TYPES[p.type].s;
    if (p.gx < 2 || p.gy < 2 || p.gx + s > N - 2 || p.gy + s > N - 2) continue;
    // A hold cannot own more of something than its Keep permits, and a
    // showcase that breaks the game's own rules is a lie about the game.
    const owned = buildings.filter((b) => b.type === p.type).length;
    if (p.type !== 'keep' && owned >= capOf(p.type, KEEP_MAX)) continue;
    if (buildings.some((b) => {
      const bs = TYPES[b.type].s;
      return p.gx < b.gx + bs && p.gx + s > b.gx && p.gy < b.gy + bs && p.gy + s > b.gy;
    })) continue;
    buildings.push({ id: `s${buildings.length + 1}`, type: p.type, gx: p.gx, gy: p.gy, level: LV });
  }

  cached = {
    version: 1,
    defenderId: 'showcase',
    defenderName: 'IRONVOW',
    keepLevel: LV,
    buildings,
    pool: { g: 0, i: 0 },
  };
  return cached;
}
