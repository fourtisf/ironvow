'use client';

import { TROOP, TROOP_ORDER, type TroopType } from '@ironvow/config';
import type { BattleArmy } from '@ironvow/types';
import { mmss } from '../lib/format';
import { StarIcon } from './icons';

/**
 * The raid HUD.
 *
 * The star count and the damage bar are read straight off the running
 * simulation, which is the same code the server will replay. What the player
 * watches here is what they will be paid for.
 */

export interface BattleHudProps {
  secondsLeft: number;
  destroyedPct: number;
  stars: number;
  avail: BattleArmy;
  selected: TroopType | null;
  onSelect: (type: TroopType) => void;
  onEnd: () => void;
}

export function BattleHud({
  secondsLeft, destroyedPct, stars, avail, selected, onSelect, onEnd,
}: BattleHudProps) {
  return (
    <div id="btHud">
      <div id="btTop">
        <div className="box">
          <div className="v">{mmss(secondsLeft)}</div>
          <div className="cap">TIME</div>
        </div>

        <div id="dmgWrap">
          <div id="starRow">
            {[0, 1, 2].map((i) => <StarIcon key={i} on={i < stars} />)}
          </div>
          <div id="dmgBarBg">
            <div id="dmgBar" style={{ width: `${(destroyedPct * 100).toFixed(1)}%` }} />
          </div>
        </div>

        <button className="box btn red" style={{ padding: '8px 12px' }} onClick={onEnd}>END</button>
      </div>

      <div id="btTray">
        {TROOP_ORDER.filter((t) => (avail[t] ?? 0) > 0 || selected === t).map((t) => (
          <button
            key={t}
            className={`tcard${selected === t ? ' sel' : ''}${(avail[t] ?? 0) <= 0 ? ' out' : ''}`}
            onClick={() => onSelect(t)}
          >
            <span className="nm" style={{ fontSize: 9 }}>{TROOP[t].n}</span>
            <span className="n">{avail[t] ?? 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
