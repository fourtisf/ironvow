'use client';

import { KEEP_MAX, TYPES, campSlots, buildSeconds, costOf, countOf, finishNowCost, hpOf, DEF_STAT, PROD } from '@ironvow/config';
import { useEffect, useState } from 'react';
import { fmt, until } from '../lib/format';
import type { ClientBuilding, PlayerState } from '../lib/game/types';
import { GoldIcon, IronIcon } from './icons';

/**
 * The selected-building panel.
 *
 * MOVE and UPGRADE are the only two actions, and both send intent: an id, or an
 * id plus a target cell. The cost displayed is derived locally for the player's
 * benefit and re-derived by the server before a single coin moves.
 */

export interface InspectorProps {
  player: PlayerState;
  building: ClientBuilding;
  onClose: () => void;
  onUpgrade: () => void;
  onMove: () => void;
  onCollect: () => void;
  onFinish: () => void;
  onDemolish: () => void;
  onCancel: () => void;
  /** The clock on a job reached zero while the panel was open. */
  onElapsed: () => void;
}

export function Inspector({
  player, building, onClose, onUpgrade, onMove, onCollect, onFinish, onDemolish, onCancel, onElapsed,
}: InspectorProps) {
  // A clock that ticks: the countdown below used to move only when the
  // server was polled, every thirty seconds, and read as stuck.
  const [now, setNow] = useState(() => Date.now());
  const busyJob = building.completesAt !== null;
  useEffect(() => {
    if (!busyJob) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [busyJob]);
  const endsAt = building.completesAt ? new Date(building.completesAt).getTime() : 0;
  useEffect(() => {
    if (busyJob && endsAt <= now) onElapsed();
  }, [busyJob, endsAt, now, onElapsed]);
  const def = TYPES[building.type];
  const owned = player.buildings.map((b) => ({ type: b.type, level: b.level }));
  const isKeep = building.type === 'keep';

  const atCap = isKeep ? building.level >= KEEP_MAX : building.level >= player.keepLevel;
  const ownedCount = countOf(owned, building.type);
  const cost = costOf(building.type, building.level, ownedCount);
  const affordable = player.gold >= cost.g && player.iron >= cost.i;
  const seconds = buildSeconds(building.type, building.level, ownedCount);

  /* --- a builder is on it --- */
  const busy = building.completesAt !== null;
  const remaining = busy ? Math.max(0, (endsAt - now) / 1000) : 0;
  const rushCost = finishNowCost(remaining);
  const scaffold = busy && building.upgradingTo === null;
  const noBuilder = !busy && seconds > 0 && player.buildersFree === 0;

  if (busy) {
    // The bar's length comes from the job's own timer, re-derived here rather
    // than sent by the server: the same function the server used to set it.
    const total = scaffold
      ? buildSeconds(building.type, 1, Math.max(0, ownedCount - 1))
      : buildSeconds(building.type, building.level, ownedCount);
    const done = total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 1;
    return (
      <div id="insp">
        <div className="info">
          <h3>{def.n} · {scaffold ? 'GOING UP' : `TO LEVEL ${building.upgradingTo}`}</h3>
          <p>
            {remaining > 0 ? <>Ready in <b className="tick">{until(building.completesAt!, now)}</b></> : 'Done — the builder is packing up.'}
            <br />
            {scaffold
              ? 'It earns nothing and fires nothing until it is finished.'
              : 'Still working at its current level while the builder is on it.'}
          </p>
          <div className="qbarBg" style={{ marginTop: 7 }}>
            <div className="qbar" style={{ width: `${(done * 100).toFixed(1)}%`, transition: 'width .5s linear' }} />
          </div>
        </div>
        <div className="acts">
          <button
            className={`btn gold${player.gold >= rushCost ? '' : ' grey'}`}
            onClick={onFinish}
            disabled={player.gold < rushCost}
            title="Pay gold to finish now"
          >
            FINISH NOW <GoldIcon />{fmt(rushCost)}
          </button>
          {/* Nothing has been consumed yet, so stopping costs nothing. */}
          <button className="btn red" onClick={onCancel}>CANCEL</button>
          <button className="btn grey" onClick={onClose}>CLOSE</button>
        </div>
      </div>
    );
  }

  const rate = PROD[building.type];
  const defence = DEF_STAT[building.type];
  const stock = Math.floor(building.stock);

  const detail = rate
    ? `${rate(building.level)}/min · holding ${fmt(stock)}`
    : defence
      // A Mortar's dead zone belongs on the same line as its reach: "range 9.2"
      // on its own is the half of the story that flatters it.
      ? `${Math.round(defence(building.level).dmg)}${defence(building.level).splash ? ' splash' : ''} damage · range ${defence(building.level).min ? `${defence(building.level).min}–` : ''}${defence(building.level).rng}`
      : building.type === 'camp'
        ? `${campSlots(building.level)} warband slots`
        : building.type === 'store'
          ? `+${fmt(1400 + building.level * 1500)} storage`
          : def.blurb;

  return (
    <div id="insp">
      <div className="info">
        <h3>{def.n} · LEVEL {building.level}</h3>
        <p>
          {detail}
          <br />
          {fmt(hpOf(building.type, building.level))} hit points
          {!atCap && seconds > 0 && ` · next takes ${Math.round(seconds / 60) >= 1 ? `${Math.round(seconds / 60)}m` : `${seconds}s`}`}
          <br />Drag it on the field to move it.
        </p>
      </div>

      <div className="acts">
        {rate && stock >= 1 && (
          <button className="btn gold" onClick={onCollect}>COLLECT</button>
        )}
        <button
          className={`btn${affordable && !atCap && !noBuilder ? '' : ' grey'}`}
          onClick={onUpgrade}
          disabled={atCap || !affordable || noBuilder}
        >
          {atCap
            ? (isKeep ? 'MAX' : 'KEEP CAP')
            : noBuilder
              ? 'NO BUILDER'
              : <>UPGRADE {cost.g > 0 && <><GoldIcon />{fmt(cost.g)}</>}{cost.i > 0 && <><IronIcon />{fmt(cost.i)}</>}</>}
        </button>
        <button className="btn grey" onClick={onMove}>MOVE</button>
        {/*
          Without this a misplaced building is permanent, and because count
          limits are per Keep level, a wrong choice spends that slot for good.
        */}
        {!isKeep && <button className="btn red" onClick={onDemolish}>DEMOLISH</button>}
        <button className="btn grey" onClick={onClose}>CLOSE</button>
      </div>
    </div>
  );
}

export interface PlaceBarProps {
  typeName: string;
  moving: boolean;
  ok: boolean;
  /**
   * The tool re-armed itself after laying one, so the ghost is standing on the
   * building that was just built. Nothing is wrong; the player simply has not
   * said where the next one goes yet.
   */
  again: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function PlaceBar({ typeName, moving, ok, again, onCancel, onConfirm }: PlaceBarProps) {
  return (
    <div id="placeBar">
      <div className="t">
        {moving ? 'Moving ' : ''}{typeName}
        <em>
          {ok
            ? `Tap the ground to ${moving ? 'move it there' : 'build it there'}, or drag it about first.`
            : again
              ? 'Tap where the next one goes.'
              : 'Blocked — pick another spot.'}
        </em>
      </div>
      <button className="btn grey" onClick={onCancel}>CANCEL</button>
      <button className={`btn${ok ? '' : ' grey'}`} onClick={onConfirm} disabled={!ok}>
        {moving ? 'DONE' : 'PLACE'}
      </button>
    </div>
  );
}
