import {
  SEASON_DAYS,
  SEASON_MIN_TROPHIES,
  SEASON_MS,
  SEASON_RESET_FLOOR,
  SEASON_TIERS,
  nextTier,
  seasonEnd,
  seasonLeft,
  seasonReset,
  seasonReward,
  tierAt,
} from '@ironvow/config';
import { describe, expect, it } from 'vitest';
import { longUntil } from '../lib/format';

/**
 * The season rules, as pure functions.
 *
 * These run on both sides — the worker pays with them, the banner previews
 * with them — so a disagreement here is a player being shown one number and
 * paid another.
 */

describe('season tiers', () => {
  it('ascend, and never overlap', () => {
    for (let i = 1; i < SEASON_TIERS.length; i++) {
      expect(SEASON_TIERS[i]!.at).toBeGreaterThan(SEASON_TIERS[i - 1]!.at);
      expect(SEASON_TIERS[i]!.reward.g).toBeGreaterThan(SEASON_TIERS[i - 1]!.reward.g);
    }
  });

  it('pays nothing below the first band', () => {
    expect(tierAt(SEASON_MIN_TROPHIES - 1)).toBeNull();
    expect(seasonReward(0)).toEqual({ g: 0, i: 0 });
    expect(seasonReward(SEASON_MIN_TROPHIES - 1)).toEqual({ g: 0, i: 0 });
  });

  it('puts a peak in exactly one band, at the boundary and just under it', () => {
    for (const t of SEASON_TIERS) {
      expect(tierAt(t.at)!.id).toBe(t.id);
      expect(tierAt(t.at + 1)!.id).toBe(t.id);
      const below = tierAt(t.at - 1);
      expect(below?.id).not.toBe(t.id);
    }
  });

  it('points at the next band up, and at nothing from the top one', () => {
    expect(nextTier(0)!.id).toBe(SEASON_TIERS[0]!.id);
    expect(nextTier(SEASON_TIERS[0]!.at)!.id).toBe(SEASON_TIERS[1]!.id);
    expect(nextTier(SEASON_TIERS[SEASON_TIERS.length - 1]!.at)).toBeNull();
  });
});

describe('the reset', () => {
  it('keeps the floor and half of everything above it', () => {
    expect(seasonReset(SEASON_RESET_FLOOR)).toBe(SEASON_RESET_FLOOR);
    expect(seasonReset(SEASON_RESET_FLOOR + 400)).toBe(SEASON_RESET_FLOOR + 200);
    expect(seasonReset(4_200)).toBe(SEASON_RESET_FLOOR + 2_000);
  });

  it('leaves a hold under the floor exactly where it is', () => {
    // Not raised to the floor: a season must not be a way to gain trophies by
    // losing them, and a free 200 every fortnight is exactly that.
    expect(seasonReset(0)).toBe(0);
    expect(seasonReset(80)).toBe(80);
  });

  it('is an integer, whatever the odd total', () => {
    for (const t of [201, 333, 999, 2_501]) expect(Number.isInteger(seasonReset(t))).toBe(true);
  });

  it('never climbs, and always converges downward on repeated closes', () => {
    let n = 5_000;
    for (let i = 0; i < 40; i++) {
      const next = seasonReset(n);
      expect(next).toBeLessThanOrEqual(n);
      n = next;
    }
    expect(n).toBe(SEASON_RESET_FLOOR);
  });
});

describe('the clock', () => {
  it('runs for the configured length', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    expect(seasonEnd(start).getTime() - start.getTime()).toBe(SEASON_MS);
    expect(SEASON_MS).toBe(SEASON_DAYS * 86_400_000);
  });

  it('floors at zero rather than counting up past the end', () => {
    const end = new Date('2026-01-01T00:00:00Z');
    expect(seasonLeft(end, new Date('2026-01-02T00:00:00Z'))).toBe(0);
    expect(seasonLeft(end, new Date('2025-12-31T00:00:00Z'))).toBe(86_400_000);
  });

  it('reads as days while there are days, and as hours on the last one', () => {
    expect(longUntil(3 * 86_400_000 + 4 * 3_600_000)).toBe('3d 4h');
    expect(longUntil(86_400_000)).toBe('1d 0h');
    // Under a day it falls through to the same formatter the builders use.
    expect(longUntil(2 * 3_600_000 + 60_000)).toMatch(/^2h/);
    expect(longUntil(0)).toBe('over');
    expect(longUntil(-5)).toBe('over');
  });
});
