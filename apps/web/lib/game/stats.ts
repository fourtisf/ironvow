import {
  CAPACITY, DEF_STAT, PROD, TROOP, campSlots, defenceHits, hpOf, isTrap,
  trapDamage, trapSeconds, troopPower,
  type BuildingType, type TroopType,
} from '@ironvow/config';

/**
 * What a thing does, in numbers, for the screens where a player is choosing.
 *
 * ALFA, looking at the ARMY sheet: "harusnya kasih tau hp damage dll". He was
 * right, and it went further than the troops. A card said what a Raider costs
 * and how long it takes, and nothing at all about whether it is any good — so
 * picking between a Raider and an Archer was picking between two prices. The
 * BUILD sheet was worse: a Cannon and an Air Defence differed by their cost and
 * their name, and the fact that one of them cannot touch anything on foot was
 * nowhere on the screen at all.
 *
 * Everything here is derived, never typed. The numbers come from the same
 * config the simulation reads and the traits from the same flags it branches
 * on, so a card cannot come to disagree with the fight it describes — which is
 * the failure that matters, because a wrong number read as true is worse than
 * no number at all.
 */

/**
 * The one thing about a troop that is not a number.
 *
 * Derived from the flags rather than written per troop, so a troop cannot be
 * added without one, and the sentence cannot contradict what the unit does.
 * Ordered by what actually decides a raid: how it gets past a wall first, what
 * it walks toward second.
 */
export function troopTrait(type: TroopType): string {
  const d = TROOP[type];
  if (d.fly === true) return 'Flies over walls';
  if (d.climb === true) return 'Climbs walls';
  if (d.pref === 'wall') return 'Goes for walls';
  if (d.pref === 'def') return 'Goes for defences';
  if (d.air === true) return 'Shoots flyers';
  return 'Attacks what is nearest';
}

export interface TroopCardStats {
  hp: number;
  /** Damage a second: the honest comparison between a fast hit and a heavy one. */
  dps: number;
  trait: string;
}

/**
 * A troop at the level the Laboratory has taken it to.
 *
 * Damage per second and not damage per swing. A Raider hits for 16 and an
 * Archer for 21, which reads as "the Archer is a bit better" — but the Raider
 * swings every 0.80s and the Archer every 0.70, so it is 20 against 30, and the
 * gap is half again rather than a third. Per-swing damage is the number that
 * flatters a slow unit, and the Ram is the slowest thing in the game.
 */
export function troopCardStats(type: TroopType, level: number): TroopCardStats {
  const d = TROOP[type];
  const power = troopPower(level);
  return {
    hp: Math.round(d.hp * power),
    dps: Math.round((d.dmg * power) / d.cd),
    trait: troopTrait(type),
  };
}

/**
 * What a defence can shoot at, or null for anything that is not one.
 *
 * The single most expensive thing a player can not know. An Air Defence is the
 * strongest gun in the game and completely useless against troops on foot; a
 * Cannon cannot touch a Bomber. Neither fact appeared anywhere before a raid
 * was already lost.
 */
export function defenceTarget(type: BuildingType, level: number): string | null {
  /*
   * `DEF_STAT` and not `defenceHits`, which answers 'ground' for anything that
   * is not a gun at all — a sane default for the simulation, where a Gold Mine
   * never fires so the answer never matters, and nonsense on a label. It put
   * "Hits ground only" on the Storage, the Walls and the Laboratory.
   */
  if (!DEF_STAT[type]) return null;
  const hits = defenceHits(type, level);
  return hits === 'air' ? 'Hits flyers only'
    : hits === 'both' ? 'Hits flyers and ground'
      : 'Hits ground only';
}

/**
 * The one line that says what a building is for, at a given level.
 *
 * Shared by the BUILD sheet and the inspector so the two cannot drift — which
 * they had: the inspector worked a Storage out from `1400 + level * 1500` while
 * `CAPACITY` in config says `12000 + level * 12000`, so it reported a level 1
 * Storage as holding 2,900 when it holds 24,000. Nothing was wrong with the
 * game; the screen describing it was simply making the number up.
 */
export function buildingDetail(type: BuildingType, level: number): string {
  const rate = PROD[type];
  if (rate) return `${rate(level)}/min`;

  const defence = DEF_STAT[type];
  if (defence) {
    const st = defence(level);
    // A Mortar's dead zone belongs on the same line as its reach: "range 9.2"
    // on its own is the half of the story that flatters it.
    const reach = st.min ? `${st.min}–${st.rng}` : `${st.rng}`;
    return `${Math.round(st.dmg)}${st.splash ? ' splash' : ''} damage · range ${reach}`;
  }

  if (isTrap(type)) {
    // A trap has no range and no rate. What matters is what it does when
    // somebody finds it, and that they cannot see it coming.
    return type === 'snare'
      ? `Holds them ${trapSeconds('snare', level).toFixed(1)}s · hidden`
      : `${trapDamage('spike', level)} damage · hidden`;
  }

  if (type === 'camp') return `${campSlots(level)} army slots`;
  if (type === 'store') return `+${CAPACITY(level).toLocaleString('en-US')} storage`;
  return `${Math.round(hpOf(type, level)).toLocaleString('en-US')} hit points`;
}
