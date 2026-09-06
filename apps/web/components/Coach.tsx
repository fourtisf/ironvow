'use client';

import { useState } from 'react';
import type { Objective } from '../lib/game/coach';
import { fmt } from '../lib/format';

/**
 * The guide's card.
 *
 * Shows the one objective the game is asking for, with a bar where there is
 * progress to show and a single button that either goes to the right place,
 * claims the reward, or moves the tutorial on. It folds to a chip so a
 * player who knows the game can keep the field.
 */
export interface CoachProps {
  objective: Objective;
  busy: boolean;
  onGo: () => void;
  onClaim: () => void;
  onNext: () => void;
  onSkipTutorial: () => void;
  onHelp: () => void;
}

export function Coach({ objective: o, busy, onGo, onClaim, onNext, onSkipTutorial, onHelp }: CoachProps) {
  const [folded, setFolded] = useState(false);

  if (folded) {
    return (
      <button id="coachChip" onClick={() => setFolded(false)} aria-label="Show the guide">
        <span className="pip" />
        {o.kind === 'rest' ? 'ORDERS DONE' : o.title.toUpperCase()}
        {o.goal > 0 && <em>{fmt(o.progress)}/{fmt(o.goal)}</em>}
      </button>
    );
  }

  return (
    <div id="coach" className={o.claimable ? 'ready' : ''}>
      <div className="head">
        <span className="label">{o.label}</span>
        <button className="fold" onClick={() => setFolded(true)} aria-label="Fold the guide">–</button>
      </div>
      <h3>{o.title}</h3>
      <p>{o.text}</p>
      {o.goal > 0 && (
        <div className="prog">
          <div className="qbarBg"><div className="qbar" style={{ width: `${Math.min(100, (o.progress / o.goal) * 100)}%` }} /></div>
          <span>{fmt(o.progress)}/{fmt(o.goal)}</span>
        </div>
      )}
      <div className="acts">
        {o.claimable ? (
          <button className="btn gold" onClick={onClaim} disabled={busy}>{busy ? '…' : 'CLAIM REWARD'}</button>
        ) : o.kind === 'tutorial' ? (
          <>
            {o.go && <button className="btn grey" onClick={onGo}>{o.goLabel}</button>}
            <button className="btn" onClick={onNext}>GOT IT</button>
          </>
        ) : (
          o.go && <button className="btn" onClick={onGo}>{o.goLabel}</button>
        )}
        {o.kind === 'tutorial'
          ? <button className="link" onClick={onSkipTutorial}>Skip the tutorial</button>
          : <button className="link" onClick={onHelp}>How to play</button>}
      </div>
    </div>
  );
}
