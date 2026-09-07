import { KEEP_MAX, N, TYPES, capOf } from '@ironvow/config';
import { describe, expect, it } from 'vitest';
import { showcaseHold } from '../lib/game/showcase';

/**
 * ALFA: "landing page gamenya yang sudah level semua maximal"
 *
 * The door is the first thing anyone ever sees of the game, and it was showing
 * a stage-four garrison: level-three buildings and none of the art the game
 * spends its levels on. It shows a finished hold now — and a showcase that
 * breaks the game's own rules would be a lie about the game, so these check it
 * is a hold somebody could actually own.
 */
describe('the hold behind the door', () => {
  const hold = showcaseHold();

  it('is maxed, every last building', () => {
    expect(hold.buildings.length).toBeGreaterThan(40);
    for (const b of hold.buildings) expect(b.level).toBe(KEEP_MAX);
    expect(hold.keepLevel).toBe(KEEP_MAX);
  });

  it('shows the whole game: economy, defence, army and the things that do nothing', () => {
    const kinds = new Set(hold.buildings.map((b) => b.type));
    for (const t of ['keep', 'mine', 'forge', 'store', 'barr', 'camp', 'lab',
      'cannon', 'tower', 'wall', 'statue', 'brazier', 'standard'] as const) {
      expect(kinds).toContain(t);
    }
  });

  it('owns nothing a Keep of its level could not', () => {
    const counts = new Map<string, number>();
    for (const b of hold.buildings) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
    for (const [type, n] of counts) {
      expect(n).toBeLessThanOrEqual(capOf(type as 'mine', KEEP_MAX));
    }
    expect(counts.get('keep')).toBe(1);
  });

  it('stands on the field, with nothing overlapping anything', () => {
    for (let i = 0; i < hold.buildings.length; i++) {
      const a = hold.buildings[i]!;
      const as = TYPES[a.type].s;
      expect(a.gx).toBeGreaterThanOrEqual(2);
      expect(a.gy).toBeGreaterThanOrEqual(2);
      expect(a.gx + as).toBeLessThanOrEqual(N - 2);
      expect(a.gy + as).toBeLessThanOrEqual(N - 2);
      for (let j = i + 1; j < hold.buildings.length; j++) {
        const b = hold.buildings[j]!;
        const bs = TYPES[b.type].s;
        const hit = a.gx < b.gx + bs && a.gx + as > b.gx && a.gy < b.gy + bs && a.gy + as > b.gy;
        expect(hit).toBe(false);
      }
    }
  });

  it('is symmetric about its own Keep', () => {
    const keep = hold.buildings.find((b) => b.type === 'keep')!;
    expect(keep.gx).toBe(27);
    expect(keep.gy).toBe(27);
    // Every building's mirror image is also a building of the same kind.
    const key = (t: string, x: number, y: number) => `${t}@${x},${y}`;
    const all = new Set(hold.buildings.map((b) => key(b.type, b.gx, b.gy)));
    let mirrored = 0;
    for (const b of hold.buildings) {
      const s = TYPES[b.type].s;
      if (all.has(key(b.type, 57 - b.gx - s, b.gy))) mirrored++;
    }
    // Not every piece — the Lab is one of one — but the shape of the hold.
    expect(mirrored / hold.buildings.length).toBeGreaterThan(0.9);
  });

  it('is compact enough to frame', () => {
    // The door puts a card over the middle of it; a hold sprawling across the
    // whole map would be framed so far out the art it is showing off is gone.
    let x0 = N; let y0 = N; let x1 = 0; let y1 = 0;
    for (const b of hold.buildings) {
      const s = TYPES[b.type].s;
      x0 = Math.min(x0, b.gx); y0 = Math.min(y0, b.gy);
      x1 = Math.max(x1, b.gx + s); y1 = Math.max(y1, b.gy + s);
    }
    expect(x1 - x0).toBeLessThanOrEqual(34);
    expect(y1 - y0).toBeLessThanOrEqual(34);
  });
});
