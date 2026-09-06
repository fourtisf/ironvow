'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type WarHistoryRow, type WarRosterRow, type WarView } from '../lib/api';
import { fmt } from '../lib/format';
import { ClanBadge } from './ClanSheet';
import { StarIcon } from './icons';

/**
 * The WAR tab.
 *
 * Four states on one tab: no war (declare, or answer a challenge), searching,
 * a war in progress (the scoreboard and the enemy roster with ATTACK on it),
 * and the last result. The rules are one paragraph at the top of
 * packages/config/src/war.ts and the server enforces all of them; this only
 * shows what the server sent and asks for the next thing.
 */

export interface WarTabProps {
  busy: boolean;
  act: (run: () => Promise<unknown>, done?: string) => Promise<void>;
  onToast: (m: string) => void;
  /** Open a war attack against a roster seat. */
  onAttack: (memberId: string) => void;
  /** Bumped by the parent when something changed elsewhere. */
  tick: number;
}

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${seconds % 60}s`;
}

export function WarTab({ busy, act, onToast, onAttack, tick }: WarTabProps) {
  const [view, setView] = useState<WarView | null>(null);
  const [history, setHistory] = useState<WarHistoryRow[] | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setView(await api.war());
    } catch (e) {
      onToast(e instanceof ApiError && e.code === 'notInClan' ? 'You are not in a clan' : 'Could not read the war');
    }
  }, [onToast]);

  useEffect(() => { void load(); }, [load, tick]);
  // Scores move while the tab is open; the clock every second.
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); }, 1000);
    const r = setInterval(() => { void load(); }, 15_000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [load]);

  if (!view) return <p className="lead">Reading the war…</p>;
  const war = view.war;
  const record = `${view.record.wins}W · ${view.record.losses}L${view.record.draws ? ` · ${view.record.draws}D` : ''}`;

  /* --- no war --------------------------------------------------------- */
  if (!war || war.state === 'done') {
    return (
      <>
        {war?.state === 'done' && war.them && <Scoreboard war={war} now={now} />}
        {view.incoming.map((c) => (
          <div className="qrow" key={c.warId}>
            <ClanBadge badge={c.badge} tag={c.tag} size={28} />
            <div className="qi">
              <h4>{c.name} challenged you</h4>
              <p>{c.memberCount} members · {fmt(c.trophies)} trophies</p>
            </div>
            {view.canLead ? (
              <span className="qgo">
                <button className="btn red" disabled={busy} onClick={() => void act(() => api.warRespond(c.warId, true), 'To war!')}>ACCEPT</button>
                <button className="btn grey" disabled={busy} onClick={() => void act(() => api.warRespond(c.warId, false))}>DECLINE</button>
              </span>
            ) : <span className="qrw">ELDERS DECIDE</span>}
          </div>
        ))}
        <div className="warIntro">
          <h4>CLAN WAR</h4>
          <p>
            Two clans, the same number of bases each, one day. Every base on the roster is frozen when the war starts.
            Each member gets two attacks; only the best result against each enemy base counts. More stars wins.
            War attacks take no loot and move no trophies — the reward comes at the end, per star, doubled for the winners.
          </p>
          <p className="rec">Record: {record}</p>
          {view.canLead ? (
            view.bigEnough ? (
              <button className="btn red big" disabled={busy} onClick={() => void act(() => api.warSearch(), 'Looking for an enemy')}>
                DECLARE WAR
              </button>
            ) : (
              <p className="lead">A clan needs {view.minMembers} members to go to war.</p>
            )
          ) : (
            <p className="lead">The leader or an elder declares. Or challenge a clan from the LADDER.</p>
          )}
        </div>
        <History rows={history} load={() => void api.warHistory().then((r) => setHistory(r.wars)).catch(() => setHistory([]))} />
      </>
    );
  }

  /* --- waiting -------------------------------------------------------- */
  if (war.state === 'search' || war.state === 'challenge') {
    return (
      <div className="warIntro">
        <h4>{war.state === 'search' ? 'LOOKING FOR AN ENEMY' : war.challenger === 'us' ? 'CHALLENGE SENT' : 'CHALLENGED'}</h4>
        <p>
          {war.state === 'search'
            ? 'The war begins the moment another clan declares. You will hear about it in chat and, if you allow it, on your phone.'
            : war.challenger === 'us'
              ? `Waiting for ${war.them?.name ?? 'them'} to answer. A challenge nobody answers is dropped after a day.`
              : `${war.them?.name ?? 'A clan'} has challenged you. The leader or an elder answers.`}
        </p>
        {view.canLead && war.challenger !== 'them' && (
          <button className="btn grey" disabled={busy} onClick={() => void act(() => api.warCancel(war.id), 'Withdrawn')}>
            {war.state === 'search' ? 'STOP LOOKING' : 'WITHDRAW'}
          </button>
        )}
      </div>
    );
  }

  /* --- fighting ------------------------------------------------------- */
  return (
    <>
      <Scoreboard war={war} now={now} />
      <p className="lead" style={{ margin: '4px 0 8px' }}>
        {war.onRoster
          ? war.myAttacksLeft > 0
            ? `You have ${war.myAttacksLeft} attack${war.myAttacksLeft === 1 ? '' : 's'} left. Pick a base below.`
            : 'You have used both attacks. Cheer the others on.'
          : 'You are not on the roster this war. Next time, with more trophies.'}
      </p>
      <h3 className="warSide">THEIR BASES</h3>
      {war.them?.roster.map((m) => (
        <Seat key={m.memberId} m={m} enemy>
          {war.onRoster && war.myAttacksLeft > 0 && (
            <button className="btn red" disabled={busy} onClick={() => onAttack(m.memberId)}>ATTACK</button>
          )}
        </Seat>
      ))}
      <h3 className="warSide">OUR BASES</h3>
      {war.us.roster.map((m) => <Seat key={m.memberId} m={m} enemy={false} />)}
    </>
  );
}

function Scoreboard({ war, now }: { war: NonNullable<WarView['war']>; now: number }) {
  const left = war.endsAt ? Math.max(0, Math.floor((new Date(war.endsAt).getTime() - now) / 1000)) : 0;
  const total = war.size * 3;
  const them = war.them!;
  return (
    <div className={`warBoard${war.result ? ` ${war.result}` : ''}`}>
      <div className="side">
        <ClanBadge badge={war.us.badge} tag={war.us.tag} size={30} />
        <span className="name">{war.us.name}</span>
        <span className="stars">{war.us.stars}<em>/{total}</em></span>
        <span className="pct">{Math.round((war.us.pct * 100) / Math.max(1, war.size))}%</span>
      </div>
      <div className="mid">
        {war.result
          ? <span className={`verdict ${war.result}`}>{war.result === 'won' ? 'VICTORY' : war.result === 'lost' ? 'DEFEAT' : 'DRAW'}</span>
          : <><span className="vs">VS</span><span className="left">{clock(left)} left</span></>}
      </div>
      <div className="side">
        <ClanBadge badge={them.badge} tag={them.tag} size={30} />
        <span className="name">{them.name}</span>
        <span className="stars">{them.stars}<em>/{total}</em></span>
        <span className="pct">{Math.round((them.pct * 100) / Math.max(1, war.size))}%</span>
      </div>
    </div>
  );
}

function Seat({ m, enemy, children }: { m: WarRosterRow; enemy: boolean; children?: React.ReactNode }) {
  return (
    <div className={`qrow${m.isMe ? ' me' : ''}`}>
      <div className="qi">
        <h4>{m.name}{m.isMe ? ' (you)' : ''}</h4>
        <p>Keep {m.keepLevel} · {enemy ? 'best against them' : 'best against us'}: {m.bestStars}★ {Math.round(m.bestPct * 100)}% · attacks {m.attacksUsed}/{m.attacksUsed + m.attacksLeft}</p>
      </div>
      <span className="warStars" aria-label={`${m.bestStars} stars`}>
        {[0, 1, 2].map((i) => <span key={i}><StarIcon on={i < m.bestStars} /></span>)}
      </span>
      {children}
    </div>
  );
}

function History({ rows, load }: { rows: WarHistoryRow[] | null; load: () => void }) {
  if (rows === null) return <button className="link" style={{ display: 'block', margin: '10px auto 0' }} onClick={load}>Past wars</button>;
  if (rows.length === 0) return <p className="lead" style={{ marginTop: 10 }}>No wars fought yet.</p>;
  return (
    <>
      <h3 className="warSide">PAST WARS</h3>
      {rows.map((w) => (
        <div className={`qrow ${w.result}`} key={w.id}>
          <div className="qi">
            <h4>vs {w.enemy}</h4>
            <p>{w.endedAt ? new Date(w.endedAt).toLocaleDateString() : ''}</p>
          </div>
          <span className="qrw">{w.ours}–{w.theirs} · {w.result.toUpperCase()}</span>
        </div>
      ))}
    </>
  );
}
