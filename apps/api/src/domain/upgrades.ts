import {
  HERO_MAX_LEVEL,
  TROOP_MAX_LEVEL,
  countOf,
  heroUnlocked,
  heroUpgradeCost,
  keepLevelOf,
  maxTroopLevel,
  troopUpgradeCost,
  type Cost,
  type TroopType,
} from '@ironvow/config';
import { canAfford, type PlayerView } from './commands.js';

/**
 * Hero and War Lab upgrades.
 *
 * Both follow the same shape as every other command: the cost is derived here
 * from @ironvow/config and checked against the player's real balance, and the
 * level gate is the same one the buildings use — nothing may exceed what the
 * Keep supports.
 */

export type UpgradeError =
  | 'cannotAfford'
  | 'heroLocked'
  | 'heroAtMax'
  | 'heroAtKeepCap'
  | 'noLab'
  | 'troopAtMax'
  | 'troopAtLabCap'
  | 'noSuchTroop';

/**
 * Upgrades carry their own verdict rather than reusing the command one.
 *
 * Sharing it widened the error type to every CommandError as well, which meant
 * the message lookup could be handed a key it had no entry for and TypeScript
 * was right to object.
 */
export type UpgradeVerdict<T> = { ok: true; value: T } | { ok: false; error: UpgradeError };

const fail = <T>(error: UpgradeError): UpgradeVerdict<T> => ({ ok: false, error });

export interface HeroUpgradePlan {
  fromLevel: number;
  toLevel: number;
  cost: Cost;
}

export interface HeroView extends PlayerView {
  heroLevel: number;
}

export function planHeroUpgrade(player: HeroView): UpgradeVerdict<HeroUpgradePlan> {
  const owned = player.buildings.map((b) => ({ type: b.type, level: b.level }));
  const keepLevel = keepLevelOf(owned);

  if (!heroUnlocked(keepLevel)) return fail('heroLocked');
  if (player.heroLevel >= HERO_MAX_LEVEL) return fail('heroAtMax');
  // The hero is gated by the Keep like every building, so it cannot be rushed
  // ahead of the base that supports it.
  if (player.heroLevel >= keepLevel) return fail('heroAtKeepCap');

  const cost = heroUpgradeCost(player.heroLevel);
  if (!canAfford(player, cost)) return fail('cannotAfford');

  return { ok: true, value: { fromLevel: player.heroLevel, toLevel: player.heroLevel + 1, cost } };
}

export interface TroopUpgradePlan {
  type: TroopType;
  fromLevel: number;
  toLevel: number;
  cost: Cost;
}

export interface LabView extends PlayerView {
  troopLevels: Partial<Record<TroopType, number>>;
}

export function labLevelOf(player: PlayerView): number {
  for (const b of player.buildings) if (b.type === 'lab') return b.level;
  return 0;
}

export function planTroopUpgrade(player: LabView, type: TroopType): UpgradeVerdict<TroopUpgradePlan> {
  const owned = player.buildings.map((b) => ({ type: b.type, level: b.level }));
  if (countOf(owned, 'lab') === 0) return fail('noLab');

  const current = player.troopLevels[type] ?? 1;
  if (current >= TROOP_MAX_LEVEL) return fail('troopAtMax');
  if (current >= maxTroopLevel(labLevelOf(player))) return fail('troopAtLabCap');

  const cost = troopUpgradeCost(type, current);
  if (!canAfford(player, cost)) return fail('cannotAfford');

  return { ok: true, value: { type, fromLevel: current, toLevel: current + 1, cost } };
}

export const UPGRADE_MESSAGE: Record<UpgradeError, string> = {
  cannotAfford: 'Not enough resources.',
  heroLocked: 'Raise your Keep to level 3 to call a hero.',
  heroAtMax: 'Your hero is already at the highest rank.',
  heroAtKeepCap: 'Your hero may not outrank the Keep.',
  noLab: 'Build a War Lab first.',
  troopAtMax: 'Already at the highest level.',
  troopAtLabCap: 'Raise the War Lab first.',
  noSuchTroop: 'No such troop.',
};
