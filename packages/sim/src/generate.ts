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

/** Generated opponent for Phase 1, ported from the prototype's `genEnemy`. */
export function generateBase(stage: number): SnapshotBuilding[] {
  const r = mulberry(9001 + stage * 7919);
  const lv = clamp(1 + Math.floor(stage / 2), 1, 9);
  const out: SnapshotBuilding[] = [];
  const mid = Math.floor(N / 2) - 1;

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

  put('keep', mid, mid, lv);

  const dn = clamp(1 + Math.floor(stage / 2), 1, 6);
  for (let i = 0; i < dn; i++) {
    const a = (i / dn) * 6.283 + r();
    put('cannon', Math.round(mid + 1 + Math.cos(a) * 4.6), Math.round(mid + 1 + Math.sin(a) * 4.6), lv);
  }

  const tn = stage >= 3 ? clamp(Math.floor(stage / 3), 1, 5) : 0;
  for (let i = 0; i < tn; i++) {
    const a = (i / Math.max(1, tn)) * 6.283 + 0.8 + r();
    put('tower', Math.round(mid + 1 + Math.cos(a) * 6.6), Math.round(mid + 1 + Math.sin(a) * 6.6), lv);
  }

  const mn = clamp(2 + Math.floor(stage / 3), 2, 6);
  for (let i = 0; i < mn; i++) {
    const a = (i / mn) * 6.283 + 2.1;
    put('mine', Math.round(mid + 1 + Math.cos(a) * 7.4), Math.round(mid + 1 + Math.sin(a) * 7.4), lv);
  }

  if (stage >= 2) {
    for (let i = 0; i < clamp(Math.floor(stage / 3), 1, 4); i++) {
      const a = (i / 3) * 6.283 + 4.0;
      put('forge', Math.round(mid + 1 + Math.cos(a) * 8.2), Math.round(mid + 1 + Math.sin(a) * 8.2), lv);
    }
  }

  /*
   * Muster Fields. Added after the producers, so they take whatever ground is
   * left rather than pushing a mine off the layout — and only from stage 2,
   * because a garrison small enough to be a new player's first raid should not
   * have an army camp on it.
   */
  if (stage >= 2) {
    for (let i = 0; i < clamp(Math.floor(stage / 4) + 1, 1, 3); i++) {
      const a = (i / 3) * 6.283 + 5.4;
      put('camp', Math.round(mid + 1 + Math.cos(a) * 9.4), Math.round(mid + 1 + Math.sin(a) * 9.4), lv);
    }
  }

  const wr = 3.1;
  const wn = Math.min(8 + stage * 3, 44);
  for (let i = 0; i < wn; i++) {
    const a = (i / wn) * 6.283;
    put('wall', Math.round(mid + 1 + Math.cos(a) * wr), Math.round(mid + 1 + Math.sin(a) * wr), lv);
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
export function generateOpponent(stage: number, defenderId = 'ai', defenderName?: string): BaseSnapshot {
  const buildings = generateBase(stage);
  const keep = buildings.find((b) => b.type === 'keep');
  return {
    version: 1,
    defenderId,
    defenderName: defenderName ?? 'Raider Camp',
    keepLevel: keep?.level ?? 1,
    buildings,
    pool: stageLoot(stage),
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
