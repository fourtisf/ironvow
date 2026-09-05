import type { BuildingType, TroopType } from '@ironvow/config';

/** A building as it exists on a live base. */
export interface BuildingState {
  id: string;
  type: BuildingType;
  gx: number;
  gy: number;
  level: number;
  /** Uncollected production. */
  stock: number;
}

/**
 * The frozen copy of a defender's base that a raid is fought against.
 *
 * Once written to the Raid row this never changes, so the defender rebuilding
 * mid-raid cannot alter a battle already in flight, and a replay months later
 * reproduces the same result.
 */
export interface BaseSnapshot {
  /** Snapshot format version. Bump when the shape changes so old raids stay replayable. */
  version: 1;
  defenderId: string;
  defenderName: string;
  keepLevel: number;
  buildings: SnapshotBuilding[];
  /** Total loot on the table, split evenly across non-wall structures. */
  pool: { g: number; i: number };
  /**
   * Pre-rolled attacking wave for a defend battle.
   *
   * Spawn positions are rolled once on the server, where trigonometry is free
   * to be engine-dependent, and frozen here. The simulation itself then never
   * touches sin or cos, which is what keeps a defend replay identical between
   * Node and a browser.
   */
  defendWave?: DefendWaveUnit[];
}

export interface DefendWaveUnit {
  type: TroopType;
  x: number;
  y: number;
  /** Stat multiplier applied to hp and damage. */
  scale: number;
}

export interface SnapshotBuilding {
  id: string;
  type: BuildingType;
  gx: number;
  gy: number;
  level: number;
}

/** One deploy, as submitted by the client. Intent only — never an outcome. */
export interface DeployCommand {
  /** Which simulation tick the deploy lands on. Must be non-decreasing across the list. */
  tickIndex: number;
  troopType: TroopType;
  /** Deploy position in grid coordinates. Fractional; the sim does not round. */
  gx: number;
  gy: number;
}

export type BattleKind = 'raid' | 'defend';

export interface BattleArmy {
  raider: number;
  archer: number;
  lancer: number;
  ram: number;
}

export interface SimInput {
  snapshot: BaseSnapshot;
  commands: readonly DeployCommand[];
  /** The army the attacker brought. Deploys beyond it are rejected, not clamped. */
  army: BattleArmy;
  seed: number;
  kind?: BattleKind;
}

export interface SimResult {
  stars: number;
  /** 0..1, share of total structure hit points destroyed. */
  destroyedPct: number;
  loot: { g: number; i: number };
  /** Ticks actually simulated before an end condition fired. */
  ticks: number;
  /** Why the battle stopped. */
  endedBy: 'wiped' | 'timeout' | 'exhausted' | 'keepFell';
  /** Deploys the simulation refused, with a reason. An honest client produces none. */
  rejected: RejectedCommand[];
  /** A hash over the result plus per-tick state, used to detect divergence. */
  checksum: string;
}

export interface RejectedCommand {
  index: number;
  reason: 'noTroopsLeft' | 'outOfBounds' | 'tooCloseToStructure' | 'badTick' | 'unknownTroop';
}

/** Recorded state for the renderer. Produced only when the caller asks for it. */
export interface SimTimeline {
  events: TimelineEvent[];
}

export type TimelineEvent =
  | { t: number; k: 'spawn'; unit: number; type: TroopType; x: number; y: number; side: 'atk' | 'def' }
  | { t: number; k: 'structDead'; struct: number }
  | { t: number; k: 'unitDead'; unit: number }
  | { t: number; k: 'shot'; from: 'unit' | 'struct'; src: number; x: number; y: number; tx: number; ty: number; kind: 'arrow' | 'ball' }
  | { t: number; k: 'hitStruct'; struct: number; dmg: number }
  | { t: number; k: 'hitUnit'; unit: number; dmg: number };

/** What the client is allowed to send when it finishes a raid. */
export interface RaidSubmission {
  raidId: string;
  commands: DeployCommand[];
}

/** Public view of a player, safe to send to another player. */
export interface PublicPlayer {
  id: string;
  name: string;
  trophies: number;
  keepLevel: number;
}

export interface ScoutView {
  raidId: string;
  defender: PublicPlayer;
  snapshot: BaseSnapshot;
  availableLoot: { g: number; i: number };
  expiresAt: string;
}
