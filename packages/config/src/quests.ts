import type { BuildingType } from './buildings.js';
import { countOf, keepLevelOf, type OwnedBuilding } from './economy.js';

/**
 * War Orders.
 *
 * Ported from the prototype, where they were the closest thing to a tutorial:
 * the first order is "tap the pouch over your Gold Mine", which teaches the
 * core interaction without a single line of instructional text. A new player
 * with no orders is a new player with nothing to do.
 *
 * The prototype read its progress out of local state. Here every metric is
 * derived from what the server already knows, so progress cannot be claimed
 * by a client that simply says it is finished.
 */

export type QuestMetric =
  /** A running total the server increments as things happen. */
  | { kind: 'counter'; name: QuestCounter }
  /** How many of a building type the player owns right now. */
  | { kind: 'buildingCount'; type: BuildingType }
  | { kind: 'keepLevel' }
  | { kind: 'trophies' };

export type QuestCounter = 'collected' | 'trainedTotal' | 'wins' | 'threeStars';

export const QUEST_COUNTERS: readonly QuestCounter[] = [
  'collected', 'trainedTotal', 'wins', 'threeStars',
];

export interface Quest {
  id: string;
  /** Short name, shown as the row heading. */
  n: string;
  /** One line telling the player exactly what to do. */
  d: string;
  goal: number;
  metric: QuestMetric;
  reward: { g: number; i: number };
}

export const QUESTS: readonly Quest[] = [
  { id: 'q1',  n: 'Collect from the mine',    d: 'Tap the pouch floating over your Gold Mine.',   goal: 3,   metric: { kind: 'counter', name: 'collected' },        reward: { g: 200,  i: 0 } },
  { id: 'q2',  n: 'Build a second mine',      d: 'More mines, more gold while you sleep.',        goal: 2,   metric: { kind: 'buildingCount', type: 'mine' },       reward: { g: 250,  i: 0 } },
  { id: 'q3',  n: 'Raise a Cannon',           d: 'Defences fire on anyone who raids you.',        goal: 1,   metric: { kind: 'buildingCount', type: 'cannon' },     reward: { g: 200,  i: 80 } },
  { id: 'q4',  n: 'Train 5 Raiders',          d: 'Open ARMY and queue up your first warband.',    goal: 5,   metric: { kind: 'counter', name: 'trainedTotal' },     reward: { g: 300,  i: 0 } },
  { id: 'q5',  n: 'Win your first raid',      d: 'Hit RAID and take an enemy hold apart.',        goal: 1,   metric: { kind: 'counter', name: 'wins' },            reward: { g: 500,  i: 150 } },
  { id: 'q6',  n: 'Keep to level 2',          d: 'Select the Keep and upgrade it.',               goal: 2,   metric: { kind: 'keepLevel' },                        reward: { g: 600,  i: 200 } },
  { id: 'q7',  n: 'Build an Iron Forge',      d: 'Archers and rams need iron.',                   goal: 1,   metric: { kind: 'buildingCount', type: 'forge' },      reward: { g: 0,    i: 250 } },
  { id: 'q8',  n: 'Lay 8 Ramparts',           d: 'Walls stall attackers inside cannon range.',    goal: 8,   metric: { kind: 'buildingCount', type: 'wall' },       reward: { g: 400,  i: 120 } },
  { id: 'q9',  n: 'Earn 3 stars in one raid', d: 'Flatten an entire enemy hold.',                 goal: 1,   metric: { kind: 'counter', name: 'threeStars' },       reward: { g: 800,  i: 300 } },
  { id: 'q10', n: 'Reach 200 trophies',       d: 'Keep raiding to climb.',                        goal: 200, metric: { kind: 'trophies' },                         reward: { g: 1200, i: 500 } },
  { id: 'q11', n: 'Keep to level 4',          d: 'A bigger Keep unlocks towers and rams.',        goal: 4,   metric: { kind: 'keepLevel' },                        reward: { g: 1600, i: 700 } },
  { id: 'q12', n: 'Win 15 raids',             d: 'Become the terror of the valley.',              goal: 15,  metric: { kind: 'counter', name: 'wins' },            reward: { g: 2500, i: 1200 } },
];

export function questById(id: string): Quest | undefined {
  return QUESTS.find((q) => q.id === id);
}

/** Everything a quest can be measured against. */
export interface QuestSubject {
  counters: Partial<Record<QuestCounter, number>>;
  buildings: readonly OwnedBuilding[];
  trophies: number;
}

/**
 * How far along a quest is.
 *
 * One function, used by the client to draw the progress bar and by the server
 * to decide whether a claim is allowed. If those two ever disagreed, the bar
 * would fill and the CLAIM button would be refused.
 */
export function questProgress(quest: Quest, subject: QuestSubject): number {
  const m = quest.metric;
  switch (m.kind) {
    case 'counter':
      return subject.counters[m.name] ?? 0;
    case 'buildingCount':
      return countOf(subject.buildings, m.type);
    case 'keepLevel':
      return keepLevelOf(subject.buildings);
    case 'trophies':
      return subject.trophies;
  }
}

export function isQuestComplete(quest: Quest, subject: QuestSubject): boolean {
  return questProgress(quest, subject) >= quest.goal;
}

/** The first unclaimed order, which is what the rail's notification dot tracks. */
export function nextQuest(claimed: readonly string[]): Quest | undefined {
  return QUESTS.find((q) => !claimed.includes(q.id));
}

/** True when any unclaimed order is ready, so the dot only shows when it means something. */
export function hasClaimableQuest(claimed: readonly string[], subject: QuestSubject): boolean {
  return QUESTS.some((q) => !claimed.includes(q.id) && isQuestComplete(q, subject));
}
