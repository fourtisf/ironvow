import { ipow } from './math.js';
import { HERO_MAX_LEVEL, heroRespawnMinutes, type HeroStats } from './hero.js';

/**
 * Relics.
 *
 * The answer to the one question a finished hold cannot answer: what now?
 *
 * A Keep tops out at 9. Every building, every troop and the hero itself top out
 * with it, and the War Orders run dry in the first few hours. Seasons gave a
 * reason to climb the ladder again every fortnight, but they reset a number
 * rather than adding to one — after the last upgrade there was nothing left in
 * the game that a player could still be working towards.
 *
 * Relics are that. Three of them, two slots, so having all three is not the end
 * of it: what you carry is a decision you make against the base you are about
 * to hit, and it stays a decision at every level.
 *
 * The currency is deliberately not gold. Gold is what a maxed hold has too much
 * of, and a sink priced in it would be a formality. Shards come from clan wars,
 * per star earned, doubled on the winning side — so the thing that keeps a
 * finished player playing is the thing that also keeps their clan alive, which
 * is the part of the game that most needs the traffic.
 */

export const RELIC_TYPES = ['bulwark', 'edge', 'haste'] as const;
export type RelicType = (typeof RELIC_TYPES)[number];

export interface RelicSpec {
  n: string;
  d: string;
  /** What one level of it is worth, as a fraction. */
  per: number;
}

/**
 * TUNABLE.
 *
 * Each one moves a different number, and none of them moves two, so what a
 * player is choosing between is legible: survive longer, hit harder, or come
 * back sooner. A relic that did a little of everything would be a relic nobody
 * ever left behind.
 */
export const RELIC: Record<RelicType, RelicSpec> = {
  bulwark: { n: 'Guard', d: 'The Vowkeeper takes more damage before it falls.', per: 0.07 },
  edge:    { n: 'Blade',   d: 'The Vowkeeper hits harder.',                 per: 0.055 },
  haste:   { n: 'Revive',  d: 'The Vowkeeper comes back sooner after falling.', per: 0.05 },
};

export const RELIC_MAX_LEVEL = 10;
/** How many can be carried at once. Fewer than there are, on purpose. */
export const RELIC_SLOTS = 2;

/** Levels held, by type. A type absent has not been forged at all. */
export type RelicLevels = Partial<Record<RelicType, number>>;
/** What is actually carried: RELIC_SLOTS entries, each a type or null. */
export type RelicLoadout = (RelicType | null)[];

/** Shards to forge one for the first time. */
export const RELIC_FORGE_COST = 60;

/** Shards to take one from `level` to `level + 1`. */
export function relicRaiseCost(level: number): number {
  return Math.round(40 * ipow(1.32, Math.max(0, level - 1)));
}

/**
 * Shards earned from a war.
 *
 * Per star the member personally took, doubled for the winning side — the same
 * shape as the war's gold reward, so a player does not have to learn a second
 * rule about what a war is worth.
 */
export const SHARDS_PER_STAR = 4;
export function warShards(stars: number, won: boolean): number {
  return SHARDS_PER_STAR * Math.max(0, stars) * (won ? 2 : 1);
}

/**
 * Shards from a season close.
 *
 * The second source, and it exists for one reason: wars need a clan, and a
 * player with no clan must not be locked out of the only progression left in
 * the game. It is deliberately the slower road — a season is a fortnight and a
 * war is a day — so joining a clan is still plainly the better answer.
 */
export function seasonShards(tierIndex: number): number {
  return tierIndex < 0 ? 0 : 12 + tierIndex * 10;
}

/** The multiplier a carried relic applies. 1 when it is not carried at all. */
export function relicFactor(
  type: RelicType, levels: RelicLevels, carried: RelicLoadout,
): number {
  if (!carried.includes(type)) return 1;
  const lv = levels[type] ?? 0;
  if (lv <= 0) return 1;
  return 1 + RELIC[type].per * lv;
}

/**
 * The hero, with whatever it is carrying.
 *
 * Wraps `heroStats` rather than replacing it, so every existing caller — and
 * every raid recorded before relics existed — keeps the numbers it always had:
 * an empty loadout multiplies by one.
 *
 * Rounded at the end, because the simulation must not depend on the order two
 * float multiplications happened in.
 */
export function heroWith(
  base: HeroStats, levels: RelicLevels = {}, carried: RelicLoadout = [],
): HeroStats {
  return {
    ...base,
    hp: Math.round(base.hp * relicFactor('bulwark', levels, carried)),
    dmg: Math.round(base.dmg * relicFactor('edge', levels, carried)),
  };
}

/** How long the hero is away, with Haste accounted for. Never below a floor. */
export function respawnWith(
  heroLevel: number, levels: RelicLevels = {}, carried: RelicLoadout = [],
): number {
  const base = heroRespawnMinutes(heroLevel);
  const cut = relicFactor('haste', levels, carried) - 1;
  // A floor of three minutes, so no amount of Haste turns the hero into a unit
  // with no cost to losing — which is the only thing that made it worth caring
  // about in the first place.
  return Math.max(3, Math.round(base * (1 - Math.min(0.6, cut))));
}

export function isRelicType(v: string): v is RelicType {
  return (RELIC_TYPES as readonly string[]).includes(v);
}

/** Read levels off a JSON column without trusting a byte of it. */
export function parseRelics(raw: unknown): RelicLevels {
  const out: RelicLevels = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const t of RELIC_TYPES) {
    const n = (raw as Record<string, unknown>)[t];
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      out[t] = Math.min(RELIC_MAX_LEVEL, Math.floor(n));
    }
  }
  return out;
}

/**
 * Read a loadout off a JSON column.
 *
 * Always RELIC_SLOTS long, never carrying the same relic twice, and never
 * carrying one that has not been forged — a stored loadout is a thing a player
 * edited and a thing a migration could have left stale, and neither is trusted.
 */
export function parseLoadout(raw: unknown, levels: RelicLevels = {}): RelicLoadout {
  const out: RelicLoadout = [];
  const list = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < RELIC_SLOTS; i++) {
    const v = list[i];
    const ok = typeof v === 'string' && isRelicType(v)
      && (levels[v] ?? 0) > 0 && !out.includes(v);
    out.push(ok ? (v as RelicType) : null);
  }
  return out;
}

/**
 * When relics open.
 *
 * Not at the last Keep, though they are the answer to what happens after it.
 * A feature nobody can see until they have finished the game is a feature
 * almost nobody ever sees, and the point of relics is to be visible as the
 * thing you are heading towards. Two levels early: far enough in that the
 * player has a clan and a war record, close enough that it is a real prospect.
 */
export const RELIC_KEEP_LEVEL = HERO_MAX_LEVEL - 2;
