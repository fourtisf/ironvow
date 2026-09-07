import type { BuildingType, DailyCounter, TroopType } from '@ironvow/config';
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
  /** Inside BUILD: the card to light up. */
  buildType?: BuildingType;
  /** Inside ARMY: the troop to light up. */
  troopType?: TroopType;
  /** One line shown at the top of the sheet the objective sent the player into. */
  hint?: string;
}

export interface TutorialStep {
  id: string;
  title: string;
  text: string;
  target: CoachTarget;
  go: CoachGo;
  goLabel: string;
}

/**
 * Each step names one thing to do, and finishes itself the moment the player
 * does it: tap the Keep, move the camera, collect from the mine, move the
 * mine. The card never asks to be dismissed, only skipped.
 */
export const TUTORIAL: readonly TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Tap your Keep',
    text: 'The Keep in the middle is the heart of your hold. Tap it — the arrow is pointing at it — to see what it can do.',
    target: 'keep', go: 'keep', goLabel: 'SHOW ME',
  },
  {
    id: 'camera',
    title: 'Look around',
    text: 'Drag the ground to move about. Pinch, or scroll, to zoom. HOME brings you back to the Keep whenever you are lost.',
    target: 'home', go: null, goLabel: '',
  },
  {
    id: 'resources',
    title: 'Collect your gold',
    text: 'Your Gold Mine makes gold around the clock and holds it until you take it. Tap the pouch floating over it.',
    target: 'mine', go: 'collect', goLabel: 'COLLECT',
  },
  {
    id: 'move',
    title: 'Move your Gold Mine',
    text: 'Tap a building to select it, then drag it to a new spot and press DONE. Later, put defences where attackers must pass them.',
    target: 'mine', go: 'mine', goLabel: 'SELECT IT',
  },
];

/** Where each one-time War Order sends the player. */
const QUEST_GUIDE: Record<string, { target: CoachTarget; go: CoachGo; goLabel: string; how: string; buildType?: BuildingType; troopType?: TroopType; hint?: string }> = {
  q1:  { target: 'mine', go: 'collect', goLabel: 'COLLECT', how: 'Tap the pouch over the Gold Mine, or press COLLECT. Three times fills the order.' },
  q2:  { target: 'build', go: 'build', goLabel: 'OPEN BUILD', how: 'Open BUILD, pick Gold Mine, and drop it on free ground. PLACE confirms it.', buildType: 'mine', hint: 'Pick the Gold Mine, then drop it on free ground and press PLACE.' },
  q3:  { target: 'build', go: 'build', goLabel: 'OPEN BUILD', how: 'Open BUILD and place a Cannon near the Keep. It fires on anyone who raids you.', buildType: 'cannon', hint: 'Pick the Cannon and put it near the Keep.' },
  q4:  { target: 'army', go: 'army', goLabel: 'OPEN ARMY', how: 'Open ARMY and train five Raiders. Training takes a moment; they wait in the Barracks.', troopType: 'raider', hint: 'Tap TRAIN on the Raider five times.' },
  q5:  { target: 'raid', go: 'raid', goLabel: 'FIND A RAID', how: 'Press RAID, look the hold over, press ATTACK, then tap the ground to drop troops. Half the hold broken is a win.' },
  q6:  { target: 'keep', go: 'keep', goLabel: 'SELECT KEEP', how: 'Select the Keep and press UPGRADE. A higher Keep unlocks more of everything.' },
  q7:  { target: 'build', go: 'build', goLabel: 'OPEN BUILD', how: 'Open BUILD and place an Iron Forge. It is the only thing that makes iron, and everything after this needs some. It costs gold alone.', buildType: 'forge', hint: 'Pick the Iron Forge and drop it on free ground.' },
  q8:  { target: 'build', go: 'build', goLabel: 'OPEN BUILD', how: 'Open BUILD and lay Ramparts in a ring inside your cannon’s range. Placing one offers the next straight away.', buildType: 'wall', hint: 'Pick the Rampart. After each PLACE the next one is already in your hand.' },
  q9:  { target: 'raid', go: 'raid', goLabel: 'FIND A RAID', how: 'Bring a full warband and take every building down. Rams on walls, archers behind.' },
  q10: { target: 'raid', go: 'raid', goLabel: 'FIND A RAID', how: 'Every win earns trophies; losses cost some. Keep raiding to climb.' },
  q11: { target: 'keep', go: 'keep', goLabel: 'SELECT KEEP', how: 'Raise the Keep to level 4. Towers and rams open up on the way.' },
  q13: { target: 'build', go: 'build', goLabel: 'OPEN BUILD', how: 'Open BUILD and raise a War Lab. Once it stands, ARMY gains a row per troop: every level is +12% damage and hit points, kept for good.', buildType: 'lab', hint: 'Pick the War Lab. Afterwards, upgrade your troops in ARMY.' },
  q12: { target: 'raid', go: 'raid', goLabel: 'FIND A RAID', how: 'Fifteen wins. Scout each hold before you commit.' },
};

/** Where each kind of daily order sends the player. */
const DAILY_GUIDE: Record<DailyCounter, { target: CoachTarget; go: CoachGo; goLabel: string; how: string; troopType?: TroopType; hint?: string }> = {
  dayCollected:  { target: 'producers', go: 'collect', goLabel: 'COLLECT', how: 'Every COLLECT from a mine or forge counts once. Come back through the day as they fill.' },
  dayTrained:    { target: 'army', go: 'army', goLabel: 'OPEN ARMY', how: 'Open ARMY and train troops. Any kind counts.', troopType: 'raider', hint: 'Tap TRAIN on any troop. Each one counts.' },
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
      buildType: claimable ? undefined : guide.buildType,
      troopType: claimable ? undefined : guide.troopType,
      hint: claimable ? undefined : guide.hint,
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
      troopType: claimable ? undefined : ('troopType' in guide ? guide.troopType : undefined),
      hint: claimable ? undefined : ('hint' in guide ? guide.hint : undefined),
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
