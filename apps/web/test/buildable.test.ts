import { BUILDING_TYPES, TYPES, capOf } from '@ironvow/config';
import { describe, expect, it } from 'vitest';
import { BUILDABLE, VANITY } from '../components/Sheets';

/**
 * Everything the game has must be somewhere a player can tap it.
 *
 * The BUILD sheet walks two hand-written lists. A building added to the game
 * and forgotten here is not broken in any way a test or a type would catch —
 * it simply cannot be built, and nothing anywhere says so. That is exactly how
 * the Mortar shipped unbuildable.
 */
describe('the BUILD sheet offers every building there is', () => {
  const offered = new Set([...BUILDABLE, ...VANITY]);

  it('covers every type except the Keep, which is never bought', () => {
    for (const t of BUILDING_TYPES) {
      if (t === 'keep') continue;
      expect(offered, t).toContain(t);
    }
  });

  it('offers nothing that is not a building', () => {
    for (const t of offered) expect(BUILDING_TYPES).toContain(t);
  });

  it('lists each one once', () => {
    expect(offered.size).toBe(BUILDABLE.length + VANITY.length);
  });

  it('keeps the vanity list to things that actually do nothing', () => {
    for (const t of VANITY) expect(TYPES[t].cat).toBe('vanity');
  });

  it('offers nothing a Keep 9 could never own', () => {
    // A type with a cap of zero at the top of the game is a card that can only
    // ever read RAISE KEEP, which is a promise the game does not keep.
    for (const t of offered) expect(capOf(t as 'mine', 9), t).toBeGreaterThan(0);
  });
});
