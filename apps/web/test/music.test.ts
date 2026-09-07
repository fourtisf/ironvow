import { describe, expect, it } from 'vitest';
import { THEMES } from '../lib/music';

/**
 * The music is written out rather than improvised, which means it can be
 * checked like anything else that is written down.
 *
 * The failure these guard against is the worst kind: not a crash, but a piece
 * that plays perfectly happily and is wrong — a tune that drifts a beat
 * against its own chords, or a mode with a note in it that is not in the mode.
 * Nobody reading the arrays would spot either.
 */

const { HOLD, WAR, MODES, pitch, loopBeats } = THEMES;

describe('the written themes', () => {
  for (const [name, section] of [['hold', HOLD], ['raid', WAR]] as const) {
    it(`${name}: the melody is exactly as long as the chord loop`, () => {
      const beats = section.melody.reduce((sum, [, b]) => sum + b, 0);
      expect(beats).toBe(loopBeats(section));
    });

    it(`${name}: every note lands on a half beat`, () => {
      // The sequencer looks for a note every half beat, so anything finer
      // would simply never be played — silently.
      let cursor = 0;
      for (const [, beats] of section.melody) {
        expect(cursor * 2 % 1).toBe(0);
        cursor += beats;
      }
    });

    it(`${name}: the loop opens and closes on the tonic`, () => {
      expect(section.chords[0]).toBe(0);
      expect(section.chords[section.chords.length - 1]).toBe(0);
    });
  }

  it('the two modes differ in exactly one note', () => {
    // Dorian against Aeolian: the sixth. That one semitone is the whole
    // difference between the hold and the raid, so if it ever became two the
    // moods would stop sounding like the same place.
    const differences = MODES.base.filter((step, i) => step !== MODES.battle[i]);
    expect(differences).toEqual([9]);
  });

  it('degree 7 is the tonic an octave up', () => {
    expect(pitch('base', 7) / pitch('base', 0)).toBeCloseTo(2, 6);
    expect(pitch('battle', 14) / pitch('battle', 0)).toBeCloseTo(4, 6);
  });

  it('every chord builds a triad inside the mode', () => {
    for (const [name, section] of [['hold', HOLD], ['raid', WAR]] as const) {
      for (const root of section.chords) {
        // Stacking two scale degrees at a time is what keeps a triad diatonic;
        // the third comes out minor or major depending on where it sits.
        const third = pitch(name === 'hold' ? 'base' : 'battle', root + 2)
          / pitch(name === 'hold' ? 'base' : 'battle', root);
        const semitones = Math.round(Math.log2(third) * 12);
        expect([3, 4]).toContain(semitones);
      }
    }
  });
});
