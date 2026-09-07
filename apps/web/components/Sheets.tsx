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
  costOf,
  countOf,
  type BuildingType,
  type Cost,
  type TroopType,
} from '@ironvow/config';
import { fmt, until } from '../lib/format';
import type { PlayerState } from '../lib/game/types';
import { GoldIcon, IronIcon } from './icons';
import { TroopArt } from './TroopArt';

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
const BUILDABLE: BuildingType[] = ['mine', 'forge', 'store', 'camp', 'barr', 'lab', 'cannon', 'tower', 'wall'];

/** Bought to be looked at. Shown separately, and only once one is unlocked. */
const VANITY: BuildingType[] = ['statue', 'brazier', 'standard'];

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
          <p>Everything is capped by your Keep&rsquo;s level</p>
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
        <div className="sub">{locked ? 'RAISE KEEP' : `${TYPES[type].s}×${TYPES[type].s}`}</div>
      </button>
    );
  }
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
}

export interface ArmySheetProps {
  player: PlayerState;
  progression: ProgressionView | null;
  onClose: () => void;
  onTrain: (type: TroopType, count: number) => void;
  onUpgradeHero: () => void;
  onUpgradeTroop: (type: TroopType) => void;
  onCancelJob: (jobId: string) => void;
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

/** The Keep level a War Lab opens at, read from the cap table rather than typed. */
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
  onBuildLab, highlight = null, hint = null,
}: ArmySheetProps) {
  const [batch, setBatch] = useState<Batch>(1);
  const owned = player.buildings.map((b) => ({ type: b.type, level: b.level }));
  const barracks = bestBarracksLevel(owned);
  const now = Date.now();
  const hero = progression?.hero;
  const lab = progression?.lab;

  return (
    <div className="sheet">
      <div className="sheetHead">
        <div>
          <h2>ARMY</h2>
          <p>Warband {player.armyUsed} / {player.armyCap} slots</p>
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
              {/* The roster shows the troop, at the level the War Lab has
                * taken it to, so the army screen is a barracks rather than a
                * price list — and says the level out loud, because a plume and
                * a coat of paint are not a number a player can plan around. */}
              <span className="lvl">Lv {troopLevel(progression, type)}</span>
              <TroopArt type={type} level={troopLevel(progression, type)} size={52} />
              <div className="nm">{def.n}</div>
              <CostLine cost={def.cost} affordable={affordable} />
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
                Costs no warband room.
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
            <p>Raise your Keep to level {hero.unlockKeepLevel} to call one.</p>
          </div>
        </div>
      )}

      {/* The War Lab: the answer to "my troops never get stronger". */}
      {lab && lab.level > 0 && (
        <>
          <div className="sheetHead" style={{ marginTop: 14 }}>
            <div>
              <h2>WAR LAB {lab.level}</h2>
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
      {lab && lab.level === 0 && (
        <>
          <div className="sheetHead" style={{ marginTop: 14 }}>
            <div>
              <h2>WAR LAB</h2>
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
              <h4>{labUnlocked(player) ? 'Not built yet' : `Raise your Keep to level ${LAB_KEEP_LEVEL}`}</h4>
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
  onRevenge: (raidId: string) => void;
  onDrill: () => void;
}

export function LogSheet({ raids, onClose, onReplay, onRevenge, onDrill }: LogSheetProps) {
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
        A drill against your own walls. Better to find out your layout does not
        hold while nothing is at stake than to read it in this log afterwards.
      */}
      <div className="qrow" style={{ borderColor: '#e8b23c' }}>
        <div className="qi">
          <h4>Test your defences</h4>
          <p>Send a practice wave at your own hold. Nothing is at stake.</p>
        </div>
        <button className="btn gold" onClick={onDrill}>DRILL</button>
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
              ? <button className="btn grey" onClick={() => onReplay(r.raidId)}>WATCH</button>
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

export interface LadderSheetProps {
  top: LadderRow[];
  me: { name: string; trophies: number; rank: number } | null;
  total: number;
  onClose: () => void;
}

/**
 * The ladder.
 *
 * A player far down the list still gets their own rank pinned at the top,
 * because that is the number they actually came to see.
 */
export function LadderSheet({ top, me, total, onClose }: LadderSheetProps) {
  const inTop = top.some((p) => p.isMe);

  return (
    <div className="sheet">
      <div className="sheetHead">
        <div>
          <h2>LADDER</h2>
          <p>{total} hold{total === 1 ? '' : 's'} in the valley</p>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>

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
        <div className={`qrow${p.isMe ? ' me' : ''}`} key={p.id}>
          <div className="qi">
            <h4>#{p.rank} · {p.name}</h4>
            <p>Keep {p.keepLevel}</p>
          </div>
          <span className="qrw">{p.trophies}</span>
        </div>
      ))}
    </div>
  );
}
