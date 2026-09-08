import {
  DEF_STAT, N, TICK_SECONDS, TROOP_TYPES, TYPES, coversAir, flies, isTrap,
  type BuildingType, type Pouch,
} from '@ironvow/config';
import type { BaseSnapshot, BattleArmy, DeployCommand, HeroLoadout, ItemCommand, TroopLevels } from '@ironvow/types';
import { simulate } from '@ironvow/sim';

/**
 * Why a hold fell.
 *
 * A defender could already watch the raid back, and watching is not the same as
 * understanding. Three minutes of somebody else's attack tells you that you
 * lost; it does not tell you that every one of them came in over the same
 * corner, or that the Mortar you spent four thousand gold on never fired a
 * shot because they never walked into its half of the base.
 *
 * All of it is derived, not stored. The raid row already holds everything —
 * the frozen snapshot, the seed, the commands — and the simulation is
 * deterministic, so replaying it with the timeline switched on reproduces the
 * exact fight and every event in it. Nothing here is a second source of truth
 * that could drift from the first.
 */

export interface BreachReport {
  /** Where the attack came from, as a compass point on the grid. */
  side: string;
  /** How lopsided that was: 1 means every deploy on one side of the hold. */
  concentration: number;
  /** Buildings that fell, earliest first, with when. */
  fell: { type: BuildingType; level: number; at: number }[];
  /** Defences that never fired a shot all raid. The sharpest line in the report. */
  idle: { type: BuildingType; level: number }[];
  /** Traps, and whether they were ever found. */
  traps: { type: BuildingType; level: number; sprung: boolean; at: number | null }[];
  /**
   * The base had nothing that shoots up, and they came by air anyway.
   *
   * The one thing in the report a defender cannot work out from watching. A
   * Bomber crossing a rampart looks like a troop crossing a rampart; that every
   * gun on the base was pointing at the ground the whole time is invisible
   * unless somebody says it.
   */
  airBlind: boolean;
  /** How long the raid actually lasted, in seconds. */
  seconds: number;
}

export interface ReportInput {
  snapshot: BaseSnapshot;
  commands: readonly DeployCommand[];
  items: readonly ItemCommand[];
  pouch: Pouch;
  army: BattleArmy;
  seed: number;
  hero: HeroLoadout;
  troopLevels: TroopLevels;
}

/**
 * The compass point a set of deploys came from.
 *
 * Eight points rather than four, because "north" and "north-east" are different
 * advice: one says the top edge is thin, the other says a corner is. Measured
 * against the middle of the map rather than the middle of the hold, so a hold
 * built off-centre does not report every attack as coming from the side it
 * happens to sit nearer.
 */
export function compass(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return 'everywhere';
  // Grid y grows south-east on screen, but for advice the player thinks in
  // plain map terms: -y is north, +x is east.
  const a = Math.atan2(dy, dx);
  const names = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  const i = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return names[i]!;
}

export function buildReport(input: ReportInput): BreachReport {
  const out = simulate(
    {
      snapshot: input.snapshot,
      commands: input.commands,
      army: input.army,
      seed: input.seed,
      hero: input.hero,
      troopLevels: input.troopLevels,
      pouch: input.pouch,
      items: input.items,
    },
    { timeline: true },
  );
  const events = out.timeline?.events ?? [];

  /* --- where they came in --- */
  const mid = N / 2;
  let sx = 0;
  let sy = 0;
  for (const c of input.commands) {
    sx += c.gx - mid;
    sy += c.gy - mid;
  }
  const n = input.commands.length || 1;
  const dx = sx / n;
  const dy = sy / n;

  /*
   * How lopsided the attack was.
   *
   * The length of the average offset over the average length of the offsets:
   * one if every deploy pointed the same way, near zero if they were spread
   * evenly round the hold. It is the difference between "your east side is
   * thin" and "they came from all over", and only the first is advice.
   */
  let spread = 0;
  for (const c of input.commands) spread += Math.hypot(c.gx - mid, c.gy - mid);
  const concentration = spread > 0 ? Math.hypot(dx, dy) / (spread / n) : 0;

  /* --- the structures, as the simulation indexed them --- */
  const standing = input.snapshot.buildings.filter((b) => !isTrap(b.type));
  const traps = input.snapshot.buildings.filter((b) => isTrap(b.type));

  const fell: BreachReport['fell'] = [];
  const fired = new Set<number>();
  const sprungAt = new Map<number, number>();

  for (const e of events) {
    if (e.k === 'structDead') {
      const b = standing[e.struct];
      // Ramparts fall by the dozen and say nothing about what went wrong.
      if (b && b.type !== 'wall') fell.push({ type: b.type, level: b.level, at: e.t * TICK_SECONDS });
    } else if (e.k === 'shot' && e.from === 'struct') {
      fired.add(e.src);
    } else if (e.k === 'trap') {
      sprungAt.set(e.trap, e.t * TICK_SECONDS);
    }
  }

  /*
   * Defences that never fired.
   *
   * The single most useful line the report has, because it is the one thing a
   * defender cannot see by watching: a Cannon covering ground nobody crossed
   * looks exactly like a Cannon doing its job right up until you count its
   * shots. A defence that fired and lost is a balance problem; a defence that
   * never fired is a placement problem, and only one of those is fixable this
   * afternoon.
   */
  const idle: BreachReport['idle'] = [];
  standing.forEach((b, i) => {
    if (!DEF_STAT[b.type]) return;
    if (!fired.has(i)) idle.push({ type: b.type, level: b.level });
  });

  // Counted from the frozen snapshot and the frozen army, so it says what was
  // true of the base at the moment it was attacked.
  const cover = standing.some((b) => coversAir(b.type));
  const byAir = TROOP_TYPES.some((t) => flies(t) && (input.army[t] ?? 0) > 0);

  return {
    airBlind: byAir && !cover,
    side: concentration < 0.35 ? 'everywhere' : compass(dx, dy),
    concentration,
    // Five is enough to see the order of a breach without listing the hold.
    fell: fell.slice(0, 5),
    idle,
    traps: traps.map((b, i) => ({
      type: b.type,
      level: b.level,
      sprung: sprungAt.has(i),
      at: sprungAt.get(i) ?? null,
    })),
    seconds: out.ticks * TICK_SECONDS,
  };
}

/** Names for the report, so the client does not hold a second copy of them. */
export function nameOf(type: BuildingType): string {
  return TYPES[type].n;
}
