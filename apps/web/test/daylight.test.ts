import { describe, expect, it } from 'vitest';
import {
  PHASES, SKY_ORDER, msUntilNextPhase, nextSky, nightLevel, phaseAt, phaseFor, skyLabel,
} from '../lib/game/daylight';

/**
 * Morning, day, sunset, night.
 *
 * ALFA: "apakah ada tema gelap??" — then "kaya pagi siang sore malam". Not a
 * dark theme for the interface: the hour of the day, on the field.
 *
 * The hours are local on purpose. The point of the feature is that the game
 * agrees with the window next to the player, and UTC would put half the world's
 * evening at breakfast — so these tests build local dates and never ISO strings.
 */

/** A local time today, which is what the player's phone reports. */
const at = (hour: number, minute = 0): Date => {
  const d = new Date(2026, 8, 8, hour, minute, 0, 0);
  return d;
};

describe('what time it is on the field', () => {
  it('gives every hour of the day exactly one phase', () => {
    for (let h = 0; h < 24; h++) {
      expect(PHASES).toContain(phaseAt(at(h)));
    }
  });

  it('names the hours the way a person would', () => {
    expect(phaseAt(at(7))).toBe('morning');
    expect(phaseAt(at(13))).toBe('day');
    expect(phaseAt(at(18))).toBe('sunset');
    expect(phaseAt(at(23))).toBe('night');
    expect(phaseAt(at(3))).toBe('night');
  });

  it('uses all four, so none of them is unreachable', () => {
    const seen = new Set(Array.from({ length: 24 }, (_, h) => phaseAt(at(h))));
    expect([...seen].sort()).toEqual([...PHASES].sort());
  });

  it('changes on the hour and never in the middle of one', () => {
    for (let h = 0; h < 24; h++) {
      expect(phaseAt(at(h, 0)), `${h}:00`).toBe(phaseAt(at(h, 59)));
    }
  });
});

describe('waiting for the sky to change', () => {
  it('lands exactly on the hour the phase turns', () => {
    // 10:20 is morning; day starts at 11.
    const now = at(10, 20);
    const then = new Date(now.getTime() + msUntilNextPhase(now));
    expect(then.getHours()).toBe(11);
    expect(then.getMinutes()).toBe(0);
    expect(phaseAt(then)).not.toBe(phaseAt(now));
  });

  it('always waits a positive time, from any minute of any hour', () => {
    /*
     * The failure this guards is a zero or negative wait, which is a timer that
     * fires straight back into itself — a page pinned at a hundred per cent CPU
     * rather than a page with the wrong colours, and far harder to notice.
     */
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 1, 30, 59]) {
        const now = at(h, m);
        const ms = msUntilNextPhase(now);
        expect(ms, `${h}:${m}`).toBeGreaterThan(0);
        expect(phaseAt(new Date(now.getTime() + ms)), `${h}:${m}`).not.toBe(phaseAt(now));
      }
    }
  });

  it('never waits longer than the longest phase', () => {
    // Night is the longest at nine hours, so nothing may wait beyond it.
    for (let h = 0; h < 24; h++) {
      expect(msUntilNextPhase(at(h)), String(h)).toBeLessThanOrEqual(9 * 3_600_000);
    }
  });
});

describe('what the player chose', () => {
  it('follows the clock on auto and ignores it otherwise', () => {
    expect(phaseFor('auto', at(2))).toBe('night');
    expect(phaseFor('day', at(2))).toBe('day');
    expect(phaseFor('night', at(13))).toBe('night');
  });

  it('walks through every setting and comes back to auto', () => {
    let s = SKY_ORDER[0]!;
    const seen = [s];
    for (let i = 0; i < SKY_ORDER.length - 1; i++) {
      s = nextSky(s);
      seen.push(s);
    }
    expect(seen).toEqual(SKY_ORDER);
    expect(nextSky(s)).toBe('auto');
  });

  it('says which it is, in words rather than a code', () => {
    expect(skyLabel('auto', at(21))).toContain('night');
    expect(skyLabel('auto', at(21))).toContain('clock');
    expect(skyLabel('sunset', at(21))).toBe('Always sunset');
  });
});

describe('how dark it is', () => {
  it('is nothing by day and everything at night', () => {
    expect(nightLevel('day')).toBe(0);
    expect(nightLevel('morning')).toBe(0);
    expect(nightLevel('night')).toBe(1);
  });

  it('puts sunset between the two, which is where a torch starts to show', () => {
    expect(nightLevel('sunset')).toBeGreaterThan(0);
    expect(nightLevel('sunset')).toBeLessThan(1);
  });

  it('stays inside the range the painters multiply by', () => {
    for (const p of PHASES) {
      expect(nightLevel(p), p).toBeGreaterThanOrEqual(0);
      expect(nightLevel(p), p).toBeLessThanOrEqual(1);
    }
  });
});
