'use client';

import { fmt } from '../lib/format';
import type { DailyView } from '../lib/api';

/**
 * War Orders.
 *
 * The progress bar and the CLAIM button both read the server's numbers, so a
 * bar that looks full always corresponds to a claim that will be honoured.
 */

export interface QuestRow {
  id: string;
  name: string;
  detail: string;
  goal: number;
  reward: { g: number; i: number };
  progress: number;
  claimed: boolean;
}

export interface QuestSheetProps {
  quests: QuestRow[];
  daily: DailyView | null;
  busyId: string | null;
  onClose: () => void;
  onClaim: (questId: string) => void;
  onClaimDaily: (orderId: string) => void;
  /** Take the player to where this order is done. */
  onGo: (kind: 'quest' | 'daily', id: string) => void;
}

/** "4h 20m", for the countdown to the next set. */
function untilText(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}

export function QuestSheet({
  quests, daily, busyId, onClose, onClaim, onClaimDaily, onGo,
}: QuestSheetProps) {
  const done = quests.filter((q) => q.claimed).length;
  const allDone = done === quests.length && quests.length > 0;

  return (
    <div className="sheet">
      <div className="sheetHead">
        <div>
          <h2>WAR ORDERS</h2>
          <p>Work down the list to grow fast · {done} of {quests.length} done</p>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>

      {daily && (
        <>
          <div className="dayHead">
            <div>
              <h3>TODAY</h3>
              <p>New orders in {untilText(daily.resetsInMs)}</p>
            </div>
            {daily.streak > 1 && (
              <span className="streak" title="Consecutive days. Raises every reward below.">
                🔥 {daily.streak} DAYS
              </span>
            )}
          </div>

          {daily.orders.map((o) => {
            const ready = o.progress >= o.goal && !o.claimed;
            return (
              <div className={`qrow day${o.claimed ? ' done' : ''}`} key={o.id}>
                <div className="qi">
                  <h4>{o.name}</h4>
                  <p>{o.detail} · {rewardText(o.reward)}</p>
                  <div className="qbarBg">
                    <div className="qbar" style={{ width: `${Math.min(100, (o.progress / o.goal) * 100)}%` }} />
                  </div>
                </div>
                {o.claimed ? (
                  <span className="qrw">DONE</span>
                ) : ready ? (
                  <button className="btn gold" disabled={busyId === o.id} onClick={() => onClaimDaily(o.id)}>
                    {busyId === o.id ? '…' : 'CLAIM'}
                  </button>
                ) : (
                  <span className="qgo">
                    <span className="qrw">{fmt(o.progress)}/{fmt(o.goal)}</span>
                    <button className="btn grey" onClick={() => onGo('daily', o.id)}>GO</button>
                  </span>
                )}
              </div>
            );
          })}

          <div className="dayHead">
            <div>
              <h3>{allDone ? 'THE LONG LIST' : 'YOUR CAMPAIGN'}</h3>
              <p>{allDone ? 'Every one of these is behind you.' : 'One-time orders, in order.'}</p>
            </div>
          </div>
        </>
      )}

      {quests.map((q) => {
        const ready = q.progress >= q.goal && !q.claimed;
        return (
          <div className={`qrow${q.claimed ? ' done' : ''}`} key={q.id}>
            <div className="qi">
              <h4>{q.name}</h4>
              <p>{q.detail}</p>
              <div className="qbarBg">
                <div className="qbar" style={{ width: `${Math.min(100, (q.progress / q.goal) * 100)}%` }} />
              </div>
            </div>

            {q.claimed ? (
              <span className="qrw">DONE</span>
            ) : ready ? (
              <button
                className="btn gold"
                disabled={busyId === q.id}
                onClick={() => onClaim(q.id)}
              >
                {busyId === q.id ? '…' : 'CLAIM'}
              </button>
            ) : (
              <span className="qgo">
                <span className="qrw">{q.progress}/{q.goal}</span>
                <button className="btn grey" onClick={() => onGo('quest', q.id)}>GO</button>
              </span>
            )}
          </div>
        );
      })}

      <p className="lead" style={{ marginTop: 10, textAlign: 'center' }}>
        Rewards go straight into your stores — build a Vault first if you are near the cap.
      </p>
    </div>
  );
}

/** Reward line, used in the claim toast. */
export function rewardText(reward: { g: number; i: number }): string {
  const parts: string[] = [];
  if (reward.g > 0) parts.push(`${fmt(reward.g)} gold`);
  if (reward.i > 0) parts.push(`${fmt(reward.i)} iron`);
  return parts.join(' and ');
}
