'use client';

import { TYPES } from '@ironvow/config';
import type { BaseSnapshot } from '@ironvow/types';
import { fmt } from '../lib/format';
import { GoldIcon, IronIcon, StarIcon } from './icons';

/**
 * Scout and result modals.
 *
 * Scouting before a raid is spec S8.1 and the biggest gap in the prototype:
 * the player used to march blind at a loot figure. Here the defender's actual
 * layout is on the table, and rerolling costs gold that the server charges.
 */

export interface ScoutModalProps {
  snapshot: BaseSnapshot;
  rerollCost: number;
  canReroll: boolean;
  onAttack: () => void;
  onReroll: () => void;
  onCancel: () => void;
}

export function ScoutModal({ snapshot, rerollCost, canReroll, onAttack, onReroll, onCancel }: ScoutModalProps) {
  const counts = new Map<string, number>();
  for (const b of snapshot.buildings) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  const defences = (counts.get('cannon') ?? 0) + (counts.get('tower') ?? 0);

  // Deliberately a sheet rather than a centred modal: the base being scouted is
  // drawn on the canvas above it, and covering that up would defeat the point.
  return (
    <div className="sheet" id="scoutSheet">
      <div className="sheetHead">
        <div>
          <h2>{snapshot.defenderName.toUpperCase()}</h2>
          <p>
            Keep {snapshot.keepLevel} · {defences} defence{defences === 1 ? '' : 's'} ·{' '}
            {counts.get('wall') ?? 0} ramparts · drag to look around
          </p>
        </div>
        <button className="xbtn" onClick={onCancel}>✕</button>
      </div>

      <div className="lootRow">
        <div><GoldIcon />{fmt(snapshot.pool.g)}</div>
        <div><IronIcon />{fmt(snapshot.pool.i)}</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 10 }}>
        {[...counts.entries()]
          .filter(([type]) => type !== 'wall')
          .map(([type, n]) => (
            <span key={type} className="qrw">{n}× {TYPES[type as keyof typeof TYPES].n}</span>
          ))}
      </div>

      <p className="lead" style={{ marginBottom: 10 }}>
        Their Vaults hold back the rest. This layout is frozen — whatever they build
        from here changes nothing about the fight you walk into.
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn gold" style={{ flex: 1 }} onClick={onReroll} disabled={!canReroll}>
          NEXT · {rerollCost}
        </button>
        <button className="btn red" style={{ flex: 2 }} onClick={onAttack}>ATTACK</button>
      </div>
    </div>
  );
}

export interface ResultModalProps {
  stars: number;
  loot: { g: number; i: number };
  trophyDelta: number;
  onClose: () => void;
}

export function ResultModal({ stars, loot, trophyDelta, onClose }: ResultModalProps) {
  const won = stars >= 1;
  return (
    <div className="ovl">
      <div className="modal">
        <h2>{won ? 'HOLD TAKEN' : 'DRIVEN OFF'}</h2>

        <div id="resStars">
          {[0, 1, 2].map((i) => <StarIcon key={i} on={i < stars} />)}
        </div>

        <div className="lootRow">
          <div><GoldIcon />+{fmt(loot.g)}</div>
          <div><IronIcon />+{fmt(loot.i)}</div>
        </div>

        <p className="lead">
          {trophyDelta >= 0 ? '+' : ''}{trophyDelta} trophies.{' '}
          {won
            ? 'Their Vaults kept back what you could not reach.'
            : 'Troops spent are gone either way — muster again before the next one.'}
        </p>

        <button className="btn big" onClick={onClose}>BACK TO THE HOLD</button>
      </div>
    </div>
  );
}

export interface SignInModalProps {
  onRequest: (email: string) => void;
  sent: boolean;
  busy: boolean;
  error: string | null;
}

export function SignInModal({ onRequest, sent, busy, error }: SignInModalProps) {
  return (
    <div className="ovl">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          const input = (e.currentTarget.elements.namedItem('email') as HTMLInputElement | null);
          if (input?.value) onRequest(input.value);
        }}
      >
        <h2>IRONVOW</h2>
        <p className="lead">Forge. Muster. Conquer.<br />Your hold lives on the server, so it keeps earning while you are away.</p>

        {sent ? (
          <p className="lead">Check your email for a link. It is good for fifteen minutes.</p>
        ) : (
          <>
            <input
              name="email"
              type="email"
              required
              placeholder="you@example.com"
              style={{
                width: '100%', padding: 12, borderRadius: 12, border: '2px solid #46608a',
                background: '#141d2b', color: '#f2e4c4', fontFamily: 'Arial', fontWeight: 700,
                fontSize: 13, marginBottom: 4,
              }}
            />
            <button className="btn gold big" type="submit" disabled={busy}>
              {busy ? 'SENDING…' : 'SEND LINK'}
            </button>
          </>
        )}

        {error && <p className="lead" style={{ color: '#ff7a63', marginTop: 10 }}>{error}</p>}
      </form>
    </div>
  );
}
