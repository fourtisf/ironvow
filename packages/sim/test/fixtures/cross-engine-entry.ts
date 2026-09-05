/**
 * Bundle entry for the cross-engine determinism test.
 *
 * Exposes one function that runs a fixed battle and returns its result, so the
 * same code can be called from Node and from inside a real browser and the two
 * answers compared.
 */
import { generateOpponent, simulate } from '../../src/index.js';
import type { BattleArmy, DeployCommand } from '@ironvow/types';

export const ARMY: BattleArmy = { raider: 12, archer: 9, lancer: 5, ram: 3 };

export function fixtureCommands(): DeployCommand[] {
  const ring: [number, number][] = [
    [17, 27], [19, 19], [27, 17], [36, 19], [39, 27], [36, 36], [27, 39], [19, 36],
  ];
  const out: DeployCommand[] = [];
  let i = 0;
  for (const t of ['ram', 'lancer', 'archer', 'raider'] as const) {
    for (let k = 0; k < ARMY[t]; k++) {
      const spot = ring[i % ring.length]!;
      out.push({ tickIndex: i * 4, troopType: t, gx: spot[0] + (k % 4) * 0.3, gy: spot[1] + (k % 3) * 0.3 });
      i++;
    }
  }
  return out;
}

export function runFixture(stage: number, seed: number) {
  const out = simulate({
    snapshot: generateOpponent(stage),
    commands: fixtureCommands(),
    army: ARMY,
    seed,
  });
  return {
    checksum: out.checksum,
    stars: out.stars,
    // Full precision: a last-bit difference is exactly what this test is for.
    destroyedPct: out.destroyedPct.toExponential(20),
    loot: out.loot,
    ticks: out.ticks,
    endedBy: out.endedBy,
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __ironvow: { runFixture: typeof runFixture } | undefined;
}

if (typeof globalThis !== 'undefined') {
  globalThis.__ironvow = { runFixture };
}
