import {
  ITEM,
  RELIC_FORGE_COST,
  RELIC_KEEP_LEVEL,
  RELIC_MAX_LEVEL,
  RELIC_SLOTS,
  relicRaiseCost,
  type RelicLevels,
  type RelicLoadout,
  type RelicType,
  itemUnlocked,
  pouchRoomFor,
  type ItemType,
  type Pouch,
  HERO_MAX_LEVEL,
  MAX_BUILDERS,
  TROOP_MAX_LEVEL,
  builderCost,
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
  | 'noSuchTroop'
  | 'crewFull'
  | 'itemLocked'
  | 'pouchFull'
  | 'relicLocked'
  | 'relicAtMax'
  | 'relicNotForged'
  | 'noShards'
  | 'noSuchSlot';

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

/* --------------------------------------------------------- battle items --- */

export interface ItemBuyPlan {
  type: ItemType;
  /** How many were actually bought. Clamped to the pouch, never refused for it. */
  count: number;
  cost: Cost;
  /** The pouch after the purchase. */
  pouch: Pouch;
}

export interface PouchView extends PlayerView {
  keepLevel: number;
  pouch: Pouch;
}

/**
 * Buy battle items.
 *
 * Clamped to what will fit rather than refused for it, the same way a donation
 * is: asking for three when two fit should give you two, not an error message
 * about arithmetic. Refused only when nothing at all would fit, or when the
 * Keep has not reached the item yet.
 */
export function planItemBuy(player: PouchView, type: ItemType, want: number): UpgradeVerdict<ItemBuyPlan> {
  if (!itemUnlocked(type, player.keepLevel)) return fail('itemLocked');
  const room = pouchRoomFor(player.pouch, type);
  if (room <= 0) return fail('pouchFull');

  const spec = ITEM[type];
  // The most that fits, then the most that is affordable. Both clamps, so a
  // player with the gold for one and room for three buys one.
  let count = Math.min(want, room);
  while (count > 1 && !canAfford(player, { g: spec.cost.g * count, i: spec.cost.i * count })) count--;

  const cost: Cost = { g: spec.cost.g * count, i: spec.cost.i * count };
  if (!canAfford(player, cost)) return fail('cannotAfford');

  return {
    ok: true,
    value: { type, count, cost, pouch: { ...player.pouch, [type]: (player.pouch[type] ?? 0) + count } },
  };
}

/* --------------------------------------------------------------- relics --- */

export interface RelicPlan {
  type: RelicType;
  fromLevel: number;
  toLevel: number;
  /** Shards spent. Relics are the one thing in the game gold cannot buy. */
  shards: number;
}

export interface RelicView extends PlayerView {
  keepLevel: number;
  shards: number;
  relics: RelicLevels;
  carried: RelicLoadout;
}

/**
 * Forge a relic, or raise one already forged.
 *
 * One function for both, because they are the same decision at different
 * prices: a player with sixty shards is choosing between a third relic and a
 * level on one of the two they carry, and splitting that into two endpoints
 * would not change what they are weighing.
 */
export function planRelic(player: RelicView, type: RelicType): UpgradeVerdict<RelicPlan> {
  if (player.keepLevel < RELIC_KEEP_LEVEL) return fail('relicLocked');
  const from = player.relics[type] ?? 0;
  if (from >= RELIC_MAX_LEVEL) return fail('relicAtMax');

  const shards = from === 0 ? RELIC_FORGE_COST : relicRaiseCost(from);
  if (player.shards < shards) return fail('noShards');

  return { ok: true, value: { type, fromLevel: from, toLevel: from + 1, shards } };
}

/**
 * Carry a relic in a slot, or empty the slot.
 *
 * Refuses a relic that has not been forged, and refuses to carry the same one
 * twice — both would grant a bonus nobody paid for. Swapping a relic that is
 * already in the other slot moves it rather than duplicating it, because
 * "carry Edge here" and "stop carrying Edge there" is one intention.
 */
export function planCarry(
  player: RelicView, slot: number, type: RelicType | null,
): UpgradeVerdict<RelicLoadout> {
  if (player.keepLevel < RELIC_KEEP_LEVEL) return fail('relicLocked');
  if (!Number.isInteger(slot) || slot < 0 || slot >= RELIC_SLOTS) return fail('noSuchSlot');
  if (type !== null && (player.relics[type] ?? 0) <= 0) return fail('relicNotForged');

  const next: RelicLoadout = [...player.carried];
  while (next.length < RELIC_SLOTS) next.push(null);
  if (type !== null) {
    const already = next.indexOf(type);
    if (already >= 0 && already !== slot) next[already] = next[slot] ?? null;
  }
  next[slot] = type;
  return { ok: true, value: next.slice(0, RELIC_SLOTS) };
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
  crewFull: 'Your crew is already ten builders strong.',
  itemLocked: 'Raise your Keep further to carry this.',
  pouchFull: 'Your pouch is full.',
  relicLocked: `Relics open at Keep ${RELIC_KEEP_LEVEL}.`,
  relicAtMax: 'That relic is already at the highest level.',
  relicNotForged: 'You have not forged that relic.',
  noShards: 'Not enough shards. Fight a clan war.',
  noSuchSlot: 'No such slot.',
};

/* ------------------------------------------------------------ builders --- */

export interface BuilderHirePlan {
  from: number;
  to: number;
  cost: Cost;
}

export interface BuilderView extends PlayerView {
  builders: number;
}

/**
 * Hire the next builder.
 *
 * Gold only, and no Keep gate: a builder is not a building, it is how fast the
 * hold works, and a player who has saved for one has already earned it. The
 * ceiling is the crew size rather than the Keep, so this is the one upgrade in
 * the game a new hold can save toward from its first hour.
 */
export function planBuilderHire(player: BuilderView): UpgradeVerdict<BuilderHirePlan> {
  if (player.builders >= MAX_BUILDERS) return fail('crewFull');
  const price = builderCost(player.builders);
  if (price === null) return fail('crewFull');

  const cost: Cost = { g: price, i: 0 };
  if (!canAfford(player, cost)) return fail('cannotAfford');

  return { ok: true, value: { from: player.builders, to: player.builders + 1, cost } };
}
