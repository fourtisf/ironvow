import {
  IN0,
  IN1,
  N,
  TYPES,
  clamp,
  stageLoot,
  type BuildingType,
} from '@ironvow/config';
import type { BaseSnapshot, DefendWaveUnit, SnapshotBuilding } from '@ironvow/types';
import { mulberry } from './rng.js';

/**
 * Snapshot builders.
 *
 * These run on the server only, once, before a battle starts. Their output is
 * frozen into the Raid row, so they are the one place in the game where
 * trigonometry is allowed: every client then reads the same finished numbers
 * rather than recomputing them.
 */

/*
 * Generated opponents.
 *
 * ALFA: "nextnya juga ga pindah apa2 ga ada kerajaan yang baru dan harusnya
 * ketika pilih harus beda gold dan dll juga beda"
 *
 * Because the layout was seeded on the stage and nothing else. Every garrison a
 * player at the same trophy count could ever be shown was the same base, cell
 * for cell, with the same loot — only the name over it changed. So NEXT charged
 * fifty gold to redraw the same picture, which is the worst thing a paid button
 * can do.
 *
 * The seed is threaded through now, and it moves more than the noise: how the
 * ring is laid out, how far each ring sits, how many of everything, the level of
 * each individual building, and the purse. Two garrisons at the same stage are
 * the same difficulty and not the same base.
 *
 * `seed` defaults to zero, which reproduces the one fixed layout the tests were
 * written against.
 */

/** The three shapes a garrison comes in. */
const LAYOUTS = [
  // Tight: defences close in, producers behind them. A hard core.
  { def: 4.0, tower: 5.8, mine: 7.0, forge: 7.8, camp: 8.8, wall: 2.8 },
  // Spread: everything pushed out, walls wide, more ground to walk.
  { def: 5.4, tower: 7.4, mine: 8.6, forge: 9.4, camp: 10.6, wall: 3.6 },
  // Layered: defences outside the producers, which is the awkward one to raid.
  { def: 6.8, tower: 4.4, mine: 7.8, forge: 6.2, camp: 9.8, wall: 3.2 },
] as const;

export function generateBase(stage: number, seed = 0): SnapshotBuilding[] {
  const r = mulberry(9001 + stage * 7919 + seed);
  const lv = clamp(1 + Math.floor(stage / 2), 1, 9);
  const out: SnapshotBuilding[] = [];
  const mid = Math.floor(N / 2) - 1;
  const L = LAYOUTS[Math.floor(r() * LAYOUTS.length)] ?? LAYOUTS[0];

  /**
   * One building's level.
   *
   * A garrison whose every building is the same level reads as a template. A
   * point either way is enough to make one look like somebody lived in it, and
   * the average is unchanged, so the difficulty of a stage is not moved by it.
   */
  const near = (): number => {
    const roll = r();
    return clamp(lv + (roll < 0.24 ? 1 : roll < 0.48 ? -1 : 0), 1, 9);
  };
  /** A count, give or take one, held inside its own limits. */
  const about = (n: number, lo: number, hi: number): number =>
    clamp(n + (r() < 0.5 ? 0 : r() < 0.5 ? 1 : -1), lo, hi);

  const put = (type: BuildingType, gx: number, gy: number, level?: number): boolean => {
    const s = TYPES[type].s;
    if (gx < IN0 || gy < IN0 || gx + s > IN1 || gy + s > IN1) return false;
    for (const b of out) {
      const bs = TYPES[b.type].s;
      if (gx < b.gx + bs && gx + s > b.gx && gy < b.gy + bs && gy + s > b.gy) return false;
    }
    out.push({ id: 'g' + (out.length + 1), type, gx, gy, level: clamp(level ?? lv, 1, 9) });
    return true;
  };

  /** A ring of `n` of something, turned by its own offset. */
  const ring = (
    type: BuildingType, n: number, radius: number, turn: number,
  ): void => {
    if (n <= 0) return;
    const spin = turn + r() * 6.283;
    for (let i = 0; i < n; i++) {
      // Each one wanders off its slot a little, so a ring is a ring and not a
      // clock face.
      const a = (i / n) * 6.283 + spin + (r() - 0.5) * 0.5;
      const rad = radius + (r() - 0.5) * 1.2;
      put(type, Math.round(mid + 1 + Math.cos(a) * rad), Math.round(mid + 1 + Math.sin(a) * rad), near());
    }
  };

  put('keep', mid, mid, lv);

  ring('cannon', about(1 + Math.floor(stage / 2), 1, 6), L.def, 0);
  ring('tower', stage >= 3 ? about(Math.floor(stage / 3), 1, 5) : 0, L.tower, 0.8);
  ring('mine', about(2 + Math.floor(stage / 3), 2, 6), L.mine, 2.1);
  if (stage >= 2) ring('forge', about(Math.floor(stage / 3), 1, 4), L.forge, 4.0);

  /*
   * Muster Fields. Added after the producers, so they take whatever ground is
   * left rather than pushing a mine off the layout — and only from stage 2,
   * because a garrison small enough to be a new player's first raid should not
   * have an army camp on it.
   */
  if (stage >= 2) ring('camp', about(Math.floor(stage / 4) + 1, 1, 3), L.camp, 5.4);

  const wr = L.wall + (r() - 0.5) * 0.6;
  const wn = Math.round(Math.min(8 + stage * 3, 44) * (0.75 + r() * 0.5));
  for (let i = 0; i < wn; i++) {
    const a = (i / wn) * 6.283;
    put('wall', Math.round(mid + 1 + Math.cos(a) * wr), Math.round(mid + 1 + Math.sin(a) * wr), near());
  }

  return out;
}

/**
 * Names for generated holds.
 *
 * Chosen from the seed rather than at random, so the same raid always shows the
 * same name — a replay of it months later has to look like the raid that
 * happened, not a different one.
 */
const GARRISON_NAMES = [
  'Raider Camp', 'Broken Watch', 'Ashen Outpost', 'Fallow Keep', 'Mudgate',
  'Thornwatch', 'Old Barrow', 'Rusted Hold', 'Greyditch', 'Emberfast',
  'Stonehollow', 'Wolfstead', 'Bleak Rise', 'Duskgate', 'Harrowmoor',
];

export function garrisonName(seed: number): string {
  const r = mulberry(seed);
  return GARRISON_NAMES[Math.floor(r() * GARRISON_NAMES.length)] ?? GARRISON_NAMES[0]!;
}

/**
 * A whole generated opponent, base plus loot pool.
 *
 * Used as the floor under trophy matchmaking: a new player at zero trophies on
 * a quiet server has nobody in band, and a RAID button that answers "no
 * opponent" is worse than one that finds a garrison to hit. The loot comes from
 * the stage curve rather than from anyone's stores, so nothing is taken from a
 * player who does not exist.
 */
export function generateOpponent(
  stage: number, defenderId = 'ai', defenderName?: string, seed = 0,
): BaseSnapshot {
  const buildings = generateBase(stage, seed);
  const keep = buildings.find((b) => b.type === 'keep');
  /*
   * And the purse, which was the other half of "everything should be
   * different": two garrisons at the same stage held identical gold to the
   * coin. It swings by a third either way, gold and iron drawn separately, so
   * one is worth crossing the map for and the next one is not. The average is
   * `stageLoot` untouched, so the stage curve is the stage curve.
   */
  const r = mulberry(7717 + seed * 131 + stage);
  const base = stageLoot(stage);
  const swing = (): number => 0.68 + r() * 0.64;
  return {
    version: 1,
    defenderId,
    defenderName: defenderName ?? 'Raider Camp',
    keepLevel: keep?.level ?? 1,
    buildings,
    pool: seed === 0
      ? base
      : { g: Math.round(base.g * swing()), i: Math.round(base.i * swing()) },
  };
}

/** The AI wave that assaults you in a defend battle, ported from `startDefend`. */
export function generateDefendWave(seed: number, stage: number): DefendWaveUnit[] {
  const r = mulberry(seed);
  const n = clamp(4 + Math.floor(stage * 1.6), 4, 22);
  const mid = N / 2;
  const out: DefendWaveUnit[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + r() * 0.4;
    const rad = 10.5;
    // The prototype short-circuits here, so the second draw only happens when
    // the first one did not produce a lancer. Consuming an extra number would
    // shift every later roll.
    const type: DefendWaveUnit['type'] =
      r() < 0.2 && stage >= 3 ? 'lancer' : r() < 0.28 ? 'archer' : 'raider';
    out.push({
      type,
      x: mid + Math.cos(a) * rad,
      y: mid + Math.sin(a) * rad,
      scale: 1 + stage * 0.06,
    });
  }
  return out;
}
