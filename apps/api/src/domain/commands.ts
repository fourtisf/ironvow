import {
  KEEP_MAX,
  buildSeconds,
  buildersFree,
  canDemolish,
  cancelRefund,
  demolishRefund,
  isBusy,
  TROOP,
  TROOP_UNLOCK,
  TYPES,
  armyCapOf,
  armyUsedOf,
  bestBarracksLevel,
  capOf,
  costOf,
  countOf,
  keepLevelOf,
  type BuildingType,
  type Cost,
  type TroopType,
} from '@ironvow/config';
import { cellsFree, type PlacedBuilding } from './placement.js';

/**
 * Command validation.
 *
 * Every mutation re-derives its own cost from @ironvow/config and checks it
 * against the player's real balance. The client's idea of the price never
 * enters: a request carries intent ("upgrade this cannon"), never a number
 * (spec S5).
 */

export interface PlayerView {
  gold: bigint;
  iron: bigint;
  buildings: OwnedBuildingRow[];
  army: Partial<Record<TroopType, number>>;
  queue: readonly TroopType[];
  /**
   * How many jobs this hold can run at once. A per-hold number now that
   * builders are hired rather than handed out, so it has to travel with the
   * player rather than be read from a constant at the point of use.
   */
  builders: number;
}

export interface OwnedBuildingRow extends PlacedBuilding {
  level: number;
  /** Null when no builder is working on it. */
  completesAt?: Date | null;
  /** The level it becomes; null while a fresh build is still going up. */
  upgradingTo?: number | null;
}

/** Shape the builder helpers expect. */
function timed(b: OwnedBuildingRow): { type: BuildingType; level: number; completesAt: Date | null; upgradingTo: number | null } {
  return {
    type: b.type,
    level: b.level,
    completesAt: b.completesAt ?? null,
    upgradingTo: b.upgradingTo ?? null,
  };
}

export type CommandError =
  | 'unknownBuilding'
  | 'unknownType'
  | 'cannotAfford'
  | 'atCountLimit'
  | 'atKeepCap'
  | 'atMaxLevel'
  | 'outOfBounds'
  | 'overlaps'
  | 'notInteger'
  | 'barracksTooLow'
  | 'warbandFull'
  | 'noSuchTroop'
  | 'noBuilderFree'
  | 'alreadyBusy'
  | 'notBusy'
  | 'cannotDemolishKeep'
  | 'noSuchJob';

export type Verdict<T> = { ok: true; value: T } | { ok: false; error: CommandError };

const fail = <T>(error: CommandError): Verdict<T> => ({ ok: false, error });
const pass = <T>(value: T): Verdict<T> => ({ ok: true, value });

export function canAfford(p: { gold: bigint; iron: bigint }, cost: Cost): boolean {
  return p.gold >= BigInt(cost.g) && p.iron >= BigInt(cost.i);
}

/* ---------------------------------------------------------------- build --- */

export interface BuildPlan {
  type: BuildingType;
  gx: number;
  gy: number;
  cost: Cost;
  /** Zero means it goes up instantly, which is only ever a rampart. */
  seconds: number;
}

export function planBuild(
  player: PlayerView,
  type: BuildingType,
  gx: number,
  gy: number,
): Verdict<BuildPlan> {
  if (!(type in TYPES)) return fail('unknownType');
  // The Keep is created with the base and can never be built again.
  if (type === 'keep') return fail('atCountLimit');

  const keepLevel = keepLevelOf(player.buildings.map((b) => ({ type: b.type, level: b.level })));
  const owned = countOf(player.buildings.map((b) => ({ type: b.type, level: b.level })), type);
  if (owned >= capOf(type, keepLevel)) return fail('atCountLimit');

  const placement = cellsFree(type, gx, gy, player.buildings);
  if (placement) return fail(placement);

  const cost = costOf(type, 0, owned);
  if (!canAfford(player, cost)) return fail('cannotAfford');

  const seconds = buildSeconds(type, 0, owned);
  // A rampart needs no builder, so a run of them can be laid while every
  // builder is busy elsewhere.
  if (seconds > 0 && buildersFree(player.buildings.map(timed), player.builders) === 0) return fail('noBuilderFree');

  return pass({ type, gx, gy, cost, seconds });
}

/* -------------------------------------------------------------- upgrade --- */

export interface UpgradePlan {
  buildingId: string;
  type: BuildingType;
  fromLevel: number;
  toLevel: number;
  cost: Cost;
  seconds: number;
}

/**
 * Nothing may exceed the Keep's level, and the Keep itself stops at 9.
 * That gate is the whole progression spine, so it is checked here rather than
 * anywhere a route could forget it.
 */
export function planUpgrade(player: PlayerView, buildingId: string): Verdict<UpgradePlan> {
  const b = player.buildings.find((x) => x.id === buildingId);
  if (!b) return fail('unknownBuilding');
  // One builder per building: you cannot stack two jobs on the same thing.
  if (isBusy(timed(b))) return fail('alreadyBusy');

  const keepLevel = keepLevelOf(player.buildings.map((x) => ({ type: x.type, level: x.level })));

  if (b.type === 'keep') {
    if (b.level >= KEEP_MAX) return fail('atMaxLevel');
  } else if (b.level >= keepLevel) {
    return fail('atKeepCap');
  }

  const owned = countOf(player.buildings.map((x) => ({ type: x.type, level: x.level })), b.type);
  const cost = costOf(b.type, b.level, owned);
  if (!canAfford(player, cost)) return fail('cannotAfford');

  const seconds = buildSeconds(b.type, b.level, owned);
  if (seconds > 0 && buildersFree(player.buildings.map(timed), player.builders) === 0) return fail('noBuilderFree');

  return pass({ buildingId, type: b.type, fromLevel: b.level, toLevel: b.level + 1, cost, seconds });
}

/* ----------------------------------------------------------------- move --- */

export interface MovePlan {
  buildingId: string;
  gx: number;
  gy: number;
}

/**
 * Relocation is free, and it runs through the same `cellsFree` as a build.
 *
 * Prototype bug #2 and #3 both lived on this path: a move that lifted the
 * building off the map before re-rendering the action bar lost it entirely,
 * and a confirm that pushed it back twice produced two rows sharing one id.
 * Neither is reachable here — this returns a plan, and the caller applies it
 * as a single UPDATE of gx and gy. The building is never removed from the set
 * it is validated against.
 */
export function planMove(player: PlayerView, buildingId: string, gx: number, gy: number): Verdict<MovePlan> {
  const b = player.buildings.find((x) => x.id === buildingId);
  if (!b) return fail('unknownBuilding');
  // Moving a building mid-job would leave the builder walking to an empty plot.
  if (isBusy(timed(b))) return fail('alreadyBusy');

  const placement = cellsFree(b.type, gx, gy, player.buildings, buildingId);
  if (placement) return fail(placement);

  return pass({ buildingId, gx, gy });
}

/* ------------------------------------------------------------- demolish --- */

export interface DemolishPlan {
  buildingId: string;
  type: BuildingType;
  level: number;
  refund: Cost;
}

/**
 * Tear a building down for half of what went into it.
 *
 * Without this a misplaced building is permanent, and because count limits are
 * per Keep level, a wrong choice at Keep 1 spends that slot for good. A base
 * you cannot fix is worse than one you built badly.
 *
 * The refund counts the upgrades too, so demolishing a level 9 Cannon is not
 * worth the same as a level 1 one.
 */
export function planDemolish(player: PlayerView, buildingId: string): Verdict<DemolishPlan> {
  const b = player.buildings.find((x) => x.id === buildingId);
  if (!b) return fail('unknownBuilding');
  if (!canDemolish(b.type)) return fail('cannotDemolishKeep');
  // A builder mid-job would be left working on nothing.
  if (isBusy(timed(b))) return fail('alreadyBusy');

  const owned = countOf(player.buildings.map((x) => ({ type: x.type, level: x.level })), b.type);
  const refund = demolishRefund(b.type, b.level, Math.max(0, owned - 1));

  return pass({ buildingId, type: b.type, level: b.level, refund });
}

/* --------------------------------------------------------------- cancel --- */

export interface CancelBuildPlan {
  buildingId: string;
  type: BuildingType;
  /** True when the whole building disappears, false when only the upgrade stops. */
  removes: boolean;
  refund: Cost;
}

/**
 * Stop a builder and get everything back.
 *
 * Nothing has been consumed — the builder simply puts its tools down — so
 * charging for a change of mind inside the first few seconds would be a small
 * meanness players remember. A cancelled fresh build takes the building with
 * it; a cancelled upgrade leaves it at the level it was already working at.
 */
export function planCancelBuild(player: PlayerView, buildingId: string): Verdict<CancelBuildPlan> {
  const b = player.buildings.find((x) => x.id === buildingId);
  if (!b) return fail('unknownBuilding');
  if (!isBusy(timed(b))) return fail('notBusy');

  const owned = countOf(player.buildings.map((x) => ({ type: x.type, level: x.level })), b.type);
  const upgrading = b.upgradingTo != null;

  const spent = upgrading
    ? costOf(b.type, b.level, Math.max(0, owned - 1))
    : costOf(b.type, 0, Math.max(0, owned - 1));

  return pass({
    buildingId,
    type: b.type,
    removes: !upgrading,
    refund: cancelRefund(spent),
  });
}

/* ---------------------------------------------------------------- train --- */

export interface TrainPlan {
  type: TroopType;
  cost: Cost;
  seconds: number;
  slots: number;
}

export function planTrain(player: PlayerView, type: TroopType): Verdict<TrainPlan> {
  const def = TROOP[type];
  if (!def) return fail('noSuchTroop');

  const owned = player.buildings.map((b) => ({ type: b.type, level: b.level }));
  if (bestBarracksLevel(owned) < TROOP_UNLOCK[type]) return fail('barracksTooLow');

  const used = armyUsedOf(player.army, player.queue);
  if (used + def.sp > armyCapOf(owned)) return fail('warbandFull');

  if (!canAfford(player, def.cost)) return fail('cannotAfford');

  return pass({ type, cost: def.cost, seconds: def.tt, slots: def.sp });
}

/** Human-readable reason, for the client toast. */
export const ERROR_MESSAGE: Record<CommandError, string> = {
  unknownBuilding: 'That building is not yours.',
  unknownType: 'No such building.',
  cannotAfford: 'Not enough resources.',
  atCountLimit: 'Limit reached — upgrade your Town Hall.',
  atKeepCap: 'Nothing can go above your Town Hall level.',
  atMaxLevel: 'Already at the highest level.',
  outOfBounds: 'That spot is off the map.',
  overlaps: 'That spot is blocked.',
  notInteger: 'Buildings sit on whole tiles.',
  barracksTooLow: 'You need a higher Barracks level.',
  warbandFull: 'Army is full — build or upgrade an Army Camp.',
  noSuchTroop: 'No such troop.',
  noBuilderFree: 'Every builder is busy.',
  alreadyBusy: 'A builder is already working on that.',
  notBusy: 'Nothing is being built there.',
  cannotDemolishKeep: 'The Town Hall is your base. It cannot be sold.',
  noSuchJob: 'That job is not in your queue.',
};
