import type { DailyCounter } from '@ironvow/config';
import { DAILY_POOL } from '@ironvow/config';
import type { DailyView } from '../api';
import type { QuestRow } from '../../components/QuestSheet';

/**
 * The guide.
 *
 * One objective at a time, always: the next tutorial step, then the next
 * War Order, then the next of today's orders. Each carries what to do, where
 * to do it, and a button that takes the player there — so nobody has to work
 * out what the game wants from them, and finishing an order is one tap from
 * seeing it done. The tutorial lives on the client; everything after it is
 * read from the server's own progress numbers.
 */

/** Something on screen the guide can point at. */
export type CoachTarget =
  | 'build' | 'army' | 'orders' | 'raid' | 'log' | 'home'
  | 'keep' | 'mine' | 'producers'
  | null;

/** What the GO button does. */
export type CoachGo = 'build' | 'army' | 'raid' | 'keep' | 'mine' | 'collect' | 'orders' | null;

export interface Objective {
  kind: 'tutorial' | 'quest' | 'daily' | 'rest';
  id: string;
  /** Small label above the title: WELCOME, WAR ORDER 3 OF 12, TODAY 1 OF 3. */
  label: string;
  title: string;
  text: string;
  progress: number;
  goal: number;
  /** The server says this one is finished and can be claimed. */
  claimable: boolean;
  target: CoachTarget;
  go: CoachGo;
  goLabel: string;
}

export interface TutorialStep {
  id: string;
  title: string;
  text: string;
  target: CoachTarget;
  go: CoachGo;
  goLabel: string;
}

export const TUTORIAL: readonly TutorialStep[] = [
  {
    id: 'welcome',
    title: 'This is your hold',
    text: 'The Keep in the middle is its heart. Everything you build sits on the plateau around it, and it all keeps working on the server while you are away.',
    target: 'keep', go: 'keep', goLabel: 'SHOW ME',
  },
  {
    id: 'camera',
    title: 'Looking around',
    text: 'Drag the ground to pan. Pinch, or scroll, to zoom. The HOME button brings you back to the Keep whenever you are lost.',
    target: 'home', go: null, goLabel: '',
  },
  {
    id: 'resources',
    title: 'Gold and iron',
    text: 'Gold pays for buildings and troops; iron for the heavier ones. Mines and forges make them around the clock, and hold them until you collect.',
    target: 'mine', go: 'mine', goLabel: 'SHOW ME',
  },
  {
    id: 'move',
    title: 'Arrange your hold',
    text: 'Tap a building to select it, then drag it to move it. Put defences where attackers must pass them. Try moving your Gold Mine now.',
    target: 'mine', go: 'mine', goLabel: 'SHOW ME',
  },
];

/** Where each one-time War Order sends the player. */
const QUEST_GUIDE: Record<string, { target: CoachTarget; go: CoachGo; goLabel: string; how: string }> = {
  q1:  { target: 'mine', go: 'collect', goLabel: 'COLLECT', how: 'Tap the pouch over the Gold Mine, or press COLLECT. Three times fills the order.' },
  q2:  { target: 'build', go: 'build', goLabel: 'OPEN BUILD', how: 'Open BUILD, pick Gold Mine, and drop it on free ground. PLACE confirms it.' },
  q3:  { target: 'build', go: 'build', goLabel: 'OPEN BUILD', how: 'Open BUILD and place a Cannon near the Keep. It fires on anyone who raids you.' },
  q4:  { target: 'army', go: 'army', goLabel: 'OPEN ARMY', how: 'Open ARMY and train five Raiders. Training takes a moment; they wait in the Barracks.' },
  q5:  { target: 'raid', go: 'raid', goLabel: 'FIND A RAID', how: 'Press RAID, look the hold over, press ATTACK, then tap the ground to drop troops. Half the hold broken is a win.' },
  q6:  { target: 'keep', go: 'keep', goLabel: 'SELECT KEEP', how: 'Select the Keep and press UPGRADE. A higher Keep unlocks more of everything.' },
  q7:  { target: 'build', go: 'build', goLabel: 'OPEN BUILD', how: 'Open BUILD and place an Iron Forge. Archers and rams cost iron.' },
  q8:  { target: 'build', go: 'build', goLabel: 'OPEN BUILD', how: 'Open BUILD and lay Ramparts in a ring inside your cannon’s range. Placing one offers the next straight away.' },
  q9:  { target: 'raid', go: 'raid', goLabel: 'FIND A RAID', how: 'Bring a full warband and take every building down. Rams on walls, archers behind.' },
  q10: { target: 'raid', go: 'raid', goLabel: 'FIND A RAID', how: 'Every win earns trophies; losses cost some. Keep raiding to climb.' },
  q11: { target: 'keep', go: 'keep', goLabel: 'SELECT KEEP', how: 'Raise the Keep to level 4. Towers and rams open up on the way.' },
  q12: { target: 'raid', go: 'raid', goLabel: 'FIND A RAID', how: 'Fifteen wins. Scout each hold before you commit.' },
};

/** Where each kind of daily order sends the player. */
const DAILY_GUIDE: Record<DailyCounter, { target: CoachTarget; go: CoachGo; goLabel: string; how: string }> = {
  dayCollected:  { target: 'producers', go: 'collect', goLabel: 'COLLECT', how: 'Every COLLECT from a mine or forge counts once. Come back through the day as they fill.' },
  dayTrained:    { target: 'army', go: 'army', goLabel: 'OPEN ARMY', how: 'Open ARMY and train troops. Any kind counts.' },
  dayRaids:      { target: 'raid', go: 'raid', goLabel: 'FIND A RAID', how: 'Launching a raid counts whether or not you win it.' },
  dayWins:       { target: 'raid', go: 'raid', goLabel: 'FIND A RAID', how: 'Break at least half a hold, or its Keep, to win.' },
  dayStars:      { target: 'raid', go: 'raid', goLabel: 'FIND A RAID', how: 'One star for half the hold, one for the Keep, one for all of it. They add up across raids.' },
  dayThreeStars: { target: 'raid', go: 'raid', goLabel: 'FIND A RAID', how: 'Take every building down in one raid. Bring a full warband.' },
  dayLootGold:   { target: 'raid', go: 'raid', goLabel: 'FIND A RAID', how: 'Gold carried off from raids adds up. Vaults and mines are where it is.' },
  dayUpgrades:   { target: 'build', go: 'keep', goLabel: 'SELECT KEEP', how: 'Select any building and press UPGRADE; it counts when the builder finishes.' },
};

export interface CoachInput {
  /** Tutorial step ids the player has finished. */
  tutorialDone: readonly string[];
  quests: readonly QuestRow[];
  daily: DailyView | null;
}

/** The one thing the guide is asking for right now. */
export function nextObjective(input: CoachInput): Objective {
  const step = TUTORIAL.find((s) => !input.tutorialDone.includes(s.id));
  if (step) {
    const index = TUTORIAL.indexOf(step);
    return {
      kind: 'tutorial', id: step.id,
      label: `GETTING STARTED · ${index + 1} OF ${TUTORIAL.length}`,
      title: step.title, text: step.text,
      progress: 0, goal: 0, claimable: false,
      target: step.target, go: step.go, goLabel: step.goLabel,
    };
  }

  const quest = input.quests.find((q) => !q.claimed);
  if (quest) {
    const guide = QUEST_GUIDE[quest.id] ?? { target: 'orders' as const, go: 'orders' as const, goLabel: 'OPEN ORDERS', how: quest.detail };
    const claimable = quest.progress >= quest.goal;
    const index = input.quests.indexOf(quest);
    return {
      kind: 'quest', id: quest.id,
      label: `WAR ORDER · ${index + 1} OF ${input.quests.length}`,
      title: quest.name,
      text: claimable ? `Done. Claim ${rewardLine(quest.reward)}.` : guide.how,
      progress: Math.min(quest.progress, quest.goal), goal: quest.goal, claimable,
      target: claimable ? 'orders' : guide.target, go: claimable ? null : guide.go, goLabel: guide.goLabel,
    };
  }

  const today = input.daily;
  const order = today?.orders.find((o) => !o.claimed);
  if (today && order) {
    const def = DAILY_POOL.find((d) => d.id === order.id);
    const guide = def ? DAILY_GUIDE[def.counter] : { target: 'orders' as const, go: 'orders' as const, goLabel: 'OPEN ORDERS', how: order.detail };
    const claimable = order.progress >= order.goal;
    const index = today.orders.indexOf(order);
    return {
      kind: 'daily', id: order.id,
      label: `TODAY · ${index + 1} OF ${today.orders.length}${today.streak > 1 ? ` · 🔥 ${today.streak} DAYS` : ''}`,
      title: order.name,
      text: claimable ? `Done. Claim ${rewardLine(order.reward)}.` : guide.how,
      progress: Math.min(order.progress, order.goal), goal: order.goal, claimable,
      target: claimable ? 'orders' : guide.target, go: claimable ? null : guide.go, goLabel: guide.goLabel,
    };
  }

  return {
    kind: 'rest', id: 'rest',
    label: today && today.streak > 1 ? `🔥 ${today.streak} DAY STREAK` : 'ALL ORDERS DONE',
    title: 'Nothing owed today',
    text: today
      ? `New orders in ${untilText(today.resetsInMs)}. Until then: raid for trophies, or raise the Keep.`
      : 'Raid for trophies, or raise the Keep.',
    progress: 0, goal: 0, claimable: false,
    target: null, go: 'raid', goLabel: 'FIND A RAID',
  };
}

function rewardLine(r: { g: number; i: number }): string {
  const parts: string[] = [];
  if (r.g > 0) parts.push(`${r.g.toLocaleString()} gold`);
  if (r.i > 0) parts.push(`${r.i.toLocaleString()} iron`);
  return parts.join(' and ');
}

function untilText(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}

/** Where the GO button on an orders-sheet row takes the player. */
export function goFor(kind: 'quest' | 'daily', id: string): CoachGo {
  if (kind === 'quest') return QUEST_GUIDE[id]?.go ?? 'orders';
  const def = DAILY_POOL.find((d) => d.id === id);
  return def ? DAILY_GUIDE[def.counter].go : 'orders';
}

/* --- persistence: the tutorial is the client's to remember --------------- */

const KEY = (playerId: string): string => `ironvow_tutorial_${playerId}`;

export function loadTutorial(playerId: string): string[] {
  try {
    const raw = localStorage.getItem(KEY(playerId));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveTutorial(playerId: string, done: readonly string[]): void {
  try {
    localStorage.setItem(KEY(playerId), JSON.stringify(done));
  } catch {
    // It will simply ask again next time.
  }
}
