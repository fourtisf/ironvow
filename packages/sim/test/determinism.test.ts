import { describe, expect, it } from 'vitest';
import { RAID_TICKS, TICKS_PER_SECOND } from '@ironvow/config';
import type { BattleArmy, DeployCommand } from '@ironvow/types';
import { generateOpponent, simulate } from '../src/index.js';

const ARMY: BattleArmy = { raider: 14, archer: 8, lancer: 4, ram: 2 };

function commands(): DeployCommand[] {
  const out: DeployCommand[] = [];
  const ring: [number, number][] = [
    [18, 27], [20, 20], [27, 18], [35, 20], [38, 27], [35, 35], [27, 38], [20, 35],
  ];
  let i = 0;
  for (const t of ['ram', 'lancer', 'raider', 'archer'] as const) {
    const n = ARMY[t];
    for (let k = 0; k < n; k++) {
      const spot = ring[i % ring.length]!;
      out.push({
        tickIndex: Math.floor(i / 2) * 3,
        troopType: t,
        gx: spot[0] + (k % 3) * 0.25,
        gy: spot[1] + (k % 2) * 0.25,
      });
      i++;
    }
  }
  return out;
}

const INPUT = {
  snapshot: generateOpponent(6),
  commands: commands(),
  army: ARMY,
  seed: 123456789,
} as const;

describe('simulate() is deterministic', () => {
  it('produces byte-identical results across 1000 runs', () => {
    const first = simulate(INPUT);
    for (let i = 0; i < 1000; i++) {
      const again = simulate(INPUT);
      expect(again.checksum).toBe(first.checksum);
      expect(again.stars).toBe(first.stars);
      expect(again.destroyedPct).toBe(first.destroyedPct);
      expect(again.loot).toEqual(first.loot);
      expect(again.ticks).toBe(first.ticks);
      expect(again.endedBy).toBe(first.endedBy);
    }
  });

  it('does not mutate its inputs', () => {
    const before = JSON.stringify(INPUT);
    simulate(INPUT);
    simulate(INPUT);
    expect(JSON.stringify(INPUT)).toBe(before);
  });

  it('gives the same answer whether or not a timeline is recorded', () => {
    const bare = simulate(INPUT);
    const traced = simulate(INPUT, { timeline: true });
    expect(traced.checksum).toBe(bare.checksum);
    expect(traced.timeline!.events.length).toBeGreaterThan(0);
  });

  it('changes its result when a single deploy moves by one grid cell', () => {
    const nudged = INPUT.commands.map((c, i) => (i === 0 ? { ...c, gx: c.gx + 1 } : c));
    expect(simulate({ ...INPUT, commands: nudged }).checksum).not.toBe(simulate(INPUT).checksum);
  });

  it('reproduces a stored result from seed, snapshot and commands alone', () => {
    // Exactly what the server does when a defender opens a replay months later.
    const stored = simulate(INPUT);
    const rehydrated = simulate({
      snapshot: JSON.parse(JSON.stringify(INPUT.snapshot)),
      commands: JSON.parse(JSON.stringify(INPUT.commands)),
      army: { ...ARMY },
      seed: INPUT.seed,
    });
    expect(rehydrated.checksum).toBe(stored.checksum);
    expect(rehydrated.loot).toEqual(stored.loot);
    expect(rehydrated.stars).toBe(stored.stars);
  });
});

describe('simulate() rejects what a client should not be able to do', () => {
  it('refuses deploys beyond the army the attacker actually has', () => {
    const greedy = [
      ...INPUT.commands,
      { tickIndex: 200, troopType: 'ram' as const, gx: 18, gy: 27 },
      { tickIndex: 201, troopType: 'raider' as const, gx: 18, gy: 27 },
    ];
    const out = simulate({ ...INPUT, commands: greedy });
    expect(out.rejected.map((r) => r.reason)).toContain('noTroopsLeft');
  });

  it('refuses deploys on top of the defender and outside the world', () => {
    const cheeky: DeployCommand[] = [
      { tickIndex: 0, troopType: 'raider', gx: 28, gy: 28 },
      { tickIndex: 1, troopType: 'raider', gx: -5, gy: 28 },
    ];
    const out = simulate({ ...INPUT, commands: cheeky });
    expect(out.rejected).toEqual([
      { index: 0, reason: 'tooCloseToStructure' },
      { index: 1, reason: 'outOfBounds' },
    ]);
  });

  it('refuses out-of-order tick indices rather than reordering them', () => {
    const out = simulate({
      ...INPUT,
      commands: [
        { tickIndex: 50, troopType: 'raider', gx: 18, gy: 27 },
        { tickIndex: 10, troopType: 'raider', gx: 20, gy: 20 },
      ],
    });
    expect(out.rejected).toEqual([{ index: 1, reason: 'badTick' }]);
  });

  it('never runs past the raid clock', () => {
    const out = simulate({ ...INPUT, commands: [], army: { raider: 0, archer: 0, lancer: 0, ram: 0 } });
    expect(out.ticks).toBeLessThanOrEqual(RAID_TICKS);
    expect(RAID_TICKS).toBe(180 * TICKS_PER_SECOND);
  });
});
