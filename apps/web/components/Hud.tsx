'use client';

import { fmt } from '../lib/format';
import type { PlayerState } from '../lib/game/types';
import { ArmyIcon, BuildIcon, GoldIcon, HomeIcon, IronIcon, LogIcon, RaidIcon, TrophyIcon } from './icons';

/**
 * The resource bar, the Keep badge and the bottom rail.
 *
 * Every number shown here came from the server. Nothing on the client computes
 * a balance; the local production prediction only fills the collect bubbles.
 */

export interface HudProps {
  player: PlayerState;
  incomingCount: number;
  onHome: () => void;
  onBuild: () => void;
  onArmy: () => void;
  onLog: () => void;
  onRaid: () => void;
}

export function Hud({ player, incomingCount, onHome, onBuild, onArmy, onLog, onRaid }: HudProps) {
  return (
    <div id="hud">
      <div className="res" id="rGold">
        <span className="ic"><GoldIcon /></span>
        <span className="col">
          <span className="v">{fmt(player.gold)}</span>
          <span className="cap">GOLD</span>
        </span>
      </div>

      <div className="res" id="rIron">
        <span className="ic"><IronIcon /></span>
        <span className="col">
          <span className="v">{fmt(player.iron)}</span>
          <span className="cap">IRON</span>
        </span>
      </div>

      <div id="keepBadge">
        <div className="n">{player.keepLevel}</div>
        <div className="t">KEEP</div>
      </div>

      <div id="trophyBar">
        <span><TrophyIcon /></span>
        <span>{player.trophies}</span>
      </div>

      <button id="homeBtn" onClick={onHome} aria-label="Centre on the keep">
        <HomeIcon />
      </button>

      <div id="rail">
        <button className="rbtn" onClick={onBuild}><BuildIcon /><span>BUILD</span></button>
        <button className="rbtn" onClick={onArmy}><ArmyIcon /><span>ARMY</span></button>
        <button className="rbtn" onClick={onLog}>
          <LogIcon />
          <span>LOG</span>
          {incomingCount > 0 && <span className="dot" />}
        </button>
        <button className="rbtn red" onClick={onRaid}><RaidIcon /><span>RAID</span></button>
      </div>
    </div>
  );
}
