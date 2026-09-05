'use client';

import { KEEP_MAX, TYPES, costOf, countOf, hpOf, DEF_STAT, PROD } from '@ironvow/config';
import { fmt } from '../lib/format';
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
}

export function Inspector({ player, building, onClose, onUpgrade, onMove, onCollect }: InspectorProps) {
  const def = TYPES[building.type];
  const owned = player.buildings.map((b) => ({ type: b.type, level: b.level }));
  const isKeep = building.type === 'keep';

  const atCap = isKeep ? building.level >= KEEP_MAX : building.level >= player.keepLevel;
  const cost = costOf(building.type, building.level, countOf(owned, building.type));
  const affordable = player.gold >= cost.g && player.iron >= cost.i;

  const rate = PROD[building.type];
  const defence = DEF_STAT[building.type];
  const stock = Math.floor(building.stock);

  const detail = rate
    ? `${rate(building.level)}/min · holding ${fmt(stock)}`
    : defence
      ? `${Math.round(defence(building.level).dmg)} damage · range ${defence(building.level).rng}`
      : building.type === 'barr'
        ? `${8 + building.level * 6} warband slots`
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
        </p>
      </div>

      <div className="acts">
        {rate && stock >= 1 && (
          <button className="btn gold" onClick={onCollect}>COLLECT</button>
        )}
        <button
          className={`btn${affordable && !atCap ? '' : ' grey'}`}
          onClick={onUpgrade}
          disabled={atCap || !affordable}
        >
          {atCap
            ? (isKeep ? 'MAX' : 'KEEP CAP')
            : <>UPGRADE {cost.g > 0 && <><GoldIcon />{fmt(cost.g)}</>}{cost.i > 0 && <><IronIcon />{fmt(cost.i)}</>}</>}
        </button>
        {!isKeep && <button className="btn grey" onClick={onMove}>MOVE</button>}
        <button className="btn grey" onClick={onClose}>CLOSE</button>
      </div>
    </div>
  );
}

export interface PlaceBarProps {
  typeName: string;
  moving: boolean;
  ok: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function PlaceBar({ typeName, moving, ok, onCancel, onConfirm }: PlaceBarProps) {
  return (
    <div id="placeBar">
      <div className="t">
        {moving ? 'Moving ' : ''}{typeName}
        <em>{ok ? 'Drag it, or tap the ground to jump it there.' : 'Blocked — pick another spot.'}</em>
      </div>
      <button className="btn grey" onClick={onCancel}>CANCEL</button>
      <button className={`btn${ok ? '' : ' grey'}`} onClick={onConfirm} disabled={!ok}>
        {moving ? 'DONE' : 'PLACE'}
      </button>
    </div>
  );
}
