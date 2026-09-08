'use client';

import { fmt } from '../lib/format';
import type { PlayerState } from '../lib/game/types';
import { ArmyIcon, BuilderIcon, BuildIcon, ClanIcon, GoldIcon, HomeIcon, IronIcon, LadderIcon, LogIcon, OrdersIcon, RaidIcon, RangeIcon, SoundIcon, TrophyIcon } from './icons';

/**
 * The resource bar, the Keep badge and the bottom rail.
 *
 * Every number shown here came from the server. Nothing on the client computes
 * a balance; the local production prediction only fills the collect bubbles.
 */

export interface HudProps {
  player: PlayerState;
  incomingCount: number;
  /** Any quest finished and waiting to be claimed. */
  ordersReady: boolean;
  /** Total sitting uncollected across every producer. */
  pending: number;
  onHome: () => void;
  onBuild: () => void;
  onArmy: () => void;
  onOrders: () => void;
  onLog: () => void;
  onClan: () => void;
  onLadder: () => void;
  onRaid: () => void;
  onCollectAll: () => void;
  onClaimAccount: () => void;
  onDismissGuestNote: () => void;
  soundOn: boolean;
  onToggleSound: () => void;
  /** Whether every defence is showing what it covers. */
  rangesOn: boolean;
  onToggleRanges: () => void;
  /** Hidden until the base has a defence to show the reach of. */
  hasDefences: boolean;
  /** Whether the guest nudge has earned its place on screen yet. */
  showGuestNote: boolean;
  /** Which button the guide is pointing at, if any. */
  highlight: string | null;
  onHelp: () => void;
}

export function Hud({
  player, incomingCount, ordersReady, pending, showGuestNote,
  onHome, onBuild, onArmy, onOrders, onLog, onClan, onLadder, onRaid, onCollectAll, onClaimAccount,
  onDismissGuestNote, soundOn, onToggleSound, rangesOn, onToggleRanges, hasDefences,
  highlight, onHelp,
}: HudProps) {
  const hi = (name: string): string => (highlight === name ? ' hi' : '');
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
        <div className="t">TOWN HALL</div>
      </div>

      {/* Tapping the trophy count opens the ladder: the number and the thing
          it means should be one tap apart. */}
      <button id="helpBtn" onClick={onHelp} aria-label="How to play">?</button>

      <button id="trophyBar" onClick={onLadder} aria-label="Open the leaderboard">
        <TrophyIcon />
        <span>{player.trophies}</span>
        <LadderIcon />
      </button>

      {/*
        What every defence covers, held on.
        
        A ring appears on its own while a defence is being placed or is
        selected, which answers "where does this one reach". This answers the
        other question — "is anything not covered" — and that one is about the
        whole base at once, so it is a switch rather than a selection. Hidden
        until there is a defence to show, because a button that does nothing is
        worse than no button.
      */}
      {hasDefences && (
        <button
          id="rangeBtn"
          className={rangesOn ? 'on' : ''}
          onClick={onToggleRanges}
          aria-label={rangesOn ? 'Hide what your defences cover' : 'Show what your defences cover'}
          aria-pressed={rangesOn}
        >
          <RangeIcon on={rangesOn} />
        </button>
      )}

      {/* Builders start at two and are hired up to ten, so this is a status
          line and the BUILD sheet is where the crew is bought. */}
      <div id="builderBar" className={player.buildersFree === 0 ? 'busy' : ''}>
        <BuilderIcon />
        <span>{player.buildersFree}/{player.buildersTotal}</span>
      </div>

      {/*
        Only once the player has something worth losing, and dismissible.
        Asking a stranger to secure an account thirty seconds in is nagging;
        asking after they have collected, raided or climbed is a favour.
      */}
      {showGuestNote && (
        <div id="guestNote">
          <span>Playing as a guest. Add an email so this base is still yours on your next phone.</span>
          <button className="btn gold" onClick={onClaimAccount}>SAVE IT</button>
          <button className="xbtn" onClick={onDismissGuestNote} aria-label="Dismiss">✕</button>
        </div>
      )}

      <button id="homeBtn" className={hi('home')} onClick={onHome} aria-label="Centre on the Town Hall">
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
        <button className={`rbtn${hi('build')}`} onClick={onBuild}><BuildIcon /><span>BUILD</span></button>
        <button className={`rbtn${hi('army')}`} onClick={onArmy}><ArmyIcon /><span>ARMY</span></button>
        <button className={`rbtn${hi('orders')}`} onClick={onOrders}>
          <OrdersIcon />
          <span>QUESTS</span>
          {ordersReady && <span className="dot" />}
        </button>
        <button className={`rbtn${hi('log')}`} onClick={onLog}>
          <LogIcon />
          <span>LOG</span>
          {incomingCount > 0 && <span className="dot" />}
        </button>
        <button className="rbtn" onClick={onClan}><ClanIcon /><span>CLAN</span></button>
        <button className={`rbtn red${hi('raid')}`} onClick={onRaid}><RaidIcon /><span>RAID</span></button>
      </div>
    </div>
  );
}
