import type { BuildingType, QuestCounter, TroopType } from '@ironvow/config';
import type { BaseSnapshot, BattleArmy, DeployCommand, HeroLoadout, TroopLevels } from '@ironvow/types';

/** A building on the player's own base, as the server reports it. */
export interface ClientBuilding {
  id: string;
  type: BuildingType;
  gx: number;
  gy: number;
  level: number;
  stock: number;
  /** ISO timestamp while a builder is on it, null when idle. */
  completesAt: string | null;
  /** Level it becomes; null while a fresh build is still going up. */
  upgradingTo: number | null;
  /**
   * How long this job was, in seconds. Local only.
   *
   * The server sends a finish time, not a duration, so the client remembers the
   * length of a job it started itself. Without it a reloaded page can still show
   * a bar, just one that fills over whatever is left rather than the whole job.
   */
  jobSeconds?: number;
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
  /** Started with one tap and has not attached an email yet. */
  isGuest: boolean;
  gold: number;
  iron: number;
  trophies: number;
  keepLevel: number;
  shieldUntil: string | null;
  storageCap: number;
  buildersFree: number;
  buildersTotal: number;
  armyCap: number;
  armyUsed: number;
  army: Partial<Record<TroopType, number>>;
  buildings: ClientBuilding[];
  queue: ClientQueueJob[];
  /** War Order counters, incremented by the server. */
  counters: Partial<Record<QuestCounter, number>>;
  claimedQuests: string[];
  heroLevel: number;
  /** ISO timestamp, or null when the hero is ready. */
  heroReadyAt: string | null;
  troopLevels: Record<TroopType, number>;
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
  hero: HeroLoadout;
  troopLevels: TroopLevels;
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
