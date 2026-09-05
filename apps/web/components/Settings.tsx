'use client';

/**
 * Settings.
 *
 * Music and effects get sliders rather than switches, because the honest answer
 * for most people is neither on nor off — a game they play on a bus wants the
 * music quiet, not gone. Quality is a switch: there is no meaningful middle
 * between drawing the trees and not.
 */

export type Quality = 'high' | 'low';

export interface SettingsSheetProps {
  music: number;
  sfx: number;
  quality: Quality;
  isGuest: boolean;
  playerName: string;
  onMusic: (value: number) => void;
  onSfx: (value: number) => void;
  onQuality: (value: Quality) => void;
  onClaimAccount: () => void;
  onLogout: () => void;
  onClose: () => void;
}

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
  music, sfx, quality, isGuest, playerName,
  onMusic, onSfx, onQuality, onClaimAccount, onLogout, onClose,
}: SettingsSheetProps) {
  return (
    <div className="sheet">
      <div className="sheetHead">
        <div>
          <h2>SETTINGS</h2>
          <p>Playing as {playerName}</p>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>

      <Slider label="MUSIC" hint="generated as you play, no download" value={music} onChange={onMusic} />
      <Slider label="EFFECTS" hint="coins, blows, collapses" value={sfx} onChange={onSfx} />

      <div className="setRow">
        <div className="setLabel">
          <h4>GRAPHICS</h4>
          <p>
            {quality === 'high'
              ? 'Full — trees, smoke and banners'
              : 'Reduced — fewer moving parts, longer battery'}
          </p>
        </div>
        <button
          className={`btn${quality === 'high' ? '' : ' grey'}`}
          onClick={() => onQuality(quality === 'high' ? 'low' : 'high')}
        >
          {quality === 'high' ? 'FULL' : 'LOW'}
        </button>
      </div>

      {isGuest && (
        <div className="qrow" style={{ marginTop: 12 }}>
          <div className="qi">
            <h4>Guest hold</h4>
            <p>Add an email and this hold follows you to any device.</p>
          </div>
          <button className="btn gold" onClick={onClaimAccount}>SAVE IT</button>
        </div>
      )}

      <div className="qrow" style={{ marginTop: 12 }}>
        <div className="qi">
          <h4>Sign out</h4>
          <p>
            {isGuest
              ? 'Careful — a guest hold with no email cannot be signed back into.'
              : 'You can sign back in with an emailed link.'}
          </p>
        </div>
        <button className="btn red" onClick={onLogout}>SIGN OUT</button>
      </div>
    </div>
  );
}
