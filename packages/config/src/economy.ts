import { TYPES, isVanity, type BuildingType } from './buildings.js';
import { barracksSlots, TROOP, TROOP_ORDER, type TroopType } from './troops.js';

/*
 * What a producer makes in a minute.
 *
 * Raised again after the first hour still felt thin: a level-1 mine made 37
 * gold a minute against a second mine costing 233, so the second building of
 * the game was six minutes of watching. Both curves are steeper as well as
 * higher, so levelling a producer is worth more than laying another one.
 * TUNABLE.
 */
/** Gold per minute from one Gold Mine. */
export const mineRate = (level: number): number => 40 + level * 26;
/** Iron per minute from one Iron Forge. */
export const forgeRate = (level: number): number => 22 + level * 16;

export const PROD: Partial<Record<BuildingType, (lv: number) => number>> = {
  mine: mineRate,
  forge: forgeRate,
};

/** Which resource a producer yields. */
export const PRODUCES: Partial<Record<BuildingType, 'gold' | 'iron'>> = {
  mine: 'gold',
  forge: 'iron',
};

/**
 * A producer holds this many minutes of output before it stops.
 *
 * Twelve was the number the prototype shipped with, and it meant a Gold Mine
 * stopped at 444 gold: the game earned while you watched it and barely at
 * all while you did not, which is the opposite of the promise on the first
 * screen. Two hours is long enough that coming back after a meal is worth
 * something and short enough that a player who checks in often still gets
 * more than one who does not. TUNABLE, and the number to move first if the
 * economy feels slow. Now four hours, matching OFFLINE_CAP_SECONDS: a night's
 * sleep pays the same as it would if the tab had been left open.
 */
export const STOCK_BUFFER_MINUTES = 240;

/** Uncollected output a single producer can hold. */
export function stockCapOf(type: BuildingType, level: number): number {
  const rate = PROD[type];
  return rate ? rate(level) * STOCK_BUFFER_MINUTES : 0;
}

/**
 * Storage added by one Vault.
 *
 * Sized against what the producers now make: a Vault has to be worth the
 * plot it stands on, and at 2,900 it was not.
 */
export const CAPACITY = (level: number): number => 3000 + level * 3000;

/**
 * Storage every player has before building a single Vault.
 *
 * Raised with the starting purse below: a cap of 2,500 turned a full mine
 * into waste before the first Vault was up, and made the opening hour feel
 * like it was throwing money away.
 */
export const BASE_STORAGE = 9000;

/**
 * Starting purse.
 *
 * 900 gold bought a second Gold Mine and left 120, with the next four War
 * Orders asking for a Cannon, a Forge and a Keep upgrade — 1,753 gold and
 * 340 iron between them. The opening was a wait, not a game. This covers all
 * four with something left for ramparts and a first warband.
 *
 * Prototype bug #1: these were once equal to BASE_STORAGE, so the very first
 * mine collection was clamped away and vanished with no feedback. The invariant
 * below is asserted at module load and again in the economy tests.
 */
export const START_GOLD = 6000;
export const START_IRON = 2400;

if (START_GOLD >= BASE_STORAGE || START_IRON >= BASE_STORAGE) {
  throw new Error(
    'Starting resources must be strictly below base storage capacity, or the first collection is silently discarded (bug #1).',
  );
}

/** Offline accrual window. Anything past this is not paid out. */
export const OFFLINE_CAP_SECONDS = 4 * 60 * 60;

export interface OwnedBuilding {
  type: BuildingType;
  level: number;
}

export function storageCapOf(buildings: readonly OwnedBuilding[]): number {
  let cap = BASE_STORAGE;
  for (const b of buildings) if (b.type === 'store') cap += CAPACITY(b.level);
  return cap;
}

export function armyCapOf(buildings: readonly OwnedBuilding[]): number {
  let cap = 0;
  for (const b of buildings) if (b.type === 'barr') cap += barracksSlots(b.level);
  return cap;
}

/** Slots used by trained troops plus everything still in the training queue. */
export function armyUsedOf(
  army: Partial<Record<TroopType, number>>,
  queued: readonly TroopType[] = [],
): number {
  let used = 0;
  for (const t of TROOP_ORDER) used += (army[t] ?? 0) * TROOP[t].sp;
  for (const t of queued) used += TROOP[t].sp;
  return used;
}

export function bestBarracksLevel(buildings: readonly OwnedBuilding[]): number {
  let lv = 0;
  for (const b of buildings) if (b.type === 'barr' && b.level > lv) lv = b.level;
  return lv;
}

export function keepLevelOf(buildings: readonly OwnedBuilding[]): number {
  for (const b of buildings) if (b.type === 'keep') return b.level;
  return 1;
}

export function countOf(buildings: readonly OwnedBuilding[], type: BuildingType): number {
  let n = 0;
  for (const b of buildings) if (b.type === type) n++;
  return n;
}

/**
 * TUNABLE — not specified in the build document, pending sign-off.
 *
 * Each Vault shields a fixed amount of each resource from raiders (spec S8.6:
 * "make each Vault shield a fixed amount that is not lootable"). Set to a fifth
 * of the storage that Vault adds, so upgrading one is worth it for protection
 * as well as headroom.
 */
export function vaultProtectionOf(level: number): number {
  return Math.round(CAPACITY(level) * 0.2);
}

export function protectedResourcesOf(buildings: readonly OwnedBuilding[]): number {
  let p = 0;
  for (const b of buildings) if (b.type === 'store') p += vaultProtectionOf(b.level);
  return p;
}

/** TUNABLE — share of a defender's unprotected stock a raider can reach. */
export const LOOT_SHARE = 0.2;
/** TUNABLE — hard ceiling on one raid's take, so a whale cannot be farmed dry. */
export const LOOT_CEILING = 250_000;

/**
 * How much of a defender's stock is on the table before the battle is fought.
 * The raider then earns a fraction of this by destroying loot-carrying buildings.
 */
export function availableLoot(stored: number, buildings: readonly OwnedBuilding[]): number {
  const exposed = Math.max(0, stored - protectedResourcesOf(buildings));
  return Math.min(LOOT_CEILING, Math.floor(exposed * LOOT_SHARE));
}

/**
 * Every building except a Rampart carries an equal share of the loot pool.
 *
 * Vanity never reaches here — it is filtered out of the snapshot before a
 * battle is built — but the guard is written anyway, because the day someone
 * puts a statue in a snapshot it should carry nothing rather than dilute the
 * pool across the whole base.
 */
export function lootCarriers(buildings: readonly { type: BuildingType }[]): number {
  let n = 0;
  for (const b of buildings) if (b.type !== 'wall' && !isVanity(b.type)) n++;
  return n;
}

export function footprintOf(type: BuildingType): number {
  return TYPES[type].s;
}
