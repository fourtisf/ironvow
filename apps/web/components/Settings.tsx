'use client';

/**
 * Settings.
 *
 * Music and effects get sliders rather than switches, because the honest answer
 * for most people is neither on nor off — a game they play on a bus wants the
 * music quiet, not gone.
 * between drawing the trees and not.
 */

export type PushState = 'unsupported' | 'unavailable' | 'denied' | 'off' | 'on';

export interface LayoutSlot {
  slot: 'defence' | 'farming' | 'war' | 'push';
  name: string;
  saved: boolean;
  buildings: number;
}

export interface SettingsSheetProps {
  music: number;
  sfx: number;
  isGuest: boolean;
  playerName: string;
  /** This player's own invitation code, or null until `/invite` answers. */
  invite: { code: string; invited: number; paid: number } | null;
  push: PushState;
  layouts: LayoutSlot[];
  busy: boolean;
  onMusic: (value: number) => void;
  onSfx: (value: number) => void;
  onPush: (on: boolean) => void;
  onTestPush: () => void;
  onSaveLayout: (slot: string) => void;
  onApplyLayout: (slot: string) => void;
  onRename: () => void;
  onClaimAccount: () => void;
  onLogout: () => void;
  onDeleteAccount: () => void;
  onHelp: () => void;
  onReport: () => void;
  onClose: () => void;
}

const PUSH_COPY: Record<PushState, string> = {
  unsupported: 'This browser cannot show notifications.',
  unavailable: 'Not configured on this server.',
  denied: 'Blocked in your browser settings — you would need to allow it there first.',
  off: 'Off — you will not hear about finished builds or raids.',
  on: 'On — finished builds and attacks on your base.',
};

function Slider({
  label, hint, value, onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="setRow">
      <div className="setLabel">
        <h4>{label}</h4>
        <p>{value === 0 ? 'Off' : `${Math.round(value * 100)}%`} · {hint}</p>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.currentTarget.value) / 100)}
        aria-label={label}
      />
    </div>
  );
}

export function SettingsSheet({
  music, sfx, isGuest, playerName, invite, push, layouts, busy,
  onMusic, onSfx, onPush, onTestPush, onSaveLayout, onApplyLayout,
  onRename, onClaimAccount, onLogout, onDeleteAccount, onHelp, onReport, onClose,
}: SettingsSheetProps) {
  const canPush = push !== 'unsupported' && push !== 'unavailable' && push !== 'denied';
  return (
    <div className="sheet">
      <div className="sheetHead">
        <div>
          <h2>SETTINGS</h2>
          <p>Playing as {playerName}</p>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>

      {/*
        * The invitation, at the top of the sheet rather than buried under the
        * sliders. It is the one thing here a player might act on for somebody
        * else's benefit, and a code nobody can find is a code nobody hands out.
        */}
      {invite && (
        <div className="setRow">
          <div className="setLabel">
            <h4>YOUR INVITE CODE</h4>
            <p>
              {invite.invited === 0
                ? 'Anyone who enters this instead of the access code gets in — and you are paid when their Town Hall reaches 3.'
                : `${invite.invited} joined with it · ${invite.paid} reached Town Hall 3 and paid out`}
            </p>
          </div>
          <button
            className="btn gold"
            onClick={() => {
              // Clipboard is refused in some contexts and there is nothing
              // useful to say about it; the code is on screen either way.
              void navigator.clipboard?.writeText(invite.code).catch(() => undefined);
            }}
            style={{ letterSpacing: 2 }}
          >
            {invite.code}
          </button>
        </div>
      )}

      <Slider label="MUSIC" hint="generated as you play, no download" value={music} onChange={onMusic} />
      <Slider label="EFFECTS" hint="coins, blows, collapses" value={sfx} onChange={onSfx} />

      <div className="setRow">
        <div className="setLabel">
          <h4>NOTIFICATIONS</h4>
          <p>{PUSH_COPY[push]}</p>
        </div>
        {canPush ? (
          <button
            className={`btn${push === 'on' ? '' : ' grey'}`}
            disabled={busy}
            onClick={() => onPush(push !== 'on')}
          >
            {push === 'on' ? 'ON' : 'OFF'}
          </button>
        ) : (
          <span className="qrw">—</span>
        )}
      </div>

      {push === 'on' && (
        <div className="setRow">
          <div className="setLabel">
            <h4>TEST IT</h4>
            <p>Send one to this device, so you know it works before relying on it.</p>
          </div>
          <button className="btn grey" onClick={onTestPush} disabled={busy}>SEND</button>
        </div>
      )}

      {/*
        Saved layouts (S8.7). Four of them now, because the game grew four
        things worth laying out for: defence rings the Town Hall and the Storages,
        farming pushes the mines out where they are cheap to give away, a war
        base is scored on stars alone since no loot moves in a war, and a push
        base is the one that loses the fewest trophies over a season.
      */}
      <div className="sheetHead" style={{ marginTop: 14 }}>
        <div>
          <h2>LAYOUTS</h2>
          <p>Four arrangements you can switch between</p>
        </div>
      </div>

      {layouts.map((l) => (
        <div className="qrow" key={l.slot}>
          <div className="qi">
            <h4>{l.name}</h4>
            <p>
              {l.saved
                ? `${l.buildings} buildings saved — anything demolished since is skipped`
                : 'Nothing saved yet'}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 'none' }}>
            <button className="btn grey" disabled={busy} onClick={() => onSaveLayout(l.slot)}>SAVE</button>
            {l.saved && (
              <button className="btn" disabled={busy} onClick={() => onApplyLayout(l.slot)}>APPLY</button>
            )}
          </div>
        </div>
      ))}

      <div className="qrow" style={{ marginTop: 12 }}>
        <div className="qi">
          <h4>Name</h4>
          <p>Shown on the leaderboard and to anyone who attacks you.</p>
        </div>
        <button className="btn grey" onClick={onRename}>CHANGE</button>
      </div>

      {isGuest && (
        <div className="qrow" style={{ marginTop: 12 }}>
          <div className="qi">
            <h4>Guest base</h4>
            <p>Add an email and this base follows you to any device.</p>
          </div>
          <button className="btn gold" onClick={onClaimAccount}>SAVE IT</button>
        </div>
      )}

      <div className="setRow">
        <div className="setLabel">
          <h4>HOW TO PLAY</h4>
          <p>The rules, and the tutorial again if you want it.</p>
        </div>
        <button className="btn grey" onClick={onHelp}>OPEN</button>
      </div>

      <div className="setRow">
        <div className="setLabel">
          <h4>REPORT A PROBLEM</h4>
          <p>Something broken or wrong? Tell whoever runs this server.</p>
        </div>
        <button className="btn grey" onClick={onReport}>WRITE</button>
      </div>

      <div className="qrow" style={{ marginTop: 12 }}>
        <div className="qi">
          <h4>Sign out</h4>
          <p>
            {isGuest
              ? 'Careful — a guest base with no email cannot be signed back into.'
              : 'You can sign back in with an emailed link.'}
          </p>
        </div>
        <button className="btn red" onClick={onLogout}>SIGN OUT</button>
      </div>

      {/* The one button in the game with no undo, so it asks twice. */}
      <div className="qrow" style={{ marginTop: 12, borderColor: '#7a3c33' }}>
        <div className="qi">
          <h4>Delete this base</h4>
          <p>
            Everything goes — buildings, troops, trophies, raid history. There is
            no way back.
          </p>
        </div>
        <button className="btn red" onClick={onDeleteAccount}>DELETE</button>
      </div>
    </div>
  );
}
