import type { BuildingType, ItemType, RelicType, TroopType } from '@ironvow/config';
import type { DeployCommand, ItemCommand } from '@ironvow/types';
import type { PlayerState, ScoutedRaid } from './game/types';

/**
 * The client's whole conversation with the server.
 *
 * Notice what is absent: there is no endpoint here that sends a price, a
 * resource total or a battle result. The client sends what the player meant to
 * do, and the server sends back what is true.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ApiError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? 'unknown', body.message);
  return body as T;
}

const post = <T>(path: string, payload?: unknown): Promise<T> =>
  call<T>(path, { method: 'POST', body: JSON.stringify(payload ?? {}) });

export interface CommandResponse {
  player: PlayerState;
}

/** Today's three orders, the streak, and how long is left on the day. */
export interface DailyView {
  count: number;
  streak: number;
  resetsInMs: number;
  orders: {
    id: string; name: string; detail: string; goal: number;
    reward: { g: number; i: number }; progress: number; claimed: boolean;
  }[];
}

export type ClanRole = 'leader' | 'elder' | 'member';
export type JoinPolicy = 'open' | 'request' | 'closed';

export interface ClanSummary {
  id: string; name: string; tag: string; description: string;
  joinPolicy: JoinPolicy; minTrophies: number; badge: number;
  memberCount: number; maxMembers: number; trophies: number;
}

export interface ClanMemberRow {
  id: string; name: string; trophies: number; keepLevel: number;
  role: ClanRole; joinedAt: string;
}

export interface MyClanView {
  role: ClanRole | null;
  clan: (ClanSummary & { members: ClanMemberRow[] }) | null;
  requests?: { id: string; name: string; trophies: number; keepLevel: number; at: string }[];
}

export interface ChatMessage {
  id: string; authorId: string | null; author: string; body: string;
  kind: 'chat' | 'system'; at: string; mine: boolean;
}

export interface WarRosterRow {
  memberId: string; playerId: string; name: string; keepLevel: number;
  bestStars: number; bestPct: number; attacksUsed: number; attacksLeft: number; isMe: boolean;
}

export interface WarSide {
  clanId: string; name: string; tag: string; badge: number; stars: number; pct: number;
  roster: WarRosterRow[];
}

export interface WarView {
  war: null | {
    id: string;
    state: 'search' | 'challenge' | 'active' | 'done';
    challenger: 'us' | 'them' | null;
    size: number;
    startsAt: string | null;
    endsAt: string | null;
    secondsLeft: number;
    result: 'won' | 'lost' | 'draw' | null;
    us: WarSide;
    them: WarSide | null;
    onRoster: boolean;
    myAttacksLeft: number;
    attacksEach: number;
  };
  incoming: { warId: string; clanId: string; name: string; tag: string; badge: number; memberCount: number; trophies: number; at: string }[];
  record: { wins: number; losses: number; draws: number };
  canLead: boolean;
  bigEnough: boolean;
  minMembers: number;
}

export interface WarHistoryRow {
  id: string; enemy: string; ours: number; theirs: number; result: 'won' | 'lost' | 'draw'; endedAt: string | null;
}

export interface ClanLadderRow {
  id: string; name: string; tag: string; badge: number;
  memberCount: number; trophies: number; rank: number; isMine: boolean;
}

export interface PlayerHit {
  id: string; name: string; trophies: number; keepLevel: number; isMe: boolean;
}

export interface PlayerProfile {
  id: string;
  name: string;
  trophies: number;
  seasonPeak: number;
  keepLevel: number;
  heroLevel: number;
  rank: number;
  since: string;
  raids: number;
  wins: number;
  threeStars: number;
  clan: { id: string; name: string; tag: string; badge: number; role: string } | null;
  isMe: boolean;
}

export interface BreachRow {
  type: BuildingType;
  /** The building's name, resolved server-side so this file holds no copy. */
  n: string;
  level: number;
}

export interface BreachView {
  /** A compass point, or "everywhere" when the attack had no one side. */
  side: string;
  concentration: number;
  fell: (BreachRow & { at: number })[];
  idle: BreachRow[];
  traps: (BreachRow & { sprung: boolean; at: number | null })[];
  /** They came by air and the base had nothing that shoots up. */
  airBlind: boolean;
  seconds: number;
  stars: number;
  destroyedPct: number;
  /** True when the hold that fell was the reader's own. */
  mine: boolean;
}

/** The four things a hold is worth laying out for. */
export type LayoutSlot = 'defence' | 'farming' | 'war' | 'push';

export interface RelicsView {
  unlocked: boolean;
  /** The Keep level they open at, so a locked panel can say what to aim for. */
  keep: number;
  shards: number;
  slots: number;
  carried: (RelicType | null)[];
  /** The hero's respawn with Haste already applied. */
  respawnMinutes: number;
  list: {
    type: RelicType; n: string; d: string;
    level: number; max: number; per: number;
    /** Null once it is at the top. */
    cost: number | null;
  }[];
}

export interface SeasonTierView {
  id: string; n: string; at: number; reward: { g: number; i: number };
}

export interface SeasonState {
  index: number;
  startedAt: string;
  endsAt: string;
  /** Milliseconds left when the server answered. The banner counts down from it. */
  msLeft: number;
  /** The highest total reached this season. What the payout is on. */
  peak: number;
  trophies: number;
  rank: number;
  /** How many holds are above the first tier and therefore in the running. */
  contenders: number;
  tier: SeasonTierView | null;
  next: SeasonTierView | null;
  tiers: SeasonTierView[];
  /** Where the current total lands when the season closes. */
  resetTo: number;
  last: {
    index: number; rank: number; trophies: number; tier: string; gold: number; iron: number;
  } | null;
}

export const api = {
  me: (): Promise<PlayerState> => call('/me'),

  requestLogin: (email: string, accessCode?: string): Promise<{ ok: true }> => post('/auth/request', { email, accessCode }),
  gate: (): Promise<{ required: boolean }> => call('/auth/gate'),
  invite: (): Promise<{ code: string; invited: number; paid: number }> => call('/invite'),
  /**
   * Mark What's New read up to a note number.
   *
   * The number is sent rather than "the latest", because this build only knows
   * the notes it shipped with — answering "latest" from a tab left open across
   * a deploy would swallow a note it never showed.
   */
  markNews: (no: number): Promise<{ newsSeen: number }> => post('/me/news', { no }),
  donate: (playerId: string, type: TroopType, count: number): Promise<
    { ok: true; count: number; reward: number }
  > => post('/clan/donate', { playerId, type, count }),
  tryGate: (accessCode: string): Promise<{ ok: true }> => post('/auth/gate', { accessCode }),
  /** Start playing immediately, with no email. */
  guest: (accessCode?: string): Promise<{ ok: true; playerId: string; name?: string }> => post('/auth/guest', accessCode ? { accessCode } : {}),
  /** Attach an email to the hold already signed in. */
  claimAccount: (email: string): Promise<{ ok: true }> => post('/auth/claim', { email }),
  redeemLogin: (token: string, name?: string): Promise<{ ok: true; playerId: string }> =>
    post('/auth/redeem', { token, name }),
  logout: (): Promise<{ ok: true }> => post('/auth/logout'),

  build: (type: BuildingType, gx: number, gy: number): Promise<CommandResponse & { seconds: number }> =>
    post('/build', { type, gx, gy }),
  upgrade: (buildingId: string): Promise<CommandResponse & { seconds: number }> =>
    post('/upgrade', { buildingId }),
  /** Pay gold to finish a job now. */
  finish: (buildingId: string): Promise<CommandResponse & { cost: number }> =>
    post('/finish', { buildingId }),
  /** Tear a building down for half of what went into it. */
  demolish: (buildingId: string): Promise<CommandResponse & {
    refund: { g: number; i: number }; wasted: { gold: number; iron: number };
  }> => post('/demolish', { buildingId }),
  /** Stop a builder mid-job and get everything back. */
  cancelBuild: (buildingId: string): Promise<CommandResponse & {
    removes: boolean; refund: { g: number; i: number };
  }> => post('/cancel', { buildingId }),
  cancelTraining: (jobId: string): Promise<CommandResponse & {
    refund: { g: number; i: number };
  }> => post('/train/cancel', { jobId }),
  move: (buildingId: string, gx: number, gy: number): Promise<CommandResponse> =>
    post('/move', { buildingId, gx, gy }),
  collect: (buildingId?: string): Promise<CommandResponse & {
    collected: { gold: number; iron: number };
    wasted: { gold: number; iron: number };
  }> => post('/collect', buildingId ? { buildingId } : {}),
  train: (type: TroopType, count = 1): Promise<CommandResponse & { queued: number }> =>
    post('/train', { type, count }),

  findRaid: (reroll = false): Promise<ScoutedRaid & { isPlayer: boolean; player: PlayerState }> =>
    post('/raid/find', { reroll }),

  /**
   * Submit the deploys that were actually played.
   *
   * `clientChecksum` is telemetry, not evidence. The server computes its own
   * and uses that; the disagreement is only recorded so a determinism bug shows
   * up as a spike instead of as quietly wrong payouts.
   */
  submitRaid: (
    raidId: string,
    commands: DeployCommand[],
    items: ItemCommand[],
    clientChecksum?: string,
    clientStars?: number,
  ): Promise<CommandResponse & {
    stars: number;
    destroyedPct: number;
    loot: { g: number; i: number };
    trophyDelta: number;
    heroDied: boolean;
    heroDeployed: boolean;
    checksum: string;
    rejected: { index: number; reason: string }[];
    /** A war attack: scored for the clan, no loot, no trophies. */
    war?: boolean;
  }> => post(`/raid/${raidId}/submit`, { commands, items, clientChecksum, clientStars }),

  progression: (): Promise<{
    crew: { builders: number; max: number; nextCost: number | null };
    hero: {
      name: string; level: number; maxLevel: number; unlockKeepLevel: number;
      unlocked: boolean; stats: { hp: number; dmg: number; cd: number; spd: number; rng: number };
      upgradeCost: { g: number; i: number }; readyAt: string | null; respawnMinutes: number;
    };
    lab: {
      level: number;
      troops: { type: TroopType; level: number; power: number; upgradeCost: { g: number; i: number } }[];
    };
    items: {
      type: ItemType; n: string; d: string; cost: { g: number; i: number };
      cap: number; keep: number; held: number; unlocked: boolean;
    }[];
    relics: RelicsView;
  }> => call('/progression'),

  upgradeHero: (): Promise<CommandResponse & { toLevel: number }> => post('/hero/upgrade'),
  hireBuilder: (): Promise<CommandResponse & { to: number }> => post('/builder/hire'),
  upgradeTroop: (type: TroopType): Promise<CommandResponse & { toLevel: number }> =>
    post('/troop/upgrade', { type }),
  /** Forge a relic, or raise one already forged. Shards only — never gold. */
  forgeRelic: (type: RelicType): Promise<CommandResponse & { toLevel: number }> =>
    post('/relic/forge', { type }),
  /** Carry a relic in a slot, or pass null to empty it. */
  carryRelic: (slot: number, type: RelicType | null): Promise<CommandResponse & { carried: (RelicType | null)[] }> =>
    post('/relic/carry', { slot, type }),
  /** Buy battle items. The server clamps to the pouch and to the purse. */
  buyItem: (type: ItemType, count = 1): Promise<CommandResponse & { type: ItemType; count: number }> =>
    post('/item/buy', { type, count }),

  quests: (): Promise<{
    quests: {
      id: string; name: string; detail: string; goal: number;
      reward: { g: number; i: number }; progress: number; claimed: boolean;
    }[];
  }> => call('/quests'),

  claimQuest: (questId: string): Promise<CommandResponse & { reward: { g: number; i: number } }> =>
    post('/quests/claim', { questId }),

  daily: (): Promise<DailyView> => call('/quests/daily'),

  /* --- clan wars --- */

  war: (): Promise<WarView> => call('/war'),
  warSearch: (): Promise<{ ok: true }> => post('/war/search'),
  warChallenge: (clanId: string): Promise<{ ok: true; warId: string }> => post('/war/challenge', { clanId }),
  warRespond: (warId: string, accept: boolean): Promise<{ ok: true }> => post('/war/respond', { warId, accept }),
  warCancel: (warId: string): Promise<{ ok: true }> => post('/war/cancel', { warId }),
  /** Open a war attack. Same shape as a scouted raid, fought by the same code. */
  warAttack: (memberId: string): Promise<ScoutedRaid & { isPlayer: boolean; war: true; player: PlayerState }> =>
    post('/war/attack', { memberId }),
  warHistory: (): Promise<{ wars: WarHistoryRow[] }> => call('/war/history'),

  /* --- feedback --- */

  feedback: (body: string): Promise<{ ok: true }> => post('/feedback', { body }),

  /* --- clans --- */

  myClan: (): Promise<MyClanView> => call('/clan'),
  findClans: (q: string): Promise<{ clans: ClanSummary[] }> =>
    call(`/clans?q=${encodeURIComponent(q)}`),
  createClan: (
    body: { name: string; tag: string; description?: string; joinPolicy?: string; minTrophies?: number; badge?: number },
  ): Promise<{ clanId: string; player: PlayerState }> => post('/clans', body),
  joinClan: (clanId: string): Promise<{ state: 'joined' | 'requested' }> =>
    post('/clan/join', { clanId }),
  leaveClan: (): Promise<{ ok: true }> => post('/clan/leave'),
  kickFromClan: (playerId: string): Promise<{ ok: true }> => post('/clan/kick', { playerId }),
  setClanRole: (playerId: string, role: ClanRole): Promise<{ ok: true }> =>
    post('/clan/role', { playerId, role }),
  decideClanRequest: (playerId: string, accept: boolean): Promise<{ accepted: boolean }> =>
    post('/clan/requests/decide', { playerId, accept }),
  clanSettings: (
    body: { description?: string; joinPolicy?: string; minTrophies?: number; badge?: number },
  ): Promise<{ ok: true }> => post('/clan/settings', body),
  clanMessages: (after?: string): Promise<{ messages: ChatMessage[] }> =>
    call(`/clan/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`),
  sendClanMessage: (body: string): Promise<{ message: ChatMessage }> =>
    post('/clan/messages', { body }),
  deleteClanMessage: (messageId: string): Promise<{ ok: true }> =>
    post('/clan/messages/delete', { messageId }),
  clanLadder: (): Promise<{ top: ClanLadderRow[] }> => call('/leaderboard/clans'),

  claimDaily: (orderId: string): Promise<
    CommandResponse & {
      reward: { g: number; i: number };
      wasted: { gold: number; iron: number };
      daily: DailyView;
    }
  > => post('/quests/daily/claim', { orderId }),

  /** Open a raid straight back at whoever hit you. */
  revenge: (raidId: string): Promise<ScoutedRaid & { isPlayer: boolean; player: PlayerState }> =>
    post('/raid/revenge', { raidId }),

  leaderboard: (): Promise<{
    top: { id: string; name: string; trophies: number; keepLevel: number; rank: number; isMe: boolean }[];
    me: { id: string; name: string; trophies: number; keepLevel: number; rank: number } | null;
    total: number;
  }> => call('/leaderboard'),

  /** The running season: the countdown, the band, and the last payout. */
  season: (): Promise<SeasonState> => call('/season'),

  /** Why a hold fell: which side, what never fired, what was never found. */
  report: (raidId: string): Promise<BreachView> => call(`/raid/${raidId}/report`),

  /** Find a hold by the name somebody told you. Two letters minimum. */
  findPlayers: (q: string): Promise<{ players: PlayerHit[] }> =>
    call(`/players?q=${encodeURIComponent(q)}`),
  /** The page behind a name. Never a layout — that is what scouting is for. */
  player: (id: string): Promise<PlayerProfile> => call(`/player/${id}`),

  layouts: (): Promise<{
    layouts: { slot: LayoutSlot; name: string; saved: boolean; buildings: number; savedAt: string | null }[];
  }> => call('/layouts'),
  saveLayout: (slot: string, name?: string): Promise<{ ok: true; buildings: number }> =>
    post('/layouts/save', { slot, name }),
  applyLayout: (slot: string): Promise<CommandResponse & { moved: number; skipped: number }> =>
    post('/layouts/apply', { slot }),

  /** A drill against your own walls. Nothing is at stake. */
  defend: (): Promise<{
    seed: number;
    snapshot: ScoutedRaid['snapshot'];
    army: ScoutedRaid['army'];
    hero: ScoutedRaid['hero'];
    troopLevels: ScoutedRaid['troopLevels'];
    stage: number;
    player: PlayerState;
  }> => post('/defend'),

  rename: (name: string): Promise<{ ok: true; name: string }> => post('/account/name', { name }),
  deleteAccount: (confirmName: string): Promise<{ ok: true }> =>
    call('/account', { method: 'DELETE', body: JSON.stringify({ confirmName }) }),

  pushKey: (): Promise<{ available: boolean; key: string | null }> => call('/push/key'),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<{ ok: true }> =>
    post('/push/subscribe', sub),
  pushUnsubscribe: (endpoint: string): Promise<{ ok: true }> => post('/push/unsubscribe', { endpoint }),
  pushTest: (): Promise<{ ok: true; sent: number }> => post('/push/test'),

  incoming: (): Promise<{
    raids: {
      raidId: string;
      attacker: { id: string; name: string; trophies: number; keepLevel: number };
      stars: number;
      destroyedPct: number;
      lost: { g: number; i: number };
      trophyDelta: number;
      at: string;
      replayable: boolean;
      avengeable: boolean;
    }[];
  }> => call('/raids/incoming'),

  replay: (raidId: string): Promise<{
    raidId: string;
    seed: number;
    snapshot: ScoutedRaid['snapshot'];
    army: ScoutedRaid['army'];
    hero: ScoutedRaid['hero'];
    troopLevels: ScoutedRaid['troopLevels'];
    commands: DeployCommand[];
    attackerName: string;
    stars: number;
  }> => call(`/raid/${raidId}/replay`),
};
