import { KEEP_MAX } from './world.js';
import type { BuildingType } from './buildings.js';

/**
 * Two worlds.
 *
 * ALFA: "saya ingin ada kaya 2 dunia, 1 dunia siang khusus yang saat ini,
 * 2 dunia berbeda malam kaya coc." The night world is a second base — its own
 * buildings, its own gold and iron, its own builders, its own Town Hall level,
 * its own army and its own trophies. Not a second view of the first one.
 *
 * The rule that keeps this honest: **nothing crosses between worlds**. Gold
 * mined at night cannot pay for a Cannon in the day, an army trained in one
 * cannot raid in the other, and trophies are two separate ladders. The moment
 * one thing leaks across, the second world stops being a second game and
 * becomes a second pocket for the first one — which is the failure every game
 * with two economies eventually has, and it is unrecoverable once players have
 * spent months on either side of it.
 *
 * What is deliberately *not* duplicated: the account, the name, the clan, the
 * hero, seasons and War Orders. Those belong to the player rather than to a
 * base, and giving the night world its own would double the surface of the game
 * for a second copy of something nobody asked for twice.
 */

export const WORLDS = ['day', 'night'] as const;
export type World = (typeof WORLDS)[number];

export const DAY: World = 'day';
export const NIGHT: World = 'night';

/** Anything that is not exactly 'night' is the day world. Never throws. */
export function asWorld(value: unknown): World {
  return value === NIGHT ? NIGHT : DAY;
}

/** What each world is called on screen. */
export const WORLD_NAME: Record<World, string> = {
  day: 'Home',
  night: 'Night Base',
};

/**
 * The Town Hall level that opens the night world.
 *
 * Four, the same rung Clash opens its second village on, and for the same
 * reason: early enough that a player still has appetite for something new, late
 * enough that they have learned what a base is for. Opening it sooner splits a
 * beginner's attention across two economies before they understand one.
 */
export const NIGHT_UNLOCK_KEEP = 4;

export function nightUnlocked(dayKeepLevel: number): boolean {
  return dayKeepLevel >= NIGHT_UNLOCK_KEEP;
}

/**
 * What the night world starts with.
 *
 * A purse, and nothing else — the base itself is laid down by `startingNight`
 * on the server. Deliberately more than a new day hold gets: a player arriving
 * here has already run one base and does not need to be taught what a Gold Mine
 * is by being made to wait for one.
 */
export const NIGHT_START_GOLD = 6000;
export const NIGHT_START_IRON = 3000;

/**
 * Builders in the night world.
 *
 * Its own crew, because a builder shared between worlds would mean an upgrade
 * at night blocking one in the day — two games taking turns rather than two
 * games. Starts at two like the day world and is hired up the same way.
 */
export const NIGHT_STARTING_BUILDERS = 2;

/**
 * What the night world may build.
 *
 * The same catalogue as the day, minus the things that only make sense once:
 * the Laboratory gates troop levels and a second one would be a second grind
 * for the same units, and the vanity pieces are a gold sink for a finished
 * hold — which the night world, by definition, is not yet.
 *
 * Traps and every defence are here on purpose. A base nobody can attack is a
 * layout, not a base, and the night world is raided.
 */
const NOT_AT_NIGHT: readonly BuildingType[] = ['lab', 'statue', 'brazier', 'standard'];

export function buildableAtNight(type: BuildingType): boolean {
  return !NOT_AT_NIGHT.includes(type);
}

/**
 * How high the night world goes.
 *
 * The same nine as the day. A second ceiling to balance separately is a second
 * set of numbers to get wrong, and there is nothing about the night world that
 * wants a different shape of progression — only a separate one.
 */
export const NIGHT_KEEP_MAX = KEEP_MAX;

/**
 * Trophies a night raid moves.
 *
 * Flatter than the day ladder on purpose: the night world is a smaller pool, so
 * the same swing would throw a player across it in an evening.
 */
export const NIGHT_TROPHY_WIN = 22;
export const NIGHT_TROPHY_LOSS = 16;
