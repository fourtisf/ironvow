import { NEWS, NEWS_LATEST, TROOP, TYPES, unseenNews } from '@ironvow/config';
import { describe, expect, it } from 'vitest';

/**
 * What's New.
 *
 * The panel exists because the game changed every few days and nobody playing
 * it was told. The failures worth guarding are all quiet ones: a note that
 * names a building that no longer exists, a numbering mistake that shows a
 * player a note twice or never, and a note added without its number bumped —
 * which silently vanishes for everybody already caught up.
 */
describe('the notes themselves', () => {
  it('numbers every note once, and runs newest first', () => {
    const nos = NEWS.map((n) => n.no);
    expect(new Set(nos).size).toBe(nos.length);
    // Strictly descending: the array order is the display order.
    expect(nos).toEqual([...nos].sort((a, b) => b - a));
  });

  it('agrees with itself about which note is the latest', () => {
    expect(NEWS_LATEST).toBe(Math.max(...NEWS.map((n) => n.no)));
    expect(NEWS[0]?.no).toBe(NEWS_LATEST);
  });

  it('dates every note, and says something in each', () => {
    for (const n of NEWS) {
      expect(n.at, n.title).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(n.title.length, n.title).toBeGreaterThan(0);
      expect(n.lines.length, n.title).toBeGreaterThan(0);
      for (const l of n.lines) expect(l.trim(), n.title).not.toBe('');
    }
  });

  it('only names things that are still in the game', () => {
    /*
     * A note is written once and read for months. The rename pass is exactly
     * the sort of change that would leave one talking about a building nobody
     * can find, and nothing else in the tree would notice.
     */
    const text = NEWS.flatMap((n) => [n.title, ...n.lines]).join(' ');
    const named = [
      TYPES.airdef.n, TYPES.mortar.n, TYPES.spike.n, TYPES.snare.n,
      TYPES.keep.n, TYPES.wall.n, TYPES.camp.n, TYPES.barr.n,
      TROOP.bomber.n, TROOP.archer.n,
    ];
    for (const name of named) expect(text, `NEWS should still say "${name}"`).toContain(name);
  });
});

describe('what a given player is shown', () => {
  it('shows everything to somebody who has read nothing', () => {
    expect(unseenNews(0)).toEqual([...NEWS]);
  });

  it('shows nothing to somebody who is caught up', () => {
    expect(unseenNews(NEWS_LATEST)).toEqual([]);
  });

  it('shows only what was published after the note they last read', () => {
    const middle = NEWS[Math.floor(NEWS.length / 2)]!;
    const shown = unseenNews(middle.no);
    expect(shown.every((n) => n.no > middle.no)).toBe(true);
    expect(shown.some((n) => n.no === middle.no)).toBe(false);
    expect(shown.length).toBe(NEWS.filter((n) => n.no > middle.no).length);
  });

  it('never shows a note twice as the player reads forward', () => {
    /*
     * Walk the whole run the way a player does — read what you are shown, come
     * back later — and every note should arrive exactly once. An off-by-one in
     * `unseenNews` shows one twice or drops one, and both look like nothing.
     */
    const seenCounts = new Map<number, number>();
    let seen = 0;
    let guard = 0;
    while (seen < NEWS_LATEST && guard++ < 100) {
      const batch = unseenNews(seen);
      expect(batch.length).toBeGreaterThan(0);
      // A player reads one at a time here; the panel shows the whole batch.
      const next = batch[batch.length - 1]!;
      for (const n of batch.filter((b) => b.no <= next.no)) {
        seenCounts.set(n.no, (seenCounts.get(n.no) ?? 0) + 1);
      }
      seen = next.no;
    }
    expect(seen).toBe(NEWS_LATEST);
    for (const n of NEWS) expect(seenCounts.get(n.no), `note ${n.no}`).toBe(1);
  });
});
