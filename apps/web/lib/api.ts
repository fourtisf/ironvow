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
  move: (buildingId: string, gx: number, gy: number): Promise<CommandResponse> =>
    post('/move', { buildingId, gx, gy }),
  collect: (buildingId?: string): Promise<CommandResponse & {
    collected: { gold: number; iron: number };
    wasted: { gold: number; iron: number };
  }> => post('/collect', buildingId ? { buildingId } : {}),
  train: (type: TroopType, count = 1): Promise<CommandResponse & { queued: number }> =>
    post('/train', { type, count }),

  findRaid: (reroll = false): Promise<ScoutedRaid & { player: PlayerState }> =>
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
