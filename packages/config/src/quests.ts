import { TYPES, type BuildingType } from './buildings.js';
import { countOf, keepLevelOf, type OwnedBuilding } from './economy.js';
import { TROOP, TROOP_ORDER } from './troops.js';

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

/*
 * Order matters, and it was wrong.
 *
 * Iron has exactly one source a player can build: the Iron Forge. Nothing
 * else in a new hold makes any. The Forge used to be the seventh order while
 * the third asked for a Cannon, which costs 80 iron — so a player who had
 * spent their opening iron was told to build something they could not afford,
 * and the reward for building it was iron. ALFA hit that with 20 iron left and
 * a Cannon on the task list.
 *
 * The Forge is third now, before anything asks for iron at all. It costs gold
 * only, which is what makes it the way out of an empty iron purse — asserted
 * in the tests, because a future price change could quietly close that door.
 *
 * The ids stay attached to their own order rather than to a position: a
 * player's claimed orders are stored by id, and renumbering them would hand
 * someone a reward they had already taken. The list is displayed and counted
 * in array order, so moving an entry is all that is needed.
 */
export const QUESTS: readonly Quest[] = [
  { id: 'q1',  n: 'Collect from the mine',    d: 'Tap the pouch floating over your Gold Mine.',   goal: 3,   metric: { kind: 'counter', name: 'collected' },        reward: { g: 200,  i: 0 } },
  { id: 'q2',  n: 'Build a second mine',      d: 'More mines, more gold while you sleep.',        goal: 2,   metric: { kind: 'buildingCount', type: 'mine' },       reward: { g: 250,  i: 0 } },
  { id: 'q7',  n: 'Build an Iron Forge',      d: 'Your only source of iron. Costs gold alone.',   goal: 1,   metric: { kind: 'buildingCount', type: 'forge' },      reward: { g: 200,  i: 600 } },
  { id: 'q3',  n: 'Raise a Cannon',           d: 'Defences fire on anyone who raids you.',        goal: 1,   metric: { kind: 'buildingCount', type: 'cannon' },     reward: { g: 200,  i: 200 } },
  { id: 'q4',  n: 'Train 5 Raiders',          d: 'Open ARMY and queue up your first warband.',    goal: 5,   metric: { kind: 'counter', name: 'trainedTotal' },     reward: { g: 300,  i: 0 } },
  { id: 'q5',  n: 'Win your first raid',      d: 'Hit RAID and take an enemy hold apart.',        goal: 1,   metric: { kind: 'counter', name: 'wins' },            reward: { g: 500,  i: 300 } },
  { id: 'q6',  n: 'Keep to level 2',          d: 'Select the Keep and upgrade it.',               goal: 2,   metric: { kind: 'keepLevel' },                        reward: { g: 600,  i: 400 } },
  { id: 'q8',  n: 'Lay 8 Ramparts',           d: 'Walls stall attackers inside cannon range.',    goal: 8,   metric: { kind: 'buildingCount', type: 'wall' },       reward: { g: 400,  i: 300 } },
  { id: 'q9',  n: 'Earn 3 stars in one raid', d: 'Flatten an entire enemy hold.',                 goal: 1,   metric: { kind: 'counter', name: 'threeStars' },       reward: { g: 800,  i: 600 } },
  { id: 'q10', n: 'Reach 200 trophies',       d: 'Keep raiding to climb.',                        goal: 200, metric: { kind: 'trophies' },                         reward: { g: 1200, i: 1000 } },
  { id: 'q11', n: 'Keep to level 4',          d: 'A bigger Keep unlocks towers and rams.',        goal: 4,   metric: { kind: 'keepLevel' },                        reward: { g: 1600, i: 1400 } },
  /*
   * ALFA: "saya ingin armya juga bisa upgrade naik level".
   *
   * It already can, and that was the problem: the War Lab has been in the game
   * since the day troop levels were added, no order has ever pointed at it, and
   * the ARMY screen's only mention of it was a grey line saying one would be
   * nice. A feature nobody is told about is a feature nobody has. It sits after
   * the Keep 4 order because the Lab needs Keep 3 — an order a player cannot
   * yet act on is worse than no order.
   */
  { id: 'q13', n: 'Raise a War Lab',          d: 'Troop levels: every one is +12% damage and hit points, for good.', goal: 1, metric: { kind: 'buildingCount', type: 'lab' }, reward: { g: 1400, i: 900 } },
  { id: 'q12', n: 'Win 15 raids',             d: 'Become the terror of the valley.',              goal: 15,  metric: { kind: 'counter', name: 'wins' },            reward: { g: 2500, i: 2400 } },
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

/*
 * The order a player can afford.
 *
 * Iron has one buildable source — the Iron Forge — so nothing may ask for iron
 * before the order that puts one up. Derived from the price tables rather than
 * listed here, because the failure comes from the two tables disagreeing and a
 * hand-written list would just be a third thing to keep in step.
 *
 * Asserted at module load. The failure it prevents is a player being told to
 * build something they have no way to pay for, which is what shipped: a Cannon
 * at 80 iron as the third order, with the Forge seventh, and a reward of iron
 * for completing it.
 */
function ironNeededBy(quest: Quest): number {
  const m = quest.metric;
  if (m.kind === 'buildingCount') return TYPES[m.type].base.i;
  // Raising the Keep costs iron from the very first level.
  if (m.kind === 'keepLevel') return TYPES.keep.up.i;
  // Training is measured in troops, and the cheapest one is what a player
  // short of iron would reach for.
  if (m.kind === 'counter' && m.name === 'trainedTotal') {
    return Math.min(...TROOP_ORDER.map((t) => TROOP[t].cost.i));
  }
  return 0;
}

const forgeAt = QUESTS.findIndex(
  (q) => q.metric.kind === 'buildingCount' && q.metric.type === 'forge',
);
const firstIronAt = QUESTS.findIndex((q) => ironNeededBy(q) > 0);

if (forgeAt < 0) {
  throw new Error('No War Order builds an Iron Forge, which is the only source of iron.');
}
if (firstIronAt >= 0 && firstIronAt < forgeAt) {
  const q = QUESTS[firstIronAt];
  throw new Error(
    `War Order ${firstIronAt + 1} ("${q?.n}") needs ${q ? ironNeededBy(q) : 0} iron, but the `
    + `Iron Forge is only order ${forgeAt + 1}. Iron has no other buildable source, so a `
    + 'player who has spent theirs would be told to buy something they cannot afford.',
  );
}
if (TYPES.forge.base.i > 0) {
  throw new Error(
    'The Iron Forge costs iron. It is the only way out of an empty iron purse, so it '
    + 'must be payable in gold alone.',
  );
}
