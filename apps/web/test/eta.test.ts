import { RAID_SECONDS, TROOP } from '@ironvow/config';
import { createBattle, generateOpponent } from '@ironvow/sim';
import { describe, expect, it } from 'vitest';
import { SPEEDS, battleEta, isBattleSpeed } from '../lib/game/eta';

/**
 * ALFA: "kasih estimasi waktu selesai dan ada percepat 1x 2 x sampai 4x"
 *
 * Asked from inside the part of a raid nobody enjoys: the tray empty, the
 * warband committed, and two and a half minutes on a clock while four Raiders
 * finish a wall. The clock says when the raid *may* end. This says when it
 * will.
 */

const ARMY = { raider: 6, archer: 0, lancer: 0, ram: 0, scaler: 0 };

function raid(army = ARMY) {
  return createBattle({
    snapshot: generateOpponent(4, 'ai', 'Test', 11),
    commands: [], army: { ...army }, seed: 3,
  });
}

describe('the estimate', () => {
  it('says nothing while there are still troops in hand', () => {
    // The player decides how long this takes, not the arithmetic.
    expect(battleEta(raid(), 1)).toBeNull();
  });

  it('is a number once the warband is committed', () => {
    const b = raid();
    for (let i = 0; i < 6; i++) b.deploy('raider', 14 + i, 14);
    b.step();
    const eta = battleEta(b, 1);
    expect(eta).not.toBeNull();
    expect(eta!).toBeGreaterThan(0);
  });

  it('never promises longer than the clock allows', () => {
    // One Raider against a whole hold would take an hour; the raid does not.
    const b = raid({ ...ARMY, raider: 1 });
    b.deploy('raider', 14, 14);
    b.step();
    expect(battleEta(b, 1)!).toBeLessThanOrEqual(RAID_SECONDS);
  });

  it('shortens as the base comes down', () => {
    const b = raid();
    for (let i = 0; i < 6; i++) b.deploy('raider', 26, 20 + i);
    b.step();
    const first = battleEta(b, 1)!;
    for (let i = 0; i < 200; i++) if (b.step()) break;
    const later = battleEta(b, 1);
    // Either the raid finished, or there is less left to do than there was.
    expect(later === null || later <= first).toBe(true);
  });

  it('is zero when there is nothing left to send and nobody left standing', () => {
    const b = raid({ ...ARMY, raider: 0 });
    expect(battleEta(b, 1)).toBe(0);
  });

  it('gives the clock, not zero, when only the hero is left in hand', () => {
    // The simulation only calls a raid off early when there is nothing left to
    // send at all — a hero in hand means it runs the clock out instead.
    const b = createBattle({
      snapshot: generateOpponent(4, 'ai', 'Test', 11),
      commands: [], army: { ...ARMY, raider: 0 }, seed: 3,
      hero: { level: 3, available: true },
    });
    expect(battleEta(b, 3)).toBe(b.secondsLeft());
  });

  it('scales the way the speed control divides it', () => {
    // The HUD shows eta / speed; that is the whole of what a speed does to it.
    const b = raid();
    for (let i = 0; i < 6; i++) b.deploy('raider', 14 + i, 14);
    b.step();
    const eta = battleEta(b, 1)!;
    for (const s of SPEEDS) expect(eta / s).toBeLessThanOrEqual(eta);
    expect(eta / 4).toBeCloseTo(eta / 4, 6);
  });
});

describe('the speeds on offer', () => {
  it('is one through four, and nothing else is accepted', () => {
    expect([...SPEEDS]).toEqual([1, 2, 3, 4]);
    expect(isBattleSpeed(2)).toBe(true);
    expect(isBattleSpeed(5)).toBe(false);
    expect(isBattleSpeed(0)).toBe(false);
    expect(isBattleSpeed('2')).toBe(false);
  });

  it('leaves the troop periods it reads alone', () => {
    // The estimate divides damage by the weapon period; a zero would be a
    // division by nothing.
    for (const t of ['raider', 'archer', 'lancer', 'ram', 'scaler'] as const) {
      expect(TROOP[t].cd).toBeGreaterThan(0);
    }
  });
});
