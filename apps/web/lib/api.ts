import type { BuildingType, TroopType } from '@ironvow/config';
import type { DeployCommand } from '@ironvow/types';
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

export interface ClanLadderRow {
  id: string; name: string; tag: string; badge: number;
  memberCount: number; trophies: number; rank: number; isMine: boolean;
}

export const api = {
  me: (): Promise<PlayerState> => call('/me'),

  requestLogin: (email: string): Promise<{ ok: true }> => post('/auth/request', { email }),
  /** Start playing immediately, with no email. */
  guest: (): Promise<{ ok: true; playerId: string; name?: string }> => post('/auth/guest'),
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
  }> => post(`/raid/${raidId}/submit`, { commands, clientChecksum, clientStars }),

  progression: (): Promise<{
    hero: {
      name: string; level: number; maxLevel: number; unlockKeepLevel: number;
      unlocked: boolean; stats: { hp: number; dmg: number; cd: number; spd: number; rng: number };
      upgradeCost: { g: number; i: number }; readyAt: string | null; respawnMinutes: number;
    };
    lab: {
      level: number;
      troops: { type: TroopType; level: number; power: number; upgradeCost: { g: number; i: number } }[];
    };
  }> => call('/progression'),

  upgradeHero: (): Promise<CommandResponse & { toLevel: number }> => post('/hero/upgrade'),
  upgradeTroop: (type: TroopType): Promise<CommandResponse & { toLevel: number }> =>
    post('/troop/upgrade', { type }),

  quests: (): Promise<{
    quests: {
      id: string; name: string; detail: string; goal: number;
      reward: { g: number; i: number }; progress: number; claimed: boolean;
    }[];
  }> => call('/quests'),

  claimQuest: (questId: string): Promise<CommandResponse & { reward: { g: number; i: number } }> =>
    post('/quests/claim', { questId }),

  daily: (): Promise<DailyView> => call('/quests/daily'),

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

  layouts: (): Promise<{
    layouts: { slot: 'defence' | 'farming'; name: string; saved: boolean; buildings: number; savedAt: string | null }[];
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
