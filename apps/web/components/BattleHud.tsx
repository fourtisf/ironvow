'use client';

import { HERO_NAME, TROOP, TROOP_ORDER } from '@ironvow/config';
import type { BattleArmy, DeployableType } from '@ironvow/types';
import { mmss } from '../lib/format';
import { StarIcon } from './icons';
import { TroopArt } from './TroopArt';

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
  selected: DeployableType | null;
  /** The hero can still be committed. */
  heroReady: boolean;
  /** Shown greyed when the hero was already sent in or is recovering. */
  heroLevel: number;
  /**
   * The War Lab levels the raid was frozen with, so the tray shows the same
   * kit that will walk onto the field.
   */
  troopLevels: Partial<Record<DeployableType, number>>;
  onSelect: (type: DeployableType) => void;
  onEnd: () => void;
}

export function BattleHud({
  secondsLeft, destroyedPct, stars, avail, selected, heroReady, heroLevel, troopLevels,
  onSelect, onEnd,
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
            {/* Picked by looking at them, not by reading a list: the tray
              * draws the troop, at the level it is actually fighting at. */}
            <TroopArt type={t} level={troopLevels[t] ?? 1} size={34} />
            <span className="nm" style={{ fontSize: 9 }}>{TROOP[t].n}</span>
            <span className="n">{avail[t] ?? 0}</span>
          </button>
        ))}

        {/* The hero sits apart from the warband, because it is not one of them. */}
        {(heroReady || selected === 'hero') && (
          <button
            className={`tcard hero${selected === 'hero' ? ' sel' : ''}${heroReady ? '' : ' out'}`}
            onClick={() => onSelect('hero')}
          >
            <TroopArt type="hero" level={heroLevel} size={34} />
            <span className="nm" style={{ fontSize: 9 }}>{HERO_NAME}</span>
            <span className="n">{heroReady ? `Lv ${heroLevel}` : '—'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
