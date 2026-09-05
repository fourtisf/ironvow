'use client';

import { fmt } from '../lib/format';
import type { PlayerState } from '../lib/game/types';
import { ArmyIcon, BuildIcon, GoldIcon, HomeIcon, IronIcon, LogIcon, OrdersIcon, RaidIcon, SoundIcon, TrophyIcon } from './icons';

/**
 * The resource bar, the Keep badge and the bottom rail.
 *
 * Every number shown here came from the server. Nothing on the client computes
 * a balance; the local production prediction only fills the collect bubbles.
 */

export interface HudProps {
  player: PlayerState;
  incomingCount: number;
  /** Any War Order finished and waiting to be claimed. */
  ordersReady: boolean;
  /** Total sitting uncollected across every producer. */
  pending: number;
  onHome: () => void;
  onBuild: () => void;
  onArmy: () => void;
  onOrders: () => void;
  onLog: () => void;
  onRaid: () => void;
  onCollectAll: () => void;
  onClaimAccount: () => void;
  onDismissGuestNote: () => void;
  soundOn: boolean;
  onToggleSound: () => void;
  /** Whether the guest nudge has earned its place on screen yet. */
  showGuestNote: boolean;
}

export function Hud({
  player, incomingCount, ordersReady, pending, showGuestNote,
  onHome, onBuild, onArmy, onOrders, onLog, onRaid, onCollectAll, onClaimAccount,
  onDismissGuestNote, soundOn, onToggleSound,
}: HudProps) {
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

      {/*
        Only once the player has something worth losing, and dismissible.
        Asking a stranger to secure an account thirty seconds in is nagging;
        asking after they have collected, raided or climbed is a favour.
      */}
      {showGuestNote && (
        <div id="guestNote">
          <span>Playing as a guest. Add an email so this hold is still yours on your next phone.</span>
          <button className="btn gold" onClick={onClaimAccount}>SAVE IT</button>
          <button className="xbtn" onClick={onDismissGuestNote} aria-label="Dismiss">✕</button>
        </div>
      )}

      <button id="homeBtn" onClick={onHome} aria-label="Centre on the keep">
        <HomeIcon />
      </button>

      <button
        id="soundBtn"
        onClick={onToggleSound}
        aria-label={soundOn ? 'Turn sound off' : 'Turn sound on'}
        aria-pressed={soundOn}
      >
        <SoundIcon on={soundOn} />
      </button>

      {/* Tapping twelve pouches one at a time is a chore, not a decision. */}
      {pending >= 1 && (
        <button id="collectAll" onClick={onCollectAll}>
          <GoldIcon />
          COLLECT {fmt(pending)}
        </button>
      )}

      <div id="rail">
        <button className="rbtn" onClick={onBuild}><BuildIcon /><span>BUILD</span></button>
        <button className="rbtn" onClick={onArmy}><ArmyIcon /><span>ARMY</span></button>
        <button className="rbtn" onClick={onOrders}>
          <OrdersIcon />
          <span>ORDERS</span>
          {ordersReady && <span className="dot" />}
        </button>
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
