import type { BuildingType, ItemType, Pouch, TrapType, TroopType } from '@ironvow/config';

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
  /**
   * The defender's garrison, pre-placed.
   *
   * Troops their clan gave them, standing in the hold when a raid opens. Rolled
   * once on the server like `defendWave` and frozen here, so a replay puts them
   * in exactly the same places a year later.
   */
  garrison?: DefendWaveUnit[];
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

/**
 * Anything that can be put on the field.
 *
 * The hero is not a troop: it is not trained, costs no warband room, and there
 * is only ever one. Keeping it out of TroopType stops it leaking into training
 * queues and army counts, but a deploy command has to be able to name it.
 */
export type DeployableType = TroopType | 'hero';

/** One deploy, as submitted by the client. Intent only — never an outcome. */
export interface DeployCommand {
  /** Which simulation tick the deploy lands on. Must be non-decreasing across the list. */
  tickIndex: number;
  troopType: DeployableType;
  /** Deploy position in grid coordinates. Fractional; the sim does not round. */
  gx: number;
  gy: number;
}

/**
 * One battle item used, as submitted by the client.
 *
 * A separate list from the deploys rather than a variant inside it, for one
 * reason worth more than the tidiness: every raid recorded before items existed
 * has no `items` field at all, so it replays as a raid where none were used
 * without a migration and without a version check.
 */
export interface ItemCommand {
  /** Which simulation tick it lands on. Non-decreasing across the list. */
  tickIndex: number;
  item: ItemType;
  /** Where it was dropped, in grid coordinates. Fractional. */
  gx: number;
  gy: number;
}

/** The hero as it enters a battle. Frozen onto the raid, like the warband. */
export interface HeroLoadout {
  level: number;
  /** False while the hero is still recovering from the last raid. */
  available: boolean;
}

/** Per-troop lab levels, frozen onto the raid alongside the warband. */
export type TroopLevels = Partial<Record<TroopType, number>>;

export type BattleKind = 'raid' | 'defend';

/**
 * A warband as the simulation sees it.
 *
 * Keyed off TroopType rather than spelled out, so adding a troop is one edit
 * in `@ironvow/config` and not a hunt for every place the four were listed.
 */
export type BattleArmy = Record<TroopType, number>;

export interface SimInput {
  snapshot: BaseSnapshot;
  commands: readonly DeployCommand[];
  /** The army the attacker brought. Deploys beyond it are rejected, not clamped. */
  army: BattleArmy;
  seed: number;
  kind?: BattleKind;
  /** Omitted means the attacker fields no hero. */
  hero?: HeroLoadout;
  /** Omitted means every troop is at level 1. */
  troopLevels?: TroopLevels;
  /** Items used, in tick order. Omitted means none — which is every old raid. */
  items?: readonly ItemCommand[];
  /** What the attacker had to spend. Frozen onto the raid like the warband. */
  pouch?: Pouch;
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
  /** Whether the hero was deployed and fell. Drives the respawn timer. */
  heroDied: boolean;
  /** Whether the hero was committed at all. */
  heroDeployed: boolean;
  /** A hash over the result plus per-tick state, used to detect divergence. */
  checksum: string;
}

export interface RejectedCommand {
  index: number;
  reason:
    | 'noTroopsLeft'
    | 'outOfBounds'
    | 'tooCloseToStructure'
    | 'badTick'
    | 'unknownTroop'
    /** The hero is still recovering from the last raid. */
    | 'heroUnavailable'
    /** There is only ever one hero, and it is already on the field. */
    | 'heroAlreadyDeployed'
    /** The pouch did not have one, or had none left. */
    | 'noItemsLeft'
    | 'unknownItem';
}

/** Recorded state for the renderer. Produced only when the caller asks for it. */
export interface SimTimeline {
  events: TimelineEvent[];
}

export type TimelineEvent =
  | { t: number; k: 'spawn'; unit: number; type: DeployableType; x: number; y: number; side: 'atk' | 'def' }
  | { t: number; k: 'structDead'; struct: number }
  | { t: number; k: 'unitDead'; unit: number }
  | { t: number; k: 'shot'; from: 'unit' | 'struct'; src: number; x: number; y: number; tx: number; ty: number; kind: 'arrow' | 'ball' }
  | { t: number; k: 'hitStruct'; struct: number; dmg: number }
  | { t: number; k: 'hitUnit'; unit: number; dmg: number }
  | { t: number; k: 'item'; item: ItemType; x: number; y: number; r: number }
  | { t: number; k: 'trap'; trap: number; item: TrapType; x: number; y: number; r: number };

/** What the client is allowed to send when it finishes a raid. */
export interface RaidSubmission {
  raidId: string;
  commands: DeployCommand[];
  /** Absent from a client that used none, and from every client built before items. */
  items?: ItemCommand[];
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
