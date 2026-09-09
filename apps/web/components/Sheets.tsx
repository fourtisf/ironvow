'use client';

import { useState } from 'react';

import {
  TROOP,
  TROOP_ORDER,
  TROOP_UNLOCK,
  TYPES,
  bestBarracksLevel,
  KEEP_MAX,
  capOf,
  garrisonUsed,
  costOf,
  countOf,
  type BuildingType,
  type Cost,
  type TroopType,
  RELIC,
  type ItemType,
  type RelicType,
} from '@ironvow/config';
import { fmt, longUntil, until } from '../lib/format';
import type { BreachView, PlayerHit, PlayerProfile, RelicsView, SeasonState } from '../lib/api';
import type { PlayerState } from '../lib/game/types';
import { BladeIcon, GoldIcon, HeartIcon, IronIcon } from './icons';
import { TroopArt } from './TroopArt';
import { buildingDetail, defenceTarget, troopCardStats } from '../lib/game/stats';

/**
 * The build and army sheets.
 *
 * Prices shown here are computed from @ironvow/config, the same module the
 * server validates against. That is the point of putting the constants in a
 * shared package: the number on the card and the number the server charges
 * cannot drift, because there is only one of them.
 */

function CostLine({ cost, affordable }: { cost: Cost; affordable: boolean }) {
  return (
    <span className={`cost${affordable ? '' : ' no'}`}>
      {cost.g > 0 && <><GoldIcon />{fmt(cost.g)}</>}
      {cost.i > 0 && <><IronIcon />{fmt(cost.i)}</>}
      {cost.g === 0 && cost.i === 0 && 'free'}
    </span>
  );
}

/**
 * What the sheet offers.
 *
 * The War Lab was missing from this list. The server has always allowed one
 * from Keep 3, the cap table has always had a row for it, and the ARMY sheet
 * has always told the player to go and build one — but there was no card, so
 * there was no way to. A player could reach Keep 9 being told to build
 * something the game would not sell them.
 */
/*
 * The BUILD sheet, in the order it reads best: economy, then army, then
 * defence. Not derived from BUILDING_TYPES, because the order is a judgement
 * and the game's declaration order is not it.
 *
 * `apps/web/test/buildable.test.ts` asserts this and VANITY between them cover
 * every type a player can own. Nothing else would notice a new building that
 * was never added here: it would simply be unbuildable, with no error anywhere.
 */
export const BUILDABLE: BuildingType[] = [
  'mine', 'forge', 'store', 'camp', 'barr', 'lab', 'cannon', 'tower', 'mortar', 'airdef', 'wall',
  'spike', 'snare',
];

/** Bought to be looked at. Shown separately, and only once one is unlocked. */
export const VANITY: BuildingType[] = ['statue', 'brazier', 'standard'];

export interface BuildSheetProps {
  player: PlayerState;
  /** The crew, for the hire row. Null until /progression has answered. */
  crew: CrewView | null;
  onClose: () => void;
  onPick: (type: BuildingType) => void;
  onHireBuilder: () => void;
  /** The guide: which card to light up, and the line to say above the grid. */
  highlight?: BuildingType | null;
  hint?: string | null;
}

export function BuildSheet({
  player, crew, onClose, onPick, onHireBuilder, highlight = null, hint = null,
}: BuildSheetProps) {
  const owned = player.buildings.map((b) => ({ type: b.type, level: b.level }));
  // Hidden entirely until the Keep unlocks one, rather than shown greyed out:
  // a new player has enough to read without a locked row of ornaments.
  const showVanity = VANITY.some((t) => capOf(t, player.keepLevel) > 0);

  return (
    <div className="sheet">
      <div className="sheetHead">
        <div>
          <h2>BUILD</h2>
          <p>Everything is limited by your Town Hall level</p>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>
      {hint && <div className="sheetHint">{hint}</div>}

      {/*
        * The crew, above the grid.
        *
        * A hold starts with two builders and can hire up to ten. It sits here
        * rather than in a settings menu because it is the same decision as
        * everything below it — gold, spent on the hold — and because "why can
        * I only build one thing at a time" is a question a player asks while
        * looking at exactly this sheet.
        */}
      {crew && (
        <div className={`qrow${crew.nextCost !== null && player.gold >= crew.nextCost ? '' : ' done'}`}>
          <div className="qi">
            <h4>BUILDERS · {player.buildersFree} free of {crew.builders}</h4>
            <p>
              {crew.nextCost === null
                ? 'Your crew is as large as it gets.'
                : `Another builder means another job at once, for good · ${fmt(crew.nextCost)} gold`}
            </p>
            <div className="qbarBg">
              <div className="qbar" style={{ width: `${(crew.builders / crew.max) * 100}%` }} />
            </div>
          </div>
          {crew.nextCost === null ? (
            <span className="qrw">MAX</span>
          ) : (
            <button
              className={`btn gold${player.gold >= crew.nextCost ? '' : ' grey'}`}
              disabled={player.gold < crew.nextCost}
              onClick={onHireBuilder}
            >
              HIRE
            </button>
          )}
        </div>
      )}

      <div className="grid">{BUILDABLE.map(card)}</div>

      {showVanity && (
        <>
          <div className="dayHead" style={{ marginTop: 14 }}>
            <div>
              <h3>FOR THE LOOK</h3>
              <p>No defence, no production, no loot for a raider. Somewhere for the gold to go.</p>
            </div>
          </div>
          <div className="grid">{VANITY.map(card)}</div>
        </>
      )}
    </div>
  );

  function card(type: BuildingType) {
    const have = countOf(owned, type);
    const limit = capOf(type, player.keepLevel);
    const cost = costOf(type, 0, have);
    const affordable = player.gold >= cost.g && player.iron >= cost.i;
    const locked = have >= limit;

    return (
      <button
        key={type}
        className={`card${locked ? ' locked' : ''}${affordable ? '' : ' poor'}${type === highlight ? ' hi' : ''}`}
        onClick={() => !locked && onPick(type)}
        disabled={locked}
      >
        <span className="cnt">{have}/{limit}</span>
        <div className="nm">{TYPES[type].n}</div>
        <CostLine cost={cost} affordable={affordable} />
        {/* What it does, at the level it would be built at. A Cannon and an
          * Air Defence used to differ by their price and their name, and the
          * one that cannot touch anything on foot said so nowhere. */}
        <div className="stat">{buildingDetail(type, 1)}</div>
        {defenceTarget(type, 1) !== null && <div className="trait">{defenceTarget(type, 1)}</div>}
        <div className="sub">{locked ? 'LOCKED' : `${TYPES[type].s}×${TYPES[type].s}`}</div>
      </button>
    );
  }
}

/**
 * Hit points and damage a second, plus the one thing that is not a number.
 *
 * On the card rather than behind a tap: the choice being made is right here,
 * and a stat sheet a player has to go and find is a stat sheet that only the
 * players who already know the game will read.
 */
function TroopStats({ type, level }: { type: TroopType; level: number }) {
  const s = troopCardStats(type, level);
  return (
    <>
      <div className="stat">
        <span title="Hit points"><HeartIcon />{fmt(s.hp)}</span>
        <span title="Damage a second"><BladeIcon />{fmt(s.dps)}</span>
      </div>
      <div className="trait">{s.trait}</div>
    </>
  );
}

export interface CrewView {
  builders: number;
  max: number;
  /** Null once the crew is full. */
  nextCost: number | null;
}

export interface ProgressionView {
  crew: CrewView;
  hero: {
    name: string; level: number; maxLevel: number; unlockKeepLevel: number;
    unlocked: boolean; upgradeCost: Cost; readyAt: string | null; respawnMinutes: number;
    stats: { hp: number; dmg: number };
  };
  lab: {
    level: number;
    troops: { type: TroopType; level: number; power: number; upgradeCost: Cost }[];
  };
  /** Battle items, and what is still locked behind a higher Town Hall. */
  items: {
    type: ItemType; n: string; d: string; cost: Cost;
    cap: number; keep: number; held: number; unlocked: boolean;
  }[];
  relics: RelicsView;
}

export interface ArmySheetProps {
  player: PlayerState;
  progression: ProgressionView | null;
  onClose: () => void;
  onTrain: (type: TroopType, count: number) => void;
  onUpgradeHero: () => void;
  onUpgradeTroop: (type: TroopType) => void;
  onCancelJob: (jobId: string) => void;
  onBuyItem: (type: ItemType) => void;
  onForgeRelic: (type: RelicType) => void;
  onCarryRelic: (slot: number, type: RelicType | null) => void;
  /**
   * Takes the player to BUILD with the War Lab in hand.
   *
   * The row that says troops can be levelled used to be a grey sentence with
   * nothing behind it, which is a strange thing to show somebody who has just
   * asked how to make their army stronger.
   */
  onBuildLab: () => void;
  /** The guide: which troop to light up, and the line to say at the top. */
  highlight?: TroopType | null;
  hint?: string | null;
}

/**
 * The level a troop is actually fighting at.
 *
 * One reading, used by the roster art and the badge over it, so the picture and
 * the number can never disagree about what a player owns.
 */
function troopLevel(progression: ProgressionView | null, type: TroopType): number {
  return progression?.lab?.troops.find((x) => x.type === type)?.level ?? 1;
}

/** The Town Hall level a Laboratory opens at, read from the cap table rather than typed. */
const LAB_KEEP_LEVEL = (() => {
  for (let keep = 1; keep <= KEEP_MAX; keep++) if (capOf('lab', keep) > 0) return keep;
  return KEEP_MAX;
})();

function labUnlocked(player: PlayerState): boolean {
  return player.keepLevel >= LAB_KEEP_LEVEL;
}

/**
 * How many a tap trains.
 *
 * MAX is not a number, it is "as many as still fit" — worked out per troop,
 * because a Ram takes six slots and a Raider one, so one setting cannot be a
 * count. The server already validates each unit of a batch on its own and
 * queues what it can afford, so asking for more than the purse allows fills
 * the warband as far as the gold goes rather than failing.
 */
type Batch = 1 | 5 | 'max';

export function ArmySheet({
  player, progression, onClose, onTrain, onUpgradeHero, onUpgradeTroop, onCancelJob,
  onBuildLab, onBuyItem, onForgeRelic, onCarryRelic, highlight = null, hint = null,
}: ArmySheetProps) {
  const [batch, setBatch] = useState<Batch>(1);
  const owned = player.buildings.map((b) => ({ type: b.type, level: b.level }));
  const barracks = bestBarracksLevel(owned);
  const now = Date.now();
  const hero = progression?.hero;
  const lab = progression?.lab;
  const items = progression?.items;
  const relics = progression?.relics;

  return (
    <div className="sheet">
      <div className="sheetHead">
        <div>
          <h2>ARMY</h2>
          <p>Army {player.armyUsed} / {player.armyCap} slots</p>
        </div>
        {/*
          * Filling a warband was fourteen taps on the same card. This says how
          * many one tap is worth, and it stays where it is put — a player who
          * has decided to train in fives is going to do it more than once.
          */}
        <div className="batchPick" role="group" aria-label="How many each tap trains">
          {([1, 5, 'max'] as const).map((n) => (
            <button
              key={String(n)}
              className={batch === n ? 'on' : ''}
              onClick={() => setBatch(n)}
              aria-pressed={batch === n}
            >
              {n === 'max' ? 'MAX' : `×${n}`}
            </button>
          ))}
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>
      {hint && <div className="sheetHint">{hint}</div>}

      <div className="grid">
        {TROOP_ORDER.map((type) => {
          const def = TROOP[type];
          const locked = barracks < TROOP_UNLOCK[type];
          const affordable = player.gold >= def.cost.g && player.iron >= def.cost.i;
          const room = player.armyUsed + def.sp <= player.armyCap;
          // What one tap queues. Slots are the binding constraint, not gold:
          // the server stops a batch when the purse runs out and says so.
          const fits = Math.max(1, Math.floor((player.armyCap - player.armyUsed) / def.sp));
          const count = batch === 'max' ? Math.min(50, fits) : batch;

          return (
            <button
              key={type}
              className={`card${locked ? ' locked' : ''}${affordable ? '' : ' poor'}${type === highlight ? ' hi' : ''}`}
              onClick={() => !locked && room && onTrain(type, count)}
              disabled={locked || !room}
            >
              <span className="cnt">{player.army[type] ?? 0}</span>
              {/* The roster shows the troop, at the level the Laboratory has
                * taken it to, so the army screen is a barracks rather than a
                * price list — and says the level out loud, because a plume and
                * a coat of paint are not a number a player can plan around. */}
              <span className="lvl">Lv {troopLevel(progression, type)}</span>
              <TroopArt type={type} level={troopLevel(progression, type)} size={52} />
              <div className="nm">{def.n}</div>
              <CostLine cost={def.cost} affordable={affordable} />
              {/* What the card was missing: whether the thing is any good.
                * Cost and training time describe what it takes to have one,
                * and say nothing about what having one is worth. */}
              <TroopStats type={type} level={troopLevel(progression, type)} />
              <div className="sub">
                {locked ? `BARRACKS ${TROOP_UNLOCK[type]}` : `${def.sp} SLOT${def.sp > 1 ? 'S' : ''} · ${def.tt}s`}
              </div>
            </button>
          );
        })}
      </div>

      {/*
        The hero, above the queue and apart from the troop grid: it is the one
        unit that persists, so it does not belong in a list of things you spend.
      */}
      {hero?.unlocked && (
        <>
          <div className="sheetHead" style={{ marginTop: 14 }}>
            <div>
              <h2>{hero.name.toUpperCase()}</h2>
              <p>
                {hero.readyAt
                  ? `Recovering — back in ${until(hero.readyAt, now)}`
                  : `Ready · ${fmt(hero.stats.hp)} hit points · ${fmt(hero.stats.dmg)} damage`}
              </p>
            </div>
          </div>
          <div className="qrow">
            {/* The Vowkeeper gets the same before-and-after as the troops:
              * it is the one unit a player picks out of a crowd, so what a
              * rank buys should be visible before it is bought. */}
            <div className="troopStep">
              <TroopArt type="hero" level={hero.level} size={58} />
              {hero.level < hero.maxLevel && (
                <>
                  <span className="troopArrow">›</span>
                  <TroopArt type="hero" level={hero.level + 1} size={58} faded />
                </>
              )}
            </div>
            <div className="qi">
              <h4>Rank {hero.level}{hero.level >= hero.maxLevel ? ' · highest' : ''}</h4>
              <p>
                Deployed once per raid, and away for {hero.respawnMinutes} minutes if it falls.
                Takes no army space.
              </p>
              <div className="qbarBg">
                <div className="qbar" style={{ width: `${(hero.level / hero.maxLevel) * 100}%` }} />
              </div>
            </div>
            {hero.level < hero.maxLevel && hero.level < player.keepLevel ? (
              <button
                className={`btn gold${player.gold >= hero.upgradeCost.g && player.iron >= hero.upgradeCost.i ? '' : ' grey'}`}
                onClick={onUpgradeHero}
                disabled={player.gold < hero.upgradeCost.g || player.iron < hero.upgradeCost.i}
              >
                RAISE
              </button>
            ) : (
              <span className="qrw">{hero.level >= hero.maxLevel ? 'MAX' : 'KEEP CAP'}</span>
            )}
          </div>
          {hero.level < hero.maxLevel && hero.level < player.keepLevel && (
            <p className="lead" style={{ textAlign: 'center', marginTop: 6 }}>
              Next rank: {fmt(hero.upgradeCost.g)} gold, {fmt(hero.upgradeCost.i)} iron
            </p>
          )}
        </>
      )}

      {hero && !hero.unlocked && (
        <div className="qrow" style={{ marginTop: 12 }}>
          <div className="qi">
            <h4>A hero awaits</h4>
            <p>Upgrade your Town Hall to level {hero.unlockKeepLevel} to unlock one.</p>
          </div>
        </div>
      )}

      {/* The Laboratory: the answer to "my troops never get stronger". */}
      {lab && lab.level > 0 && (
        <>
          <div className="sheetHead" style={{ marginTop: 14 }}>
            <div>
              <h2>LABORATORY {lab.level}</h2>
              <p>Every level is +12% hit points and damage, for good</p>
            </div>
          </div>
          {lab.troops.map((t) => {
            const capped = t.level >= lab.level;
            const affordable = player.gold >= t.upgradeCost.g && player.iron >= t.upgradeCost.i;
            return (
              <div className="qrow" key={t.type}>
                {/*
                  * What the gold actually buys.
                  *
                  * The kit changes with the level — leather, banded steel,
                  * plate and a plume, gilded — so the row shows the troop as
                  * it stands today and, when there is one to buy, a faded
                  * preview of what the next level turns it into. It is the
                  * same drawUnit the battle uses, so these cannot drift apart.
                  */}
                <div className="troopStep">
                  <TroopArt type={t.type} level={t.level} size={58} />
                  {!capped && (
                    <>
                      <span className="troopArrow">›</span>
                      <TroopArt type={t.type} level={t.level + 1} size={58} faded />
                    </>
                  )}
                </div>
                <div className="qi">
                  <h4>{TROOP[t.type].n} · level {t.level}</h4>
                  <p>
                    {Math.round(t.power * 100 - 100)}% stronger than base
                    {!capped && ` · next: ${fmt(t.upgradeCost.g)} gold, ${fmt(t.upgradeCost.i)} iron`}
                  </p>
                  <div className="qbarBg">
                    <div className="qbar" style={{ width: `${(t.level / 9) * 100}%` }} />
                  </div>
                </div>
                {capped ? (
                  <span className="qrw">{lab.level >= 9 ? 'MAX' : 'LAB CAP'}</span>
                ) : (
                  <button
                    className={`btn${affordable ? '' : ' grey'}`}
                    disabled={!affordable}
                    onClick={() => onUpgradeTroop(t.type)}
                  >
                    UPGRADE
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}

      {/*
        * No Lab yet, which until now was a grey sentence and a dead end.
        *
        * It is the answer to "can my army level up", so it says what a level
        * buys, what it takes to get one, and — when the Keep is high enough —
        * offers to go and build it. The same shape as the hero row above,
        * which has always done this properly.
        */}
      {/*
        * Relics.
        *
        * Above the pouch and below the hero, because that is where they sit in
        * the game: the hero's own progression, carried on after the Keep and
        * everything on it has finished. Shown locked rather than hidden, so a
        * player climbing towards Keep 7 can see what is waiting.
        */}
      {relics && (
        <>
          <div className="sheetHead" style={{ marginTop: 14 }}>
            <div>
              <h2>RELICS</h2>
              <p>
                {relics.unlocked
                  ? `${relics.shards} shards · won in clan wars, and slowly at a season's close`
                  : `Unlocks at Town Hall ${relics.keep}. What the Vowkeeper equips when everything else is done.`}
              </p>
            </div>
          </div>

          {relics.unlocked && (
            <div className="qrow" style={{ borderColor: '#7a5a24' }}>
              <div className="qi">
                <h4>EQUIPPED {relics.carried.filter(Boolean).length} OF {relics.slots}</h4>
                <p>
                  Fewer slots than relics, on purpose. The Vowkeeper returns in{' '}
                  {relics.respawnMinutes} min after falling.
                </p>
              </div>
              <div className="slotRow">
                {relics.carried.map((held, i) => (
                  <button
                    key={i}
                    className={`slot${held ? ' on' : ''}`}
                    onClick={() => held && onCarryRelic(i, null)}
                    title={held ? 'Put it down' : 'Empty'}
                  >
                    {held ? RELIC[held].n : '—'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {relics.list.map((r) => {
            const carried = relics.carried.includes(r.type);
            const full = relics.carried.every(Boolean);
            const afford = r.cost !== null && relics.shards >= r.cost;
            return (
              <div className={`qrow${relics.unlocked ? '' : ' done'}`} key={r.type}>
                <div className="qi">
                  <h4>
                    {r.n.toUpperCase()}
                    {r.level > 0 && ` · LEVEL ${r.level}`}
                    {carried && ' · CARRIED'}
                  </h4>
                  <p>
                    {r.d}
                    {r.level > 0 && ` Now +${Math.round(r.per * r.level * 100)}%.`}
                  </p>
                </div>
                {relics.unlocked && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 'none' }}>
                    <button
                      className={`btn${afford ? ' gold' : ' grey'}`}
                      disabled={r.cost === null || !afford}
                      onClick={() => onForgeRelic(r.type)}
                    >
                      {r.cost === null ? 'MAX' : `${r.level === 0 ? 'UNLOCK' : 'UPGRADE'} ${r.cost}`}
                    </button>
                    {r.level > 0 && !carried && (
                      <button
                        className="btn grey"
                        onClick={() => {
                          // Into the first empty slot, or the first slot when
                          // both are full: a tap should always do something.
                          const empty = relics.carried.findIndex((x) => !x);
                          onCarryRelic(full ? 0 : Math.max(0, empty), r.type);
                        }}
                      >
                        EQUIP
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/*
        * The pouch.
        *
        * Below the Lab because it is the same kind of thing one step further
        * along: the Lab makes every raid stronger for good, an item makes one
        * raid stronger once. Locked rows are shown rather than hidden, so the
        * Keep level is something to climb towards rather than a surprise.
        */}
      {items && items.length > 0 && (
        <>
          <div className="sheetHead" style={{ marginTop: 14 }}>
            <div>
              <h2>BATTLE ITEMS</h2>
              <p>Carried into a raid and spent there. Bought before you go, never during.</p>
            </div>
          </div>
          {items.map((it) => {
            const full = it.held >= it.cap;
            const poor = player.gold < it.cost.g || player.iron < it.cost.i;
            return (
              <div className={`qrow${it.unlocked ? '' : ' done'}`} key={it.type}>
                <div className="qi">
                  <h4>{it.n.toUpperCase()} · {it.held} of {it.cap}</h4>
                  <p>
                    {it.unlocked
                      ? it.d
                      : `Unlocks at Town Hall ${it.keep}. ${it.d}`}
                  </p>
                </div>
                <span className="qrw">
                  {it.cost.g > 0 && <><GoldIcon /> {fmt(it.cost.g)}</>}
                  {it.cost.i > 0 && <><IronIcon /> {fmt(it.cost.i)}</>}
                </span>
                {it.unlocked && (
                  <button
                    className={`btn${full || poor ? '' : ' gold'}`}
                    disabled={full || poor}
                    onClick={() => onBuyItem(it.type)}
                  >
                    {full ? 'FULL' : 'BUY'}
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}

      {lab && lab.level === 0 && (
        <>
          <div className="sheetHead" style={{ marginTop: 14 }}>
            <div>
              <h2>LABORATORY</h2>
              <p>Where troops gain levels: +12% hit points and damage each, for good</p>
            </div>
          </div>
          <div className="qrow">
            <div className="troopStep">
              <TroopArt type="raider" level={1} size={58} />
              <span className="troopArrow">›</span>
              <TroopArt type="raider" level={5} size={58} faded />
            </div>
            <div className="qi">
              <h4>{labUnlocked(player) ? 'Not built yet' : `Upgrade your Town Hall to level ${LAB_KEEP_LEVEL}`}</h4>
              <p>
                {labUnlocked(player)
                  ? 'One Lab, and every troop you own can be raised — kept for good, on every raid after.'
                  : 'A Lab opens there. Until then your troops get more numerous, not stronger.'}
              </p>
            </div>
            {labUnlocked(player) && (
              <button className="btn gold" onClick={onBuildLab}>BUILD</button>
            )}
          </div>
        </>
      )}

      {/*
        * The garrison: what the clan gave you.
        *
        * On the ARMY screen rather than the CLAN one, because this is part of
        * what your base fields — it is just the part somebody else paid for.
        */}
      {player.garrisonCap > 0 && (
        <>
          <div className="sheetHead" style={{ marginTop: 14 }}>
            <div>
              <h2>CLAN TROOPS</h2>
              <p>
                {garrisonUsed(player.garrison)} / {player.garrisonCap} slots · they
                defend your base, and they are used up doing it
              </p>
            </div>
          </div>
          {TROOP_ORDER.some((t) => (player.garrison[t] ?? 0) > 0) ? (
            <div className="grid">
              {TROOP_ORDER.filter((t) => (player.garrison[t] ?? 0) > 0).map((t) => (
                <div className="card" key={t}>
                  <span className="cnt">{player.garrison[t]}</span>
                  <TroopArt type={t} level={troopLevel(progression, t)} size={52} />
                  <div className="nm">{TROOP[t].n}</div>
                  <div className="sub">GIVEN</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="qrow">
              <div className="qi">
                <h4>Empty</h4>
                <p>Ask your clan. Anyone in it can send troops, and they fight for you while you are asleep.</p>
              </div>
            </div>
          )}
        </>
      )}

      {player.queue.length > 0 && (
        <>
          <div className="sheetHead" style={{ marginTop: 14 }}>
            <div><h2>IN TRAINING</h2><p>Finishes on the server, whether you are here or not</p></div>
          </div>
          {player.queue.map((job) => (
            <div className="qrow" key={job.id}>
              <div className="qi">
                <h4>{TROOP[job.type].n}</h4>
                <p>ready in {until(job.finishesAt, now)}</p>
              </div>
              {/* Nothing has been mustered yet, so taking it back costs nothing. */}
              <button className="btn grey" onClick={() => onCancelJob(job.id)}>CANCEL</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export interface DefendPromptProps {
  onDrill: () => void;
}

/**
 * Why the hold fell.
 *
 * Watching a raid back tells a defender that they lost. It does not tell them
 * that all of them came in over one corner, or that the Mortar they paid four
 * thousand gold for never fired a shot — and only the second kind of fact can
 * be acted on this afternoon.
 *
 * Ordered by what a player can do about it: the side first, because moving a
 * building is the cheapest fix there is; then the guns that never fired, which
 * is a placement problem rather than a balance one; then the traps nobody
 * found; then the order the hold came apart in.
 */
export function BreachSheet({ report, onClose }: { report: BreachView; onClose: () => void }) {
  const found = report.traps.filter((t) => t.sprung).length;
  const secs = (n: number) => `${Math.round(n)}s`;

  return (
    <div className="sheet">
      <div className="sheetHead">
        <div>
          <h2>WHAT WENT WRONG</h2>
          <p>
            {report.stars}★ · {Math.round(report.destroyedPct * 100)}% in {secs(report.seconds)}
          </p>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>

      <div className="qrow" style={{ borderColor: '#e8b23c' }}>
        <div className="qi">
          <h4>{report.side === 'everywhere' ? 'THEY CAME FROM ALL OVER' : `THEY CAME FROM THE ${report.side.toUpperCase()}`}</h4>
          <p>
            {report.side === 'everywhere'
              ? 'No one side gave way. This was an even attack — the fix is not a corner, it is more of everything.'
              : 'That side of your base is the weak one. Moving a defence there costs nothing but a builder.'}
          </p>
        </div>
      </div>

      {/*
        * The air line comes first, above the guns that never fired, because it
        * is the one problem on this sheet a defender could not have seen for
        * themselves — and because a base with no cover at all loses to the
        * next Bomber too, whatever else they fix.
        */}
      {report.airBlind && (
        <div className="qrow" style={{ borderColor: '#d64f38' }}>
          <div className="qi">
            <h4>THEY CAME BY AIR</h4>
            <p>
              Nothing on your base shoots up. Cannons and Mortars cannot reach a
              flyer, and walls and traps do not touch one. Build an Air Defence,
              or an Archer Tower, on the side they came from.
            </p>
          </div>
        </div>
      )}

      {report.idle.length > 0 ? (
        <>
          <div className="dayHead" style={{ marginTop: 14 }}>
            <div>
              <h3>NEVER FIRED A SHOT</h3>
              <p>They never walked into these. A gun covering ground nobody crosses is a gun you do not have.</p>
            </div>
          </div>
          {report.idle.map((x, i) => (
            <div className="qrow" key={`${x.type}${i}`}>
              <div className="qi"><h4>{x.n} · level {x.level}</h4>
                <p>Out of the fight for the whole raid.</p></div>
            </div>
          ))}
        </>
      ) : (
        <div className="qrow"><div className="qi">
          <h4>Every defence got a shot off</h4>
          <p>Nothing was wasted on empty ground. What beat you was strength, not placement.</p>
        </div></div>
      )}

      {report.traps.length > 0 && (
        <>
          <div className="dayHead" style={{ marginTop: 14 }}>
            <div>
              <h3>TRAPS · {found} OF {report.traps.length} FOUND</h3>
              <p>A trap they never walked over is a trap you paid for and did not use.</p>
            </div>
          </div>
          {report.traps.map((t, i) => (
            <div className={`qrow${t.sprung ? '' : ' done'}`} key={`${t.type}${i}`}>
              <div className="qi"><h4>{t.n} · level {t.level}</h4>
                <p>{t.sprung ? `Sprung at ${secs(t.at ?? 0)}.` : 'Never found.'}</p></div>
              <span className="qrw">{t.sprung ? 'HIT' : '—'}</span>
            </div>
          ))}
        </>
      )}

      {report.fell.length > 0 && (
        <>
          <div className="dayHead" style={{ marginTop: 14 }}>
            <div>
              <h3>THE ORDER IT CAME APART</h3>
              <p>Walls left out — they fall by the dozen and say nothing about what went wrong.</p>
            </div>
          </div>
          {report.fell.map((f, i) => (
            <div className="qrow" key={`${f.type}${i}`}>
              <div className="qi"><h4>{i + 1}. {f.n} · level {f.level}</h4>
                <p>Fell at {secs(f.at)}.</p></div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export interface LogSheetProps {
  raids: {
    raidId: string;
    attacker: { name: string; trophies: number };
    stars: number;
    lost: { g: number; i: number };
    trophyDelta: number;
    at: string;
    replayable: boolean;
    avengeable: boolean;
  }[];
  onClose: () => void;
  onReplay: (raidId: string) => void;
  onReport: (raidId: string) => void;
  onRevenge: (raidId: string) => void;
  onDrill: () => void;
}

export function LogSheet({ raids, onClose, onReplay, onReport, onRevenge, onDrill }: LogSheetProps) {
  return (
    <div className="sheet">
      <div className="sheetHead">
        <div>
          <h2>ATTACK LOG</h2>
          <p>Watch any raid back exactly as it happened, then answer it</p>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>

      {/*
        A practice attack on your own walls. Better to find out your layout does not
        base while nothing is at stake than to read it in this log afterwards.
      */}
      <div className="qrow" style={{ borderColor: '#e8b23c' }}>
        <div className="qi">
          <h4>Test your defences</h4>
          <p>Send a practice attack at your own base. Nothing is at stake.</p>
        </div>
        <button className="btn gold" onClick={onDrill}>PRACTICE</button>
      </div>

      {raids.length === 0 && (
        <div className="qrow"><div className="qi"><h4>Nobody has hit you yet</h4>
          <p>Raids against your base show up here.</p></div></div>
      )}

      {raids.map((r) => (
        <div className="qrow" key={r.raidId}>
          <div className="qi">
            <h4>{r.attacker.name} · {r.stars}★</h4>
            <p>
              lost {fmt(r.lost.g)} gold, {fmt(r.lost.i)} iron
              {r.trophyDelta !== 0 && ` · ${r.trophyDelta > 0 ? '+' : ''}${r.trophyDelta} trophies`}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 'none' }}>
            {r.replayable
              ? <>
                  <button className="btn grey" onClick={() => onReplay(r.raidId)}>WATCH</button>
                  {/* Beside WATCH rather than instead of it: one shows what
                    * happened, the other says what to do about it. */}
                  <button className="btn grey" onClick={() => onReport(r.raidId)}>WHY</button>
                </>
              : <span className="qrw">—</span>}
            {r.avengeable && (
              <button className="btn red" onClick={() => onRevenge(r.raidId)}>HIT BACK</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}


export interface LadderRow {
  id: string;
  name: string;
  trophies: number;
  keepLevel: number;
  rank: number;
  isMe: boolean;
}

/**
 * The page behind a name.
 *
 * You could raid somebody and never learn a thing about them beyond a name and
 * a star count. This is what a name is worth: how far up they are, who they
 * fight with, and how their hold has fared.
 *
 * Deliberately not a layout. A profile that scouted for free would make the
 * reroll cost meaningless, and the server does not send one.
 */
export function ProfileSheet({ p, onClose }: { p: PlayerProfile; onClose: () => void }) {
  const rate = p.raids > 0 ? Math.round((p.wins / p.raids) * 100) : null;
  const since = new Date(p.since);

  return (
    <div className="sheet">
      <div className="sheetHead">
        <div>
          <h2>{p.name.toUpperCase()}</h2>
          <p>
            Town Hall {p.keepLevel} · Vowkeeper {p.heroLevel} · playing since{' '}
            {since.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
          </p>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>

      <div className="qrow" style={{ borderColor: '#e8b23c' }}>
        <div className="qi">
          <h4>#{p.rank} ON THE LEADERBOARD</h4>
          <p>{p.trophies} trophies now · {p.seasonPeak} at their best this season</p>
        </div>
      </div>

      {p.clan ? (
        <div className="qrow">
          <div className="qi">
            <h4>{p.clan.name} [{p.clan.tag}]</h4>
            <p>{p.clan.role === 'leader' ? 'Leads it' : p.clan.role === 'elder' ? 'An elder' : 'A member'}</p>
          </div>
        </div>
      ) : (
        <div className="qrow done"><div className="qi">
          <h4>No clan</h4><p>Fights alone.</p></div></div>
      )}

      <div className="qrow">
        <div className="qi">
          <h4>{p.raids} RAIDS</h4>
          <p>
            {p.wins} won{rate !== null && ` · ${rate}%`} · {p.threeStars} flattened outright
          </p>
        </div>
      </div>
    </div>
  );
}

export interface LadderSheetProps {
  top: LadderRow[];
  me: { name: string; trophies: number; rank: number } | null;
  total: number;
  /** Null while it is still loading, or if the request failed. The board works without it. */
  season: SeasonState | null;
  onFind: (q: string) => Promise<PlayerHit[]>;
  onOpen: (id: string) => void;
  onClose: () => void;
}

/**
 * The season banner: a clock, a band, and what the band is worth.
 *
 * It sits above the board rather than in a sheet of its own because the two
 * numbers only mean anything together — a rank without a deadline is a
 * scoreboard, and a deadline without a rank is a countdown to nothing.
 *
 * The peak is what is shown, not the current total. Those differ exactly when
 * a player has lost trophies since their best night, and that is the moment
 * the distinction is worth making: what they already earned is safe.
 */
export function SeasonBanner({ season }: { season: SeasonState }) {
  const { tier, next, peak } = season;
  const span = next ? next.at - (tier?.at ?? 0) : 1;
  const done = next ? Math.min(1, Math.max(0, (peak - (tier?.at ?? 0)) / span)) : 1;

  return (
    <div className="season">
      <div className="seasonHead">
        <h3>SEASON {season.index}</h3>
        <span className="seasonClock">{longUntil(season.msLeft)} left</span>
      </div>

      <div className="seasonBand">
        <strong>{tier ? tier.n : 'Unranked'}</strong>
        <span>#{season.rank} of {season.contenders || 1}</span>
      </div>

      <div className="seasonBar"><i style={{ width: `${Math.round(done * 100)}%` }} /></div>

      <p className="lead">
        {next
          ? <>Peak {peak} — {next.at - peak} more to reach {next.n}</>
          : <>Peak {peak} — the top band. Hold it.</>}
      </p>

      {tier && (
        <p className="lead">
          Pays <GoldIcon /> {fmt(tier.reward.g)} and <IronIcon /> {fmt(tier.reward.i)} when the
          season ends. Losing trophies cannot take it back.
        </p>
      )}
      {!tier && season.next && (
        <p className="lead">
          Reach {season.next.at} trophies to be paid at all. Below that a season is worth nothing.
        </p>
      )}

      <p className="lead dim">
        At the close you keep {season.resetTo} of your {season.trophies}, and the climb starts again.
      </p>

      {season.last && (
        <div className="qrow" style={{ marginTop: 10 }}>
          <div className="qi">
            <h4>Season {season.last.index} paid out</h4>
            <p>#{season.last.rank} at {season.last.trophies} trophies</p>
          </div>
          <span className="qrw">{fmt(season.last.gold)}g</span>
        </div>
      )}
    </div>
  );
}

/**
 * The ladder.
 *
 * A player far down the list still gets their own rank pinned at the top,
 * because that is the number they actually came to see.
 */
export function LadderSheet({ top, me, total, season, onFind, onOpen, onClose }: LadderSheetProps) {
  const inTop = top.some((p) => p.isMe);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PlayerHit[] | null>(null);

  /*
   * Search sits on the ladder rather than in a sheet of its own.
   *
   * It is the same question the board answers — who is out there — asked about
   * one person instead of the top fifty, and a player who wants to look
   * somebody up opens the leaderboard first anyway.
   */
  const look = (next: string): void => {
    setQ(next);
    if (next.trim().length < 2) { setHits(null); return; }
    void onFind(next).then(setHits).catch(() => setHits([]));
  };

  return (
    <div className="sheet">
      <div className="sheetHead">
        <div>
          <h2>LEADERBOARD</h2>
          <p>{total} base{total === 1 ? '' : 's'} in the valley</p>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>

      {season && <SeasonBanner season={season} />}

      {/* The same row the clan search uses, because it is the same gesture. */}
      <div className="formRow">
        <input
          value={q}
          onChange={(e) => look(e.target.value)}
          placeholder="Find a base by name"
          aria-label="Find a player"
        />
      </div>

      {hits !== null && (
        hits.length === 0
          ? <div className="qrow"><div className="qi"><h4>No base by that name</h4>
              <p>Names are exact. Ask them how theirs is spelled.</p></div></div>
          : hits.map((p) => (
              <div className={`qrow${p.isMe ? ' me' : ''}`} key={p.id}>
                <div className="qi">
                  <h4>{p.name}</h4>
                  <p>Town Hall {p.keepLevel} · {p.trophies} trophies</p>
                </div>
                <button className="btn grey" onClick={() => onOpen(p.id)}>LOOK</button>
              </div>
            ))
      )}

      {me && !inTop && (
        <div className="qrow" style={{ borderColor: '#e8b23c', marginBottom: 12 }}>
          <div className="qi">
            <h4>#{me.rank} · {me.name}</h4>
            <p>{me.trophies} trophies — keep raiding to climb</p>
          </div>
        </div>
      )}

      {top.length === 0 && (
        <div className="qrow"><div className="qi"><h4>Nobody has climbed yet</h4>
          <p>Win a raid and you are on the board.</p></div></div>
      )}

      {top.map((p) => (
        // The whole row, because a name on a board that cannot be tapped is a
        // name the player has already tried to tap.
        <button className={`qrow tap${p.isMe ? ' me' : ''}`} key={p.id} onClick={() => onOpen(p.id)}>
          <div className="qi">
            <h4>#{p.rank} · {p.name}</h4>
            <p>Town Hall {p.keepLevel}</p>
          </div>
          <span className="qrw">{p.trophies}</span>
        </button>
      ))}
    </div>
  );
}
