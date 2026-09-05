import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '@ironvow/config';
import type { BattleArmy, DeployCommand } from '@ironvow/types';
import { createBattle, generateOpponent, mulberry, simulate } from '../src/index.js';

/**
 * The client/server equivalence the whole anti-cheat design rests on.
 *
 * The client drives `createBattle().step()` one tick at a time and deploys
 * troops as the player taps, recording each as a command. The server later
 * feeds those recorded commands to `simulate()`. If those two ever disagree,
 * every player sees a battle they watched get overruled — so this asserts they
 * cannot.
 */

const ARMY: BattleArmy = { raider: 10, archer: 6, lancer: 3, ram: 2 };

/** A scripted player: deploys on a timer at a rotating set of spots. */
function playLive(stage: number, seed: number, script: number): {
  commands: DeployCommand[];
  result: ReturnType<typeof simulate>;
} {
  const battle = createBattle({ snapshot: generateOpponent(stage), commands: [], army: { ...ARMY }, seed });
  const rng = mulberry(script);
  const order = ['ram', 'lancer', 'archer', 'raider'] as const;
  const spots: [number, number][] = [
    [17, 27], [19, 19], [27, 17], [36, 19], [39, 27], [36, 36], [27, 39], [19, 36],
  ];
  const commands: DeployCommand[] = [];

  let next = 0;
  let i = 0;
  while (!battle.step()) {
    if (battle.tick >= next && i < 21) {
      const type = order[Math.min(order.length - 1, Math.floor(i / 6))]!;
      const spot = spots[Math.floor(rng() * spots.length)]!;
      const out = battle.deploy(type, spot[0] + rng() * 0.5, spot[1] + rng() * 0.5);
      if (out.ok) {
        commands.push(out.command);
        i++;
        next = battle.tick + Math.floor(rng() * TICKS_PER_SECOND) + 4;
      } else {
        // Refused deploys are not recorded, exactly as the client must behave.
        next = battle.tick + 5;
        i++;
      }
    }
  }
  return { commands, result: battle.result() };
}

describe('a live-played battle replays identically', () => {
  for (const [stage, seed, script] of [[1, 11, 5], [4, 222, 77], [7, -9090, 1234], [9, 4242, 31337]] as const) {
    it(`matches for stage ${stage}, seed ${seed}`, () => {
      const live = playLive(stage, seed, script);

      // What the server does with the submitted commands.
      const replay = simulate({
        snapshot: generateOpponent(stage),
        commands: live.commands,
        army: { ...ARMY },
        seed,
      });

      expect(replay.checksum).toBe(live.result.checksum);
      expect(replay.stars).toBe(live.result.stars);
      expect(replay.destroyedPct).toBe(live.result.destroyedPct);
      expect(replay.loot).toEqual(live.result.loot);
      expect(replay.ticks).toBe(live.result.ticks);
      expect(replay.endedBy).toBe(live.result.endedBy);
      // An honest client's commands are all accepted.
      expect(replay.rejected).toEqual([]);
    });
  }

  it('refuses a live deploy the player cannot pay for, without recording it', () => {
    const battle = createBattle({
      snapshot: generateOpponent(2),
      commands: [],
      army: { raider: 1, archer: 0, lancer: 0, ram: 0 },
      seed: 1,
    });
    expect(battle.deploy('raider', 18, 27).ok).toBe(true);
    battle.step();
    expect(battle.deploy('raider', 18, 27)).toEqual({ ok: false, reason: 'noTroopsLeft' });
    expect(battle.deploy('ram', 18, 27)).toEqual({ ok: false, reason: 'noTroopsLeft' });
  });

  it('refuses a live deploy on top of the defender', () => {
    const battle = createBattle({
      snapshot: generateOpponent(3),
      commands: [],
      army: { ...ARMY },
      seed: 1,
    });
    expect(battle.deploy('raider', 27, 27)).toEqual({ ok: false, reason: 'tooCloseToStructure' });
  });

  it('exposes a live star count that agrees with the final result', () => {
    const live = playLive(5, 999, 8);
    expect(live.result.stars).toBe(
      simulate({ snapshot: generateOpponent(5), commands: live.commands, army: { ...ARMY }, seed: 999 }).stars,
    );
  });
});
