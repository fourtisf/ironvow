import {
  BUILDING_TYPES, CAPACITY, DEF_STAT, TROOP, TROOP_ORDER, coversAir, troopPower,
} from '@ironvow/config';
import { describe, expect, it } from 'vitest';
import { buildingDetail, defenceTarget, troopCardStats, troopTrait } from '../lib/game/stats';

/**
 * What the cards say a thing does.
 *
 * ALFA: "harusnya kasih tau hp damage dll". The screens where a player chooses
 * between two things told them the price of each and nothing else. These tests
 * are less about the wording than about the one failure that matters — a number
 * on a card that the fight does not agree with, which is worse than no number,
 * because a player plans around it.
 */

describe('what a troop is', () => {
  it.each(TROOP_ORDER)('gives %s a trait', (type) => {
    expect(troopTrait(type).length).toBeGreaterThan(0);
  });

  it('describes the flags the simulation actually branches on', () => {
    expect(troopTrait('bomber')).toMatch(/flies/i);
    expect(troopTrait('scaler')).toMatch(/climb/i);
    expect(troopTrait('ram')).toMatch(/wall/i);
    expect(troopTrait('lancer')).toMatch(/defence/i);
    expect(troopTrait('archer')).toMatch(/flyer/i);
  });

  it('never claims a troop climbs or flies when it does not', () => {
    for (const type of TROOP_ORDER) {
      const d = TROOP[type];
      const trait = troopTrait(type);
      if (d.fly !== true) expect(trait, type).not.toMatch(/^Flies/);
      if (d.climb !== true) expect(trait, type).not.toMatch(/^Climbs/);
    }
  });

  it('rates damage a second, not damage a swing', () => {
    /*
     * The reason the card shows what it shows. An Archer hits for 21 and a
     * Raider for 16, so per swing the Archer looks a little better — but the
     * Raider swings every 0.80s and the Archer every 0.70, and the real gap is
     * half again. Per-swing damage is the number that flatters a slow unit, and
     * the Ram is the slowest thing in the game.
     */
    expect(TROOP.archer.dmg).toBeGreaterThan(TROOP.raider.dmg);
    const raider = troopCardStats('raider', 1);
    const archer = troopCardStats('archer', 1);
    expect(archer.dps).toBeGreaterThan(raider.dps);
    expect(archer.dps / raider.dps).toBeGreaterThan(1.4);
    // And the frailer of the two is still shown as frailer.
    expect(archer.hp).toBeLessThan(raider.hp);
  });

  it('shows the troop at the level the Laboratory has taken it to', () => {
    const one = troopCardStats('raider', 1);
    const five = troopCardStats('raider', 5);
    expect(five.hp).toBeGreaterThan(one.hp);
    expect(five.dps).toBeGreaterThan(one.dps);
    // The same curve the fight uses, not a second one that looks similar.
    expect(five.hp).toBe(Math.round(TROOP.raider.hp * troopPower(5)));
  });
});

describe('what a building is', () => {
  it.each(BUILDING_TYPES)('says something about %s', (type) => {
    // A card with a blank line under the price is worse than one without it.
    expect(buildingDetail(type, 1).trim().length).toBeGreaterThan(0);
  });

  it('reads a Storage out of the same constant the game fills', () => {
    /*
     * The bug this replaced: the inspector worked capacity out from
     * `1400 + level * 1500` while the game uses `CAPACITY`. A level 1 Storage
     * was reported as holding 2,900 against a real 24,000 — a screen inventing
     * a number and a player planning around it.
     */
    for (const level of [1, 4, 9]) {
      expect(buildingDetail('store', level)).toContain(CAPACITY(level).toLocaleString('en-US'));
    }
  });

  it('puts the Mortar dead zone on the same line as its reach', () => {
    // "range 9.2" alone is the half of the story that flatters it.
    expect(buildingDetail('mortar', 1)).toMatch(/range 3\.4–9\.2/);
    expect(buildingDetail('mortar', 1)).toContain('splash');
  });
});

describe('what a defence can shoot at', () => {
  it('says nothing at all about a building that is not a gun', () => {
    /*
     * `defenceHits` answers 'ground' for everything without a `DEF_STAT` — fine
     * for the simulation, where a Gold Mine never fires, and nonsense on a
     * label. It shipped "Hits ground only" onto the Storage, the Walls and the
     * Laboratory before this test existed.
     */
    for (const type of BUILDING_TYPES) {
      if (DEF_STAT[type]) continue;
      expect(defenceTarget(type, 1), type).toBeNull();
    }
  });

  it('tells every gun apart by what it can reach', () => {
    expect(defenceTarget('cannon', 1)).toBe('Hits ground only');
    expect(defenceTarget('airdef', 1)).toBe('Hits flyers only');
    expect(defenceTarget('tower', 1)).toBe('Hits flyers and ground');
  });

  it('agrees with `coversAir`, which is what the breach report reads', () => {
    for (const type of BUILDING_TYPES) {
      const label = defenceTarget(type, 1);
      if (label === null) continue;
      expect(/flyer/i.test(label), type).toBe(coversAir(type));
    }
  });
});
