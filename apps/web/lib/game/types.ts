import type { BuildingType, TroopType } from '@ironvow/config';
import type { BaseSnapshot, BattleArmy, DeployCommand } from '@ironvow/types';

/** A building on the player's own base, as the server reports it. */
export interface ClientBuilding {
  id: string;
  type: BuildingType;
  gx: number;
  gy: number;
  level: number;
  stock: number;
  /** Local-only: scale pop after a place or a collect. Never sent anywhere. */
  bump?: number;
}

export interface ClientQueueJob {
  id: string;
  type: TroopType;
  finishesAt: string;
  position: number;
}

export interface PlayerState {
  id: string;
  name: string;
  gold: number;
  iron: number;
  trophies: number;
  keepLevel: number;
  shieldUntil: string | null;
  storageCap: number;
  armyCap: number;
  armyUsed: number;
  army: Partial<Record<TroopType, number>>;
  buildings: ClientBuilding[];
  queue: ClientQueueJob[];
  serverTime: string;
}

export type Mode = 'base' | 'place' | 'battle';

/** A building being placed or relocated. */
export interface Placement {
  type: BuildingType;
  gx: number;
  gy: number;
  ok: boolean;
  /** Set when relocating rather than buying. */
  movingId: string | null;
  fromX: number;
  fromY: number;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
}

export interface ScoutedRaid {
  raidId: string;
  seed: number;
  snapshot: BaseSnapshot;
  army: BattleArmy;
  expiresAt: string;
  rerollCost: number;
}

export interface BattleOutcome {
  stars: number;
  destroyedPct: number;
  loot: { g: number; i: number };
  trophyDelta: number;
  commands: DeployCommand[];
}
