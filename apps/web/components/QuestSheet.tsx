'use client';

import { fmt } from '../lib/format';

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
  busyId: string | null;
  onClose: () => void;
  onClaim: (questId: string) => void;
}

export function QuestSheet({ quests, busyId, onClose, onClaim }: QuestSheetProps) {
  const done = quests.filter((q) => q.claimed).length;

  return (
    <div className="sheet">
      <div className="sheetHead">
        <div>
          <h2>WAR ORDERS</h2>
          <p>Work down the list to grow fast · {done} of {quests.length} done</p>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>

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
              <span className="qrw">
                {q.progress}/{q.goal}
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
