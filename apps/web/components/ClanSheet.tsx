'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLAN_CREATE_COST, CLAN_CREATE_KEEP_LEVEL, CLAN_DESC_MAX, CLAN_NAME_MAX, CLAN_TAG_MAX,
  TROOP, TROOP_ORDER, cleanTag, validClanName, validTag, type TroopType,
} from '@ironvow/config';
import {
  ApiError, api,
  type ChatMessage, type ClanLadderRow, type ClanMemberRow, type ClanRole, type ClanSummary,
  type MyClanView,
} from '../lib/api';
import { fmt } from '../lib/format';
import type { PlayerState } from '../lib/game/types';
import { GoldIcon, TrophyIcon } from './icons';
import { WarTab } from './WarTab';

/**
 * The clan screen.
 *
 * Three states, not three screens: you are in a clan, or you are looking for
 * one, or you are founding one. A player who taps CLAN on their first day
 * should land on a list of rooms they can walk into, not on a form.
 *
 * Every button here is drawn from the role the server sent. Hiding a button
 * the server would refuse is a courtesy, not a security boundary — the server
 * checks again, from the row, on every single call.
 */

const BADGE_COLOURS = [
  ['#3f6fbe', '#2a4c88'], ['#a03828', '#6d2216'], ['#3f7a44', '#2a5230'],
  ['#7f6fb0', '#4e4276'], ['#c9924f', '#7d5028'], ['#4a8f96', '#2d6067'],
  ['#b0873f', '#7a5a24'], ['#5b6875', '#3a444f'],
];

export function ClanBadge({ badge, tag, size = 34 }: { badge: number; tag: string; size?: number }) {
  const [a, b] = BADGE_COLOURS[badge % BADGE_COLOURS.length]!;
  return (
    <span
      className="clanBadge"
      style={{ width: size, height: size, background: `linear-gradient(${a},${b})`, fontSize: size * 0.34 }}
    >
      {tag}
    </span>
  );
}

export interface ClanSheetProps {
  player: PlayerState;
  onClose: () => void;
  onToast: (message: string) => void;
  /** The player's purse changed (founding costs gold). */
  onPlayerChanged: () => void;
  /** Open a war attack on a roster seat. */
  onWarAttack: (memberId: string) => void;
}

type Tab = 'chat' | 'members' | 'war' | 'find' | 'ladder';

export function ClanSheet({ player, onClose, onToast, onPlayerChanged, onWarAttack }: ClanSheetProps) {
  const [mine, setMine] = useState<MyClanView | null>(null);
  const [warTick, setWarTick] = useState(0);
  const [tab, setTab] = useState<Tab>('chat');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const view = await api.myClan();
      setMine(view);
      // The tab has to follow the state, in both directions. Somebody with no
      // clan has nothing to say and nobody to say it to, so FIND is the useful
      // first screen — and the moment they found or join one, FIND stops being
      // rendered at all, so staying on it leaves a blank sheet.
      setTab((t) => {
        if (!view.clan) return t === 'chat' || t === 'members' || t === 'war' ? 'find' : t;
        return t === 'find' ? 'chat' : t;
      });
    } catch {
      onToast('Could not reach the clan');
    }
  }, [onToast]);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (run: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await run();
      if (done) onToast(done);
      await load();
      setWarTick((t) => t + 1);
      onPlayerChanged();
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [busy, load, onToast, onPlayerChanged]);

  const clan = mine?.clan ?? null;
  const role = mine?.role ?? null;

  return (
    <div className="sheet">
      <div className="sheetHead">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {clan && <ClanBadge badge={clan.badge} tag={clan.tag} />}
          <div>
            <h2>{clan ? clan.name.toUpperCase() : 'CLANS'}</h2>
            <p>
              {clan
                ? `${clan.memberCount}/${clan.maxMembers} members · ${fmt(clan.trophies)} trophies`
                : 'Somewhere to talk, and people who are actually there'}
            </p>
          </div>
        </div>
        <button className="xbtn" onClick={onClose}>✕</button>
      </div>

      <div className="tabs">
        {clan && <Tab id="chat" tab={tab} set={setTab}>CHAT</Tab>}
        {clan && (
          <Tab id="members" tab={tab} set={setTab}>
            MEMBERS
            {(mine?.requests?.length ?? 0) > 0 && <span className="dot" />}
          </Tab>
        )}
        {clan && <Tab id="war" tab={tab} set={setTab}>WAR</Tab>}
        {!clan && <Tab id="find" tab={tab} set={setTab}>FIND</Tab>}
        <Tab id="ladder" tab={tab} set={setTab}>LADDER</Tab>
      </div>

      {tab === 'chat' && clan && <ChatTab onToast={onToast} />}
      {tab === 'members' && clan && role && (
        <MembersTab
          clan={clan}
          requests={mine?.requests ?? []}
          role={role}
          me={player.id}
          army={player.army}
          busy={busy}
          act={act}
        />
      )}
      {tab === 'war' && clan && (
        <WarTab busy={busy} act={act} onToast={onToast} onAttack={onWarAttack} tick={warTick} />
      )}
      {tab === 'find' && !clan && <FindTab player={player} busy={busy} act={act} />}
      {tab === 'ladder' && <LadderTab canChallenge={Boolean(clan) && (role === 'leader' || role === 'elder')} busy={busy} act={act} />}
    </div>
  );
}

function Tab(
  { id, tab, set, children }: { id: Tab; tab: Tab; set: (t: Tab) => void; children: React.ReactNode },
) {
  return (
    <button className={`tab${tab === id ? ' on' : ''}`} onClick={() => set(id)}>{children}</button>
  );
}

/* ------------------------------------------------------------------ chat --- */

function ChatTab({ onToast }: { onToast: (m: string) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    const pull = async () => {
      try {
        // `after` is the last id we hold, so a quiet room costs an empty array
        // rather than the whole history every four seconds.
        const { messages: fresh } = await api.clanMessages(lastId.current ?? undefined);
        if (!live || fresh.length === 0) return;
        lastId.current = fresh[fresh.length - 1]!.id;
        setMessages((prev) => [...prev, ...fresh].slice(-120));
      } catch {
        // A dropped poll is not worth a toast; the next one will catch up.
      }
    };
    void pull();
    const timer = setInterval(() => { void pull(); }, 4000);
    return () => { live = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (body.length === 0 || sending) return;
    setSending(true);
    try {
      const { message } = await api.sendClanMessage(body);
      lastId.current = message.id;
      setMessages((prev) => [...prev, message].slice(-120));
      setDraft('');
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="chatLog">
        {messages.length === 0 && <p className="lead">Nothing said yet. Say something.</p>}
        {messages.map((m) => (
          m.kind === 'system' ? (
            <p className="chatSys" key={m.id}>{m.body}</p>
          ) : (
            <div className={`chatMsg${m.mine ? ' mine' : ''}`} key={m.id}>
              {!m.mine && <span className="who">{m.author}</span>}
              <span className="body">{m.body}</span>
            </div>
          )
        ))}
        <div ref={endRef} />
      </div>

      <div className="chatBar">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
          placeholder="Say something"
          maxLength={220}
          aria-label="Message"
        />
        <button className="btn gold" disabled={sending || draft.trim().length === 0} onClick={() => void send()}>
          SEND
        </button>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- members --- */

function MembersTab({
  clan, requests, role, me, army, busy, act,
}: {
  clan: ClanSummary & { members: ClanMemberRow[] };
  requests: { id: string; name: string; trophies: number; keepLevel: number }[];
  role: ClanRole;
  me: string;
  /** What the giver actually has to give. */
  army: Partial<Record<TroopType, number>>;
  busy: boolean;
  act: (run: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const canModerate = role === 'leader' || role === 'elder';
  /*
   * Which member the giving row is open under.
   *
   * One at a time and only on request, because a chip per troop on every row
   * would turn a member list into a spreadsheet — and the list is read far
   * more often than it is donated from.
   */
  const [giving, setGiving] = useState<string | null>(null);
  const spare = TROOP_ORDER.filter((t) => (army[t] ?? 0) > 0);

  return (
    <>
      {canModerate && requests.length > 0 && (
        <>
          <div className="dayHead">
            <div><h3>ASKING TO JOIN</h3><p>{requests.length} waiting</p></div>
          </div>
          {requests.map((r) => (
            <div className="qrow" key={r.id}>
              <div className="qi">
                <h4>{r.name}</h4>
                <p>{fmt(r.trophies)} trophies · Keep {r.keepLevel}</p>
              </div>
              <button className="btn gold" disabled={busy}
                onClick={() => void act(() => api.decideClanRequest(r.id, true), `${r.name} is in`)}>
                LET IN
              </button>
              <button className="btn grey" disabled={busy}
                onClick={() => void act(() => api.decideClanRequest(r.id, false))}>
                NO
              </button>
            </div>
          ))}
        </>
      )}

      {clan.members.map((m) => (
        <div className="qrow" key={m.id}>
          <div className="qi">
            <h4>{m.name} {m.id === me && <span className="tagYou">YOU</span>}</h4>
            <p>
              <span className={`roleTag ${m.role}`}>{m.role.toUpperCase()}</span>
              {' '}{fmt(m.trophies)} trophies · Keep {m.keepLevel}
            </p>
          </div>
          {role === 'leader' && m.id !== me && (
            <button className="btn grey" disabled={busy}
              onClick={() => void act(
                () => api.setClanRole(m.id, m.role === 'elder' ? 'member' : 'elder'),
                m.role === 'elder' ? `${m.name} is a member` : `${m.name} is an elder`,
              )}>
              {m.role === 'elder' ? 'DEMOTE' : 'PROMOTE'}
            </button>
          )}
          {canModerate && m.id !== me && m.role !== 'leader' && !(role === 'elder' && m.role === 'elder') && (
            <button className="btn red" disabled={busy}
              onClick={() => void act(() => api.kickFromClan(m.id), `${m.name} was removed`)}>
              KICK
            </button>
          )}
          {/*
            * The only thing in this game one player can do for another.
            * Offered on every clanmate except yourself: a hold that can
            * garrison itself is a hold with a second warband.
            */}
          {m.id !== me && (
            <button
              className={`btn${giving === m.id ? ' gold' : ' grey'}`}
              disabled={busy || spare.length === 0}
              onClick={() => setGiving(giving === m.id ? null : m.id)}
            >
              GIVE
            </button>
          )}
        </div>
      )).flatMap((row, i) => {
        const m = clan.members[i]!;
        if (giving !== m.id) return [row];
        return [row, (
          <div className="qrow" key={`${m.id}-give`} style={{ paddingTop: 0 }}>
            <div className="qi">
              <h4>Send to {m.name}</h4>
              <p>
                {spare.length === 0
                  ? 'Train something first — you can only give what you have.'
                  : 'One tap sends one. They stand in their hold until somebody raids it.'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {spare.map((t) => (
                <button
                  key={t}
                  className="btn"
                  disabled={busy}
                  style={{ padding: '8px 10px' }}
                  onClick={() => void act(
                    () => api.donate(m.id, t, 1),
                    `Sent a ${TROOP[t].n} to ${m.name}`,
                  )}
                >
                  {TROOP[t].n} {army[t] ?? 0}
                </button>
              ))}
            </div>
          </div>
        )];
      })}

      {role === 'leader' && <ClanSettings clan={clan} busy={busy} act={act} />}

      <button className="btn red wide" style={{ marginTop: 12 }} disabled={busy}
        onClick={() => void act(() => api.leaveClan(), 'You left the clan')}>
        LEAVE THE CLAN
      </button>
      {role === 'leader' && clan.memberCount > 1 && (
        <p className="lead" style={{ marginTop: 8, textAlign: 'center' }}>
          Hand the clan to somebody else before you go — promote them to leader.
        </p>
      )}
    </>
  );
}

function ClanSettings({
  clan, busy, act,
}: {
  clan: ClanSummary;
  busy: boolean;
  act: (run: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const [description, setDescription] = useState(clan.description);
  const [policy, setPolicy] = useState(clan.joinPolicy);
  const [minTrophies, setMinTrophies] = useState(String(clan.minTrophies));

  return (
    <>
      <div className="dayHead" style={{ marginTop: 14 }}>
        <div><h3>WHO GETS IN</h3><p>Only you can change this.</p></div>
      </div>
      <div className="formRow">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={CLAN_DESC_MAX}
          placeholder="What this clan is for"
          aria-label="Clan description"
        />
      </div>
      <div className="formRow">
        <select value={policy} onChange={(e) => setPolicy(e.target.value as typeof policy)} aria-label="Who may join">
          <option value="open">Anyone may join</option>
          <option value="request">Ask first</option>
          <option value="closed">Nobody, for now</option>
        </select>
        <input
          value={minTrophies}
          onChange={(e) => setMinTrophies(e.target.value.replace(/\D/g, '').slice(0, 5))}
          inputMode="numeric"
          placeholder="Min trophies"
          aria-label="Minimum trophies"
        />
      </div>
      <button className="btn wide" disabled={busy}
        onClick={() => void act(
          () => api.clanSettings({ description, joinPolicy: policy, minTrophies: Number(minTrophies || 0) }),
          'Saved',
        )}>
        SAVE
      </button>
    </>
  );
}

/* ------------------------------------------------------------------ find --- */

function FindTab({
  player, busy, act,
}: {
  player: PlayerState;
  busy: boolean;
  act: (run: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [clans, setClans] = useState<ClanSummary[]>([]);
  const [founding, setFounding] = useState(false);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void api.findClans(q).then((r) => { if (live) setClans(r.clans); }).catch(() => undefined);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  if (founding) return <FoundClan player={player} busy={busy} act={act} onBack={() => setFounding(false)} />;

  const canFound = player.keepLevel >= CLAN_CREATE_KEEP_LEVEL;

  return (
    <>
      <div className="formRow">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or tag" aria-label="Search clans" />
        <button className="btn gold" disabled={!canFound} onClick={() => setFounding(true)}>FOUND ONE</button>
      </div>
      {!canFound && (
        <p className="lead">Reach Keep {CLAN_CREATE_KEEP_LEVEL} to found your own. You can join one right now.</p>
      )}

      {clans.length === 0 && <p className="lead">No clans yet. Found the first one.</p>}
      {clans.map((c) => (
        <div className="qrow" key={c.id}>
          <ClanBadge badge={c.badge} tag={c.tag} size={30} />
          <div className="qi">
            <h4>{c.name}</h4>
            <p>
              {c.memberCount}/{c.maxMembers} · {fmt(c.trophies)} trophies
              {c.minTrophies > 0 && ` · needs ${fmt(c.minTrophies)}`}
              {c.description && ` · ${c.description}`}
            </p>
          </div>
          <button
            className={`btn${c.joinPolicy === 'closed' ? ' grey' : ' gold'}`}
            disabled={busy || c.joinPolicy === 'closed' || c.memberCount >= c.maxMembers}
            onClick={() => void act(
              () => api.joinClan(c.id),
              c.joinPolicy === 'request' ? 'Asked to join' : `You are in ${c.name}`,
            )}
          >
            {c.joinPolicy === 'closed' ? 'CLOSED'
              : c.memberCount >= c.maxMembers ? 'FULL'
              : c.joinPolicy === 'request' ? 'ASK' : 'JOIN'}
          </button>
        </div>
      ))}
    </>
  );
}

function FoundClan({
  player, busy, act, onBack,
}: {
  player: PlayerState;
  busy: boolean;
  act: (run: () => Promise<unknown>, done?: string) => Promise<void>;
  onBack: () => void;
}) {
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [description, setDescription] = useState('');
  const [badge, setBadge] = useState(0);

  const cleanedTag = cleanTag(tag);
  const ok = validClanName(name.trim()) && validTag(cleanedTag);
  const affordable = player.gold >= CLAN_CREATE_COST.g;

  return (
    <>
      <div className="dayHead">
        <div>
          <h3>FOUND A CLAN</h3>
          <p>Costs {fmt(CLAN_CREATE_COST.g)} gold. You will be its leader.</p>
        </div>
        <button className="btn grey" onClick={onBack}>BACK</button>
      </div>

      <div className="formRow">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={CLAN_NAME_MAX}
          placeholder="Clan name" aria-label="Clan name" />
        <input value={tag} onChange={(e) => setTag(e.target.value)} maxLength={CLAN_TAG_MAX}
          placeholder="TAG" aria-label="Clan tag" style={{ maxWidth: 90 }} />
      </div>
      <div className="formRow">
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={CLAN_DESC_MAX}
          placeholder="What this clan is for" aria-label="Clan description" />
      </div>

      <div className="badgeRow">
        {BADGE_COLOURS.map((_, i) => (
          <button key={i} className={`badgePick${badge === i ? ' on' : ''}`} onClick={() => setBadge(i)}
            aria-label={`Badge ${i + 1}`}>
            <ClanBadge badge={i} tag={cleanedTag || '··'} size={30} />
          </button>
        ))}
      </div>

      <div className="lootRow" style={{ justifyContent: 'center', margin: '8px 0' }}>
        <GoldIcon /> {fmt(CLAN_CREATE_COST.g)}
      </div>

      <button className="btn gold wide" disabled={busy || !ok || !affordable}
        onClick={() => void act(
          () => api.createClan({ name: name.trim(), tag: cleanedTag, description, badge }),
          'Your clan stands',
        )}>
        {!affordable ? 'NOT ENOUGH GOLD' : ok ? 'FOUND IT' : 'NAME AND TAG FIRST'}
      </button>
    </>
  );
}

/* ---------------------------------------------------------------- ladder --- */

function LadderTab({ canChallenge, busy, act }: { canChallenge: boolean; busy: boolean; act: (run: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const [rows, setRows] = useState<ClanLadderRow[] | null>(null);
  useEffect(() => {
    void api.clanLadder().then((r) => setRows(r.top)).catch(() => setRows([]));
  }, []);

  if (!rows) return <p className="lead">Reading the ladder…</p>;
  if (rows.length === 0) return <p className="lead">No clans on the board yet.</p>;

  return (
    <>
      {rows.map((c) => (
        <div className={`qrow${c.isMine ? ' me' : ''}`} key={c.id}>
          <span className="rank">{c.rank}</span>
          <ClanBadge badge={c.badge} tag={c.tag} size={28} />
          <div className="qi">
            <h4>{c.name}</h4>
            <p>{c.memberCount} members</p>
          </div>
          <span className="qgo">
            <span className="qrw"><TrophyIcon /> {fmt(c.trophies)}</span>
            {canChallenge && !c.isMine && (
              <button className="btn red" disabled={busy} onClick={() => void act(() => api.warChallenge(c.id), `Challenge sent to ${c.name}`)}>
                WAR
              </button>
            )}
          </span>
        </div>
      ))}
    </>
  );
}

/* ----------------------------------------------------------------------- */

/**
 * Server errors, in words a player can act on.
 *
 * The server answers with a code because a code is stable; turning it into a
 * sentence is the client's job, and "notAllowed" on its own is not a sentence.
 */
const MESSAGES: Record<string, string> = {
  alreadyInClan: 'You are already in a clan',
  cannotAfford: 'Not enough gold to found a clan',
  clanFull: 'That clan is full',
  closed: 'That clan is not taking anyone',
  keepTooLow: `Reach Keep ${CLAN_CREATE_KEEP_LEVEL} to found a clan`,
  nameTaken: 'That name or tag is taken',
  notAllowed: 'You do not have the rank for that',
  notInClan: 'You are not in a clan',
  notInYourClan: 'They are not in your clan',
  passLeadershipFirst: 'Promote somebody else to leader first',
  tooFast: 'Slow down a moment',
  trophiesTooLow: 'You do not have enough trophies for that clan',
  badName: 'That name is too short or too long',
  badTag: 'A tag is 2 to 5 letters or numbers',
  emptyMessage: 'Nothing to send',
  clanTooSmall: 'A clan needs three members to go to war',
  theyAreTooSmall: 'That clan is too small to go to war',
  alreadyAtWar: 'Your clan is already at war, or waiting on one',
  theyAreAtWar: 'That clan is already at war',
  noSuchChallenge: 'That challenge is gone',
  noSuchWar: 'That war is gone',
  thatIsUs: 'That is your own clan',
  warOver: 'The war is over',
  noAttacksLeft: 'You have used both attacks',
  notOnRoster: 'You are not on the roster this war',
  raidOpen: 'Finish the raid you have open first',
  notYourWar: 'That is not your war',
};

function errorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : undefined;
  return (code && MESSAGES[code]) || 'That did not work';
}
