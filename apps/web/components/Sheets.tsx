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

export interface ArmySheetProps {
  player: PlayerState;
  onClose: () => void;
  onTrain: (type: TroopType, count: number) => void;
}

export function ArmySheet({ player, onClose, onTrain }: ArmySheetProps) {
  const owned = player.buildings.map((b) => ({ type: b.type, level: b.level }));
  const barracks = bestBarracksLevel(owned);
  const now = Date.now();

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
