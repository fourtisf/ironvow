import {
  REVENGE_COOLDOWN_HOURS,
  TROPHY_BAND_MAX,
  TROPHY_BAND_START,
  TROPHY_BAND_STEP,
  availableLoot,
  isVanity,
  shieldHoursFor,
  stageFromTrophies,
  trophyLoss,
  trophyWin,
  type BuildingType,
} from '@ironvow/config';
import type { BaseSnapshot } from '@ironvow/types';

/**
 * Raid rules that do not need a database.
 *
 * Kept pure so the matchmaking band, the loot exposure and the trophy
 * arithmetic can be tested directly rather than through a fixture base.
 */

export interface SnapshotSource {
  id: string;
  name: string;
  keepLevel: number;
  gold: bigint;
  iron: bigint;
  buildings: { id: string; type: BuildingType; gx: number; gy: number; level: number }[];
}

/**
 * Freeze a defender's base.
 *
 * The pool is computed once, here, from the defender's stock at the moment the
 * raid opens. Everything after this reads the snapshot, so a defender who
 * spends down or rebuilds mid-raid changes neither the layout the attacker
 * fights nor the loot on offer (spec S7).
 */
export function snapshotBase(source: SnapshotSource): BaseSnapshot {
  const owned = source.buildings.map((b) => ({ type: b.type, level: b.level }));
  return {
    version: 1,
    defenderId: source.id,
    defenderName: source.name,
    keepLevel: source.keepLevel,
    buildings: source.buildings
      // A statue is not a target. Leaving vanity out here is what makes it
      // free of consequence: it cannot be destroyed, cannot carry loot, and
      // cannot pad the hit points that decide a star.
      .filter((b) => !isVanity(b.type))
      .map((b) => ({ id: b.id, type: b.type, gx: b.gx, gy: b.gy, level: b.level }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    pool: {
      g: availableLoot(Number(source.gold), owned),
      i: availableLoot(Number(source.iron), owned),
    },
  };
}

/** Trophy band for attempt `n`, starting at 0. Widens until it finds someone. */
export function trophyBand(trophies: number, attempt: number): { lo: number; hi: number } {
  const width = Math.min(TROPHY_BAND_START + attempt * TROPHY_BAND_STEP, TROPHY_BAND_MAX);
  return { lo: Math.max(0, trophies - width), hi: trophies + width };
}

export function revengeCutoff(now: Date): Date {
  return new Date(now.getTime() - REVENGE_COOLDOWN_HOURS * 3_600_000);
}

export interface Settlement {
  stars: number;
  trophyDelta: number;
  /** What the attacker gains, capped by what the defender actually still holds. */
  loot: { g: number; i: number };
  /** How long the defender is protected afterwards. Zero means no shield. */
  shieldUntil: Date | null;
}

/**
 * Turn a simulation result into what actually changes hands.
 *
 * The simulated loot is what the attacker earned against the frozen pool. It
 * is capped again here against the defender's live balance, because a defender
 * who spent their gold between the snapshot and the submission cannot be made
 * to pay out more than they have.
 */
export function settleRaid(args: {
  stars: number;
  simLoot: { g: number; i: number };
  defenderGold: bigint;
  defenderIron: bigint;
  defenderTrophies: number;
  now: Date;
}): Settlement {
  const { stars, simLoot, defenderGold, defenderIron, defenderTrophies, now } = args;
  const stage = stageFromTrophies(defenderTrophies);

  const loot = {
    g: Math.min(simLoot.g, Number(defenderGold)),
    i: Math.min(simLoot.i, Number(defenderIron)),
  };

  const trophyDelta = stars >= 1 ? trophyWin(stage, stars) : trophyLoss(stage);

  const hours = shieldHoursFor(stars);
  return {
    stars,
    trophyDelta,
    loot,
    shieldUntil: hours > 0 ? new Date(now.getTime() + hours * 3_600_000) : null,
  };
}

/** A defender loses what the attacker took, and never drops below zero. */
export function debitDefender(
  gold: bigint,
  iron: bigint,
  loot: { g: number; i: number },
): { gold: bigint; iron: bigint } {
  const g = gold - BigInt(loot.g);
  const i = iron - BigInt(loot.i);
  return { gold: g < 0n ? 0n : g, iron: i < 0n ? 0n : i };
}
