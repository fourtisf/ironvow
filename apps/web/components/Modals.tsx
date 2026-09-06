'use client';

import { TYPES } from '@ironvow/config';
import { useEffect, useState } from 'react';
import type { BaseSnapshot } from '@ironvow/types';
import { fmt } from '../lib/format';
import { GoldIcon, IronIcon, StarIcon, TelegramIcon, XIcon } from './icons';
import { CONTRACT, TELEGRAM_URL, X_URL, builtAtLabel, shortAddress } from '../lib/links';

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
  /** False for a generated garrison. */
  isPlayer: boolean;
  /** A clan war attack: no loot, no reroll, scored for the clan. */
  war?: boolean;
  onAttack: () => void;
  onReroll: () => void;
  onCancel: () => void;
}

export function ScoutModal({
  snapshot, rerollCost, canReroll, isPlayer, war = false, onAttack, onReroll, onCancel,
}: ScoutModalProps) {
  const counts = new Map<string, number>();
  for (const b of snapshot.buildings) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  const defences = (counts.get('cannon') ?? 0) + (counts.get('tower') ?? 0);
  const vaults = counts.get('store') ?? 0;

  // Deliberately a sheet rather than a centred modal: the base being scouted is
  // drawn on the canvas above it, and covering that up would defeat the point.
  return (
    <div className="sheet" id="scoutSheet">
      <div className="sheetHead">
        <div>
          <h2>{snapshot.defenderName.toUpperCase()}</h2>
          <p>
            {war ? 'War base' : isPlayer ? 'Player' : 'Garrison'} · Keep {snapshot.keepLevel} ·{' '}
            {defences} defence{defences === 1 ? '' : 's'} ·{' '}
            {counts.get('wall') ?? 0} ramparts · drag to look around
          </p>
        </div>
        <button className="xbtn" onClick={onCancel}>✕</button>
      </div>

      {!war && (
        <div className="lootRow">
          <div><GoldIcon />{fmt(snapshot.pool.g)}</div>
          <div><IronIcon />{fmt(snapshot.pool.i)}</div>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 10 }}>
        {[...counts.entries()]
          .filter(([type]) => type !== 'wall')
          .map(([type, n]) => (
            <span key={type} className="qrw">{n}× {TYPES[type as keyof typeof TYPES].n}</span>
          ))}
      </div>

      <p className="lead" style={{ marginBottom: 10 }}>
        {war
          ? 'A war attack. Stars count for the clan and only the best result against this base stands. No loot, no trophies — the reward comes when the war ends. This attack is spent when you finish, so bring everything.'
          : !isPlayer
          ? 'An abandoned garrison. Nobody loses what you take, and nobody is coming to answer it.'
          : vaults > 0
            ? 'Their Vaults hold back the rest. This layout is frozen — whatever they build from here changes nothing about the fight you walk into.'
            : 'They have no Vault, so everything they hold is on the table. This layout is frozen — whatever they build from here changes nothing.'}
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        {!war && (
          <button className="btn gold" style={{ flex: 1 }} onClick={onReroll} disabled={!canReroll}>
            NEXT · {rerollCost}
          </button>
        )}
        <button className="btn red" style={{ flex: 2 }} onClick={onAttack}>{war ? 'ATTACK FOR THE CLAN' : 'ATTACK'}</button>
      </div>
    </div>
  );
}

export interface ResultModalProps {
  stars: number;
  loot: { g: number; i: number };
  trophyDelta: number;
  /** A war attack: the stars went to the clan. */
  war?: boolean;
  onStar: (index: number) => void;
  onClose: () => void;
}

/**
 * The result screen.
 *
 * Stars land one at a time with a sound each, and the loot counts up rather
 * than appearing. Winning three stars and being shown a static number is the
 * difference between a game that feels good and one that merely works.
 */
export function ResultModal({ stars, loot, trophyDelta, war = false, onStar, onClose }: ResultModalProps) {
  const won = stars >= 1;
  const [shown, setShown] = useState(0);
  const [counted, setCounted] = useState({ g: 0, i: 0 });

  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reduced || stars === 0) {
      setShown(stars);
      return;
    }
    const timers = Array.from({ length: stars }, (_, i) =>
      setTimeout(() => {
        setShown(i + 1);
        onStar(i);
      }, 260 + i * 340));
    return () => timers.forEach(clearTimeout);
  }, [stars, reduced, onStar]);

  useEffect(() => {
    if (reduced) {
      setCounted(loot);
      return;
    }
    const started = performance.now();
    const duration = 700;
    let raf = 0;
    const tick = (now: number): void => {
      const p = Math.min(1, (now - started) / duration);
      // Ease out, so the number decelerates into its final value.
      const eased = 1 - (1 - p) * (1 - p);
      setCounted({ g: Math.round(loot.g * eased), i: Math.round(loot.i * eased) });
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loot, reduced]);

  return (
    <div className="ovl">
      <div className="modal">
        <h2>{war ? (won ? 'STARS FOR THE CLAN' : 'NOTHING FOR THE CLAN') : won ? 'HOLD TAKEN' : 'DRIVEN OFF'}</h2>

        <div id="resStars">
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ animationDelay: `${i * 0.34}s` }}>
              <StarIcon on={i < shown} />
            </span>
          ))}
        </div>

        {!war && (
          <div className="lootRow">
            <div><GoldIcon />+{fmt(counted.g)}</div>
            <div><IronIcon />+{fmt(counted.i)}</div>
          </div>
        )}

        <p className="lead">
          {war
            ? (won
              ? 'Only the best result against that base counts, and this one stands until somebody beats it. The reward comes when the war ends.'
              : 'The attack is spent. If a clanmate does better against that base, their result stands instead.')
            : <>
              {trophyDelta >= 0 ? '+' : ''}{trophyDelta} trophies.{' '}
              {won
                ? 'Their Vaults kept back what you could not reach.'
                : 'Troops spent are gone either way — muster again before the next one.'}
            </>}
        </p>

        <button className="btn big" onClick={onClose}>BACK TO THE HOLD</button>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: 12, borderRadius: 12, border: '2px solid #46608a',
  background: '#141d2b', color: '#f2e4c4', fontFamily: 'Arial', fontWeight: 700,
  fontSize: 13, marginBottom: 4,
} as const;

/**
 * The logo, drawn as shapes rather than set in a font, so the first screen
 * shows the same mark as the icon on the home screen and the card a shared link
 * unfurls into.
 */
function Wordmark() {
  return <img className="wordmark" src="/wordmark.svg" alt="IRONVOW" width={646} height={162} />;
}

/**
 * The line under the door.
 *
 * Where to find the project, and the contract address once there is one.
 * A link with no address configured is not drawn at all rather than pointing
 * somewhere wrong, and the chip says COMING SOON until `NEXT_PUBLIC_CONTRACT`
 * is set — at which point it shortens the address and copies it on a tap,
 * because nobody types one of those by hand.
 */
function DoorFooter() {
  const [copied, setCopied] = useState(false);

  /*
   * A button with no address configured is still drawn — dimmed and saying
   * SOON, like the contract chip beside it. Hiding it left the card looking
   * unfinished and, worse, looking like the deploy had not landed; a place
   * marked "soon" says more than an empty row. It becomes a real link the
   * moment `X_URL` or `TELEGRAM_URL` is set.
   */
  const social = (url: string, label: string, icon: React.ReactNode) => (
    url === ''
      ? <span className="sbtn soon" aria-label={`${label}: coming soon`}>{icon}<em>SOON</em></span>
      : <a className="sbtn" href={url} target="_blank" rel="noreferrer noopener" aria-label={`The project on ${label}`}>{icon}</a>
  );

  return (
    <div className="doorFoot">
      <div className="social">
        {social(X_URL, 'X', <XIcon />)}
        {social(TELEGRAM_URL, 'Telegram', <TelegramIcon />)}
      </div>

      {CONTRACT === '' ? (
        <div className="ca soon"><b>CA</b><span>COMING SOON</span></div>
      ) : (
        <button
          className="ca"
          onClick={() => {
            // The clipboard is refused outside a secure context and in some
            // embedded browsers; the address stays on screen either way.
            void navigator.clipboard?.writeText(CONTRACT)
              .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })
              .catch(() => undefined);
          }}
          title={CONTRACT}
        >
          <b>CA</b>
          <span>{copied ? 'COPIED' : shortAddress(CONTRACT)}</span>
        </button>
      )}

      {builtAtLabel() !== '' && <p className="built">BUILD {builtAtLabel()}</p>}
    </div>
  );
}

export interface SignInModalProps {
  onGuest: () => void;
  onRequest: (email: string) => void;
  sent: boolean;
  busy: boolean;
  error: string | null;
  /** null: not known yet; true: the server wants a code before anything else. */
  gate: boolean | null;
  /** The code the server has accepted this session, if any. */
  unlocked: boolean;
  onCode: (code: string) => void;
}

/**
 * The first screen.
 *
 * Playing comes first and email second, because asking a stranger for their
 * address before they have seen anything is where most of them leave. A guest
 * gets a real hold on the server; attaching an email later upgrades that same
 * hold rather than starting a new one.
 */
export function SignInModal({ onGuest, onRequest, sent, busy, error, gate, unlocked, onCode }: SignInModalProps) {
  const [showEmail, setShowEmail] = useState(false);
  const [code, setCode] = useState('');
  const locked = gate !== false && !unlocked;

  return (
    <div className="ovl">
      <div className="modal">
        <Wordmark />
        <p className="lead">Forge. Muster. Conquer.</p>
        {!sent && !showEmail && (
          <ul className="features">
            <li><b>Build a hold</b> that mines, forges and trains while you are away.</li>
            <li><b>Raid real players</b> — scout the base, drop your troops, take the stars.</li>
            <li><b>Found a clan</b>, talk, and go to war one day at a time.</li>
          </ul>
        )}

        {locked ? (
          <form
            className="gate"
            onSubmit={(e) => { e.preventDefault(); if (code.trim()) onCode(code.trim()); }}
          >
            <label htmlFor="accessCode">ACCESS CODE</label>
            <input
              id="accessCode"
              name="accessCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="····"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={inputStyle}
              disabled={gate === null}
            />
            <button className="btn gold big" type="submit" disabled={busy || gate === null || code.trim().length === 0}>
              {gate === null ? 'ONE MOMENT…' : busy ? 'CHECKING…' : 'ENTER'}
            </button>
            <p className="lead" style={{ marginTop: 12, marginBottom: 0 }}>
              This hold is by invitation. Ask whoever sent you here for the code.
            </p>
          </form>
        ) : sent ? (
          <p className="lead">Check your email for a link. It is good for fifteen minutes.</p>
        ) : showEmail ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem('email') as HTMLInputElement | null;
              if (input?.value) onRequest(input.value);
            }}
          >
            <input name="email" type="email" required placeholder="you@example.com" style={inputStyle} />
            <button className="btn gold big" type="submit" disabled={busy}>
              {busy ? 'SENDING…' : 'SEND LINK'}
            </button>
            <button className="btn grey big" type="button" onClick={() => setShowEmail(false)}>
              BACK
            </button>
          </form>
        ) : (
          <>
            <button className="btn gold big" onClick={onGuest} disabled={busy}>
              {busy ? 'RAISING YOUR HOLD…' : 'PLAY NOW'}
            </button>
            <button className="btn grey big" onClick={() => setShowEmail(true)}>
              I ALREADY HAVE A HOLD
            </button>
            <p className="lead" style={{ marginTop: 12, marginBottom: 0 }}>
              No sign-up. You can add an email later to keep it.
            </p>
          </>
        )}

        {error && <p className="lead" style={{ color: '#ff7a63', marginTop: 10 }}>{error}</p>}

        <DoorFooter />
      </div>
    </div>
  );
}

/** Asks a guest for an email without throwing them out of the game. */
export interface ClaimModalProps {
  sent: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (email: string) => void;
  onClose: () => void;
}

export function ClaimModal({ sent, busy, error, onSubmit, onClose }: ClaimModalProps) {
  return (
    <div className="ovl">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem('email') as HTMLInputElement | null;
          if (input?.value) onSubmit(input.value);
        }}
      >
        <h2>KEEP YOUR HOLD</h2>
        {sent ? (
          <>
            <p className="lead">
              Link sent. Open it on any device and this same hold — every building, every
              trophy — comes with you.
            </p>
            <button className="btn big" type="button" onClick={onClose}>BACK TO THE HOLD</button>
          </>
        ) : (
          <>
            <p className="lead">
              An email attaches this hold to you. Nothing changes in the game; it just
              stops being tied to this one browser.
            </p>
            <input name="email" type="email" required placeholder="you@example.com" style={inputStyle} />
            <button className="btn gold big" type="submit" disabled={busy}>
              {busy ? 'SENDING…' : 'SEND LINK'}
            </button>
            <button className="btn grey big" type="button" onClick={onClose}>NOT NOW</button>
          </>
        )}
        {error && <p className="lead" style={{ color: '#ff7a63', marginTop: 10 }}>{error}</p>}
      </form>
    </div>
  );
}


export interface ConfirmModalProps {
  title: string;
  lead: string;
  confirmLabel: string;
  /** When set, the player must type this exactly. Used for anything with no undo. */
  requireTyped?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * One confirmation for anything that cannot be taken back.
 *
 * `requireTyped` is reserved for deleting an account: a two-tap confirmation is
 * fine for demolishing a mine and nowhere near enough for erasing a hold
 * somebody spent a month on.
 */
export function ConfirmModal({
  title, lead, confirmLabel, requireTyped, danger, busy, error, onConfirm, onCancel,
}: ConfirmModalProps) {
  const [typed, setTyped] = useState('');
  const ready = !requireTyped || typed.trim() === requireTyped;

  return (
    <div className="ovl">
      <div className="modal">
        <h2>{title}</h2>
        <p className="lead">{lead}</p>

        {requireTyped && (
          <input
            value={typed}
            onChange={(e) => setTyped(e.currentTarget.value)}
            placeholder={requireTyped}
            aria-label={`Type ${requireTyped} to confirm`}
            style={inputStyle}
          />
        )}

        <button
          className={`btn big${danger ? ' red' : ' gold'}${ready ? '' : ' grey'}`}
          onClick={onConfirm}
          disabled={!ready || busy}
        >
          {busy ? 'WORKING…' : confirmLabel}
        </button>
        <button className="btn grey big" onClick={onCancel}>BACK</button>

        {error && <p className="lead" style={{ color: '#ff7a63', marginTop: 10 }}>{error}</p>}
      </div>
    </div>
  );
}

/**
 * The server did not answer.
 *
 * Shown instead of the field, because the field with nothing on it looks like
 * a game that loaded and has nothing in it — which is a worse message than the
 * truth. The detail line is what the player can read out to whoever runs the
 * server.
 */
export function ServerDownModal({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  return (
    <div className="ovl">
      <div className="modal">
        <Wordmark />
        <p className="lead">
          The hold cannot be reached right now.
          <br />
          {detail}
        </p>
        <button className="btn gold big" onClick={onRetry}>TRY AGAIN</button>
        <p className="lead" style={{ marginTop: 12, marginBottom: 0 }}>
          Nothing is lost. Your hold is on the server, and it keeps earning while this is sorted out.
        </p>
      </div>
    </div>
  );
}

/**
 * REPORT A PROBLEM.
 *
 * One box, no categories: a player who has just hit a bug is not in the mood
 * to classify it. What they write goes to the server with their name and
 * browser attached, and nowhere else.
 */
export function ReportModal({ onSend, onClose, busy }: { onSend: (text: string) => void; onClose: () => void; busy: boolean }) {
  const [text, setText] = useState('');
  return (
    <div className="ovl">
      <div className="modal">
        <h2>REPORT A PROBLEM</h2>
        <p className="lead">What happened, and what you expected instead. Where you were in the game helps.</p>
        <textarea
          className="report"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={5}
          placeholder="The mine would not collect after…"
          aria-label="Your report"
        />
        <button className="btn gold big" disabled={busy || text.trim().length < 4} onClick={() => onSend(text.trim())}>
          {busy ? 'SENDING…' : 'SEND'}
        </button>
        <button className="btn grey big" onClick={onClose}>CANCEL</button>
      </div>
    </div>
  );
}
