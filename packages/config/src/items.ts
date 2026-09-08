/**
 * Battle items.
 *
 * The one thing an attacker could bring to a raid that is not a troop.
 *
 * Everything else in IRONVOW is decided before the fight: the warband is
 * trained, the hero is levelled, the base is scouted, and then three minutes
 * run their course with nothing left to decide but where to tap. An item is the
 * decision you make *during* a raid — and, because there are two of them and
 * they solve opposite problems, a decision about what to bring as well.
 *
 * The rules that make them safe to add to a deterministic simulation:
 *
 * - **An item is a command, not an effect.** The client sends "Warhorn at
 *   (24.5, 31.2) on tick 900"; the server replays the same command through the
 *   same code and gets the same fight. Nothing about an item's outcome crosses
 *   the wire.
 * - **The pouch is frozen onto the raid**, exactly like the warband and the
 *   hero. Buying an item mid-raid cannot change the raid already open, and a
 *   replay months later still has the pouch the fight was fought with.
 * - **No item touches a defender's hold outside the fight.** They are spent on
 *   use and they do nothing after the clock.
 */

export const ITEM_TYPES = ['horn', 'firepot'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export interface ItemSpec {
  n: string;
  /** One line, shown on the card and in the raid tray. */
  d: string;
  /** Grid radius of the effect. */
  r: number;
  /** Keep level it unlocks at. */
  keep: number;
  cost: { g: number; i: number };
  /** How many of this one a hold can keep. */
  cap: number;
}

/**
 * TUNABLE, all of it.
 *
 * The two are priced against what they replace. A Warhorn is roughly the gold
 * of the troops it saves you having to train twice; a Firepot is iron, because
 * iron is what walls cost and a Firepot is a hole in one.
 */
export const ITEM: Record<ItemType, ItemSpec> = {
  horn: {
    n: 'Rage Horn',
    d: 'Troops inside the circle hit harder and move faster.',
    r: 4.5,
    keep: 4,
    cost: { g: 2_600, i: 0 },
    cap: 3,
  },
  firepot: {
    n: 'Bomb',
    d: 'Explodes on the ground. Everything of theirs in the circle takes damage.',
    r: 3.2,
    keep: 5,
    cost: { g: 0, i: 1_900 },
    cap: 3,
  },
};

/** How long a Warhorn lasts, in seconds. */
export const HORN_SECONDS = 11;
/** What it multiplies while it lasts. */
export const HORN_SPEED = 1.55;
export const HORN_DAMAGE = 1.45;

/**
 * A Firepot's damage.
 *
 * Flat, not a fraction: a percentage of maximum hit points would be worth more
 * against the Keep the further the game went, and a consumable that scales
 * faster than the base it is thrown at eventually replaces playing well.
 */
export const FIREPOT_DAMAGE = 1_250;
/**
 * And what it is worth against a rampart specifically.
 *
 * Walls have far more hit points per cell than anything else, so a flat number
 * that dents a Cannon does nothing at all to a wall. This is the multiplier
 * that makes "burn a hole in the ramparts" the thing a Firepot is actually for.
 */
export const FIREPOT_WALL_MULTIPLIER = 3;

export function isItemType(s: string): s is ItemType {
  return (ITEM_TYPES as readonly string[]).includes(s);
}

/** Unlocked at this Keep? */
export function itemUnlocked(type: ItemType, keepLevel: number): boolean {
  return keepLevel >= ITEM[type].keep;
}

/** A pouch: how many of each is held. Missing means none. */
export type Pouch = Partial<Record<ItemType, number>>;

/** Read a pouch off a JSON column without trusting a byte of it. */
export function parsePouch(raw: unknown): Pouch {
  const out: Pouch = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const type of ITEM_TYPES) {
    const n = (raw as Record<string, unknown>)[type];
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      out[type] = Math.min(ITEM[type].cap, Math.floor(n));
    }
  }
  return out;
}

/** How many more of this one will fit. */
export function pouchRoomFor(pouch: Pouch, type: ItemType): number {
  return Math.max(0, ITEM[type].cap - (pouch[type] ?? 0));
}
