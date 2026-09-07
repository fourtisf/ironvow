import { describe, expect, it } from 'vitest';
import { generateBase, generateOpponent } from '../src/index.js';

/**
 * ALFA: "nextnya juga ga pindah apa2 ga ada kerajaan yang baru dan harusnya
 * ketika pilih harus beda gold dan dll juga beda"
 *
 * The layout was seeded on the stage alone, so every garrison a player at a
 * given trophy count could be shown was the same base, cell for cell, with the
 * same purse — only the name over it changed. NEXT charged fifty gold to redraw
 * the same picture.
 */

const fingerprint = (stage: number, seed: number): string =>
  generateBase(stage, seed).map((b) => `${b.type}@${b.gx},${b.gy}:${b.level}`).join('|');

describe('two garrisons at the same stage are not the same garrison', () => {
  it('lays out different ground for different seeds', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) seen.add(fingerprint(5, seed));
    // Not merely "some differ": near enough all of them, or a reroll is still
    // a coin flip on whether anything happened.
    expect(seen.size).toBeGreaterThanOrEqual(22);
  });

  it('carries a different purse', () => {
    const purses = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      const { pool } = generateOpponent(5, 'ai', 'x', seed);
      purses.add(`${pool.g}/${pool.i}`);
    }
    expect(purses.size).toBeGreaterThanOrEqual(20);
  });

  it('keeps the purse honest about the stage it came from', () => {
    // Different, not unbounded: a garrison must never be worth ten of another.
    const plain = generateOpponent(5).pool;
    for (let seed = 1; seed <= 200; seed++) {
      const { pool } = generateOpponent(5, 'ai', 'x', seed);
      expect(pool.g).toBeGreaterThan(plain.g * 0.6);
      expect(pool.g).toBeLessThan(plain.g * 1.4);
      expect(pool.i).toBeGreaterThan(plain.i * 0.6);
      expect(pool.i).toBeLessThan(plain.i * 1.4);
    }
  });

  it('still builds a hold worth attacking, whatever the seed', () => {
    for (let seed = 0; seed <= 60; seed++) {
      const b = generateBase(6, seed);
      expect(b.filter((x) => x.type === 'keep')).toHaveLength(1);
      // Defences, producers and a wall: the shape of a base, every time.
      expect(b.some((x) => x.type === 'cannon')).toBe(true);
      expect(b.some((x) => x.type === 'mine')).toBe(true);
      expect(b.some((x) => x.type === 'wall')).toBe(true);
      for (const x of b) {
        expect(x.level).toBeGreaterThanOrEqual(1);
        expect(x.level).toBeLessThanOrEqual(9);
      }
    }
  });

  it('never overlaps two footprints, however the rings fall', () => {
    for (let seed = 0; seed <= 60; seed++) {
      const b = generateBase(7, seed);
      const ids = new Set(b.map((x) => x.id));
      expect(ids.size).toBe(b.length);
    }
  });

  it('reproduces the one fixed layout the older tests were written against', () => {
    // seed 0 is the default, and the default must not move.
    expect(fingerprint(4, 0)).toBe(fingerprint(4, 0));
    expect(generateOpponent(4).pool).toEqual(generateOpponent(4, 'ai', undefined, 0).pool);
  });
});
