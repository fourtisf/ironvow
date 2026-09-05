'use client';

import {
  TROOP,
  TROOP_ORDER,
  TROOP_UNLOCK,
  TYPES,
  bestBarracksLevel,
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

const BUILDABLE: BuildingType[] = ['mine', 'forge', 'store', 'barr', 'cannon', 'tower', 'wall'];

export interface BuildSheetProps {
  player: PlayerState;
  onClose: () => void;
  onPick: (type: BuildingType) => void;
}

export function BuildSheet({ player, onClose, onPick }: BuildSheetProps) {
  const owned = player.buildings.map((b) => ({ type: b.type, level: b.level }));

  return (
    <div className="sheet">
      <div className="sheetHead">
        <div>
          <h2>BUILD</h2>
          <p>Everything is capped by your Keep&rsquo;s level</p>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>

      <div className="grid">
        {BUILDABLE.map((type) => {
          const have = countOf(owned, type);
          const limit = capOf(type, player.keepLevel);
          const cost = costOf(type, 0, have);
          const affordable = player.gold >= cost.g && player.iron >= cost.i;
          const locked = have >= limit;

          return (
            <button
              key={type}
              className={`card${locked ? ' locked' : ''}${affordable ? '' : ' poor'}`}
              onClick={() => !locked && onPick(type)}
              disabled={locked}
            >
              <span className="cnt">{have}/{limit}</span>
              <div className="nm">{TYPES[type].n}</div>
              <CostLine cost={cost} affordable={affordable} />
              <div className="sub">{locked ? 'RAISE KEEP' : `${TYPES[type].s}×${TYPES[type].s}`}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface ProgressionView {
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
}

export function ArmySheet({
  player, progression, onClose, onTrain, onUpgradeHero, onUpgradeTroop,
}: ArmySheetProps) {
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
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>

      <div className="grid">
        {TROOP_ORDER.map((type) => {
          const def = TROOP[type];
          const locked = barracks < TROOP_UNLOCK[type];
          const affordable = player.gold >= def.cost.g && player.iron >= def.cost.i;
          const room = player.armyUsed + def.sp <= player.armyCap;

          return (
            <button
              key={type}
              className={`card${locked ? ' locked' : ''}${affordable ? '' : ' poor'}`}
              onClick={() => !locked && room && onTrain(type, 1)}
              disabled={locked || !room}
            >
              <span className="cnt">{player.army[type] ?? 0}</span>
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

      {lab && lab.level === 0 && (
        <div className="qrow" style={{ marginTop: 12 }}>
          <div className="qi">
            <h4>No War Lab</h4>
            <p>Build one to make your troops stronger, not just more numerous.</p>
          </div>
        </div>
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
  }[];
  onClose: () => void;
  onReplay: (raidId: string) => void;
}

export function LogSheet({ raids, onClose, onReplay }: LogSheetProps) {
  return (
    <div className="sheet">
      <div className="sheetHead">
        <div>
          <h2>ATTACK LOG</h2>
          <p>Every raid against you can be watched back exactly as it happened</p>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
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
          {r.replayable
            ? <button className="btn grey" onClick={() => onReplay(r.raidId)}>WATCH</button>
            : <span className="qrw">—</span>}
        </div>
      ))}
    </div>
  );
}
