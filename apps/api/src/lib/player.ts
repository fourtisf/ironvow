import {
  DAILY_COUNTERS,
  QUEST_COUNTERS,
  dayIndexOf,
  type DailyCounter,
  buildersFree,
  isUnderConstruction,
  START_GOLD,
  START_IRON,
  TROOP_ORDER,
  type QuestCounter,
  armyCapOf,
  armyUsedOf,
  bestBarracksLevel,
  keepLevelOf,
  storageCapOf,
  type BuildingType,
  type TroopType,
} from '@ironvow/config';
import { Prisma } from '@prisma/client';
import { accrueProduction } from '../domain/production.js';
import { resolveQueue } from '../domain/queue.js';
import type { OwnedBuildingRow, PlayerView } from '../domain/commands.js';
import { prisma, type Tx } from './prisma.js';

/**
 * Loading a player is a settlement, not a read.
 *
 * Production accrued and training that finished while nobody was looking are
 * both applied here, so every route sees the same already-current state and no
 * route has to remember to tick anything.
 */

export interface LoadedPlayer extends PlayerView {
  id: string;
  name: string;
  isGuest: boolean;
  trophies: number;
  heroLevel: number;
  /** Null once the hero has returned. */
  heroReadyAt: Date | null;
  /** War Lab level per troop type. */
  troopLevels: Record<TroopType, number>;
  keepLevel: number;
  shieldUntil: Date | null;
  buildings: (OwnedBuildingRow & { stock: number })[];
  storageCap: number;
  /** Builders not currently occupied. */
  /** The hold's crew size, which `PlayerView` needs by that name. */
  builders: number;
  buildersFree: number;
  buildersTotal: number;
  armyCap: number;
  armyUsed: number;
  queueJobs: { id: string; type: TroopType; finishesAt: Date; position: number }[];
  /** War Order counters, server-incremented. */
  counters: Record<QuestCounter, number>;
  claimedQuests: string[];
  /** Today's counters, zeroed by the first settle after midnight UTC. */
  daily: Record<DailyCounter, number>;
  dailyClaimed: string[];
  /** Consecutive days the player has been here, today included. */
  streakDays: number;
}

/**
 * Take the player's row lock.
 *
 * Everything that spends or grants resources runs inside a transaction that
 * starts here. Without it, two upgrade requests arriving together both read
 * the same balance, both think they can afford it, and the player gets two
 * buildings for one payment (spec S5).
 */
export async function lockPlayer(tx: Tx, playerId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "Player" WHERE id = ${playerId} FOR UPDATE`,
  );
  if (rows.length === 0) throw new PlayerNotFound(playerId);
}

export class PlayerNotFound extends Error {
  constructor(id: string) {
    super(`No player ${id}`);
    this.name = 'PlayerNotFound';
  }
}

/** Settle production and the training queue, then return the current state. */
export async function settleAndLoad(tx: Tx, playerId: string, now = new Date()): Promise<LoadedPlayer> {
  const player = await tx.player.findUnique({
    where: { id: playerId },
    include: { buildings: true, troops: true, queue: { orderBy: { position: 'asc' } } },
  });
  if (!player) throw new PlayerNotFound(playerId);

  /* --- the day, before anything reads a daily counter ---
   *
   * A settle only ever runs for the player making the request, so reaching
   * here is itself the evidence that they turned up today. That is what makes
   * it the right place to advance the streak: no cron, no job, and no way for
   * a background task to run a streak up on a player's behalf.
   */
  const today = dayIndexOf(now);
  if (player.dayKey !== today) {
    const streakDays = player.dayKey === today - 1 ? player.streakDays + 1 : 1;
    const reset = {
      dayKey: today,
      streakDays,
      dailyClaimed: [],
      ...Object.fromEntries(DAILY_COUNTERS.map((c) => [c, 0])),
    };
    await tx.player.update({ where: { id: playerId }, data: reset });
    Object.assign(player, reset);
  }

  /* --- finished builders, before anything else reads a level --- */
  const finished = player.buildings.filter(
    (b) => b.completesAt !== null && b.completesAt.getTime() <= now.getTime(),
  );
  let upgradesFinished = 0;
  for (const b of finished) {
    // A fresh build has no upgradingTo: it simply starts working.
    const level = b.upgradingTo ?? b.level;
    if (b.upgradingTo !== null) upgradesFinished++;
    await tx.building.update({
      where: { id: b.id },
      data: { level, completesAt: null, upgradingTo: null },
    });
    b.level = level;
    b.completesAt = null;
    b.upgradingTo = null;
  }
  if (upgradesFinished > 0) {
    // Counted where the level actually changes, not where the upgrade is
    // ordered, so a job that is cancelled halfway scores nothing. "Finish now"
    // backdates the timer rather than clearing it, precisely so it arrives
    // here too and there is one place that knows an upgrade completed.
    await tx.player.update({
      where: { id: playerId },
      data: { dayUpgrades: { increment: upgradesFinished } },
    });
    player.dayUpgrades += upgradesFinished;
  }

  /* --- production --- */
  const producers = player.buildings
    // A building still going up earns nothing. One being upgraded keeps
    // working at its current level throughout.
    .filter((b) => !isUnderConstruction({
      type: b.type as BuildingType, level: b.level,
      completesAt: b.completesAt, upgradingTo: b.upgradingTo,
    }))
    .map((b) => ({
      id: b.id,
      type: b.type as BuildingType,
      level: b.level,
      stock: b.stock,
    }));
  const accrual = accrueProduction({ lastTickAt: player.lastTickAt, now, buildings: producers });
  if (accrual.updated.length > 0) {
    await Promise.all(
      accrual.updated.map((u) => tx.building.update({ where: { id: u.id }, data: { stock: u.stock } })),
    );
    for (const u of accrual.updated) {
      const row = producers.find((p) => p.id === u.id);
      if (row) row.stock = u.stock;
    }
  }
  if (accrual.elapsedSeconds > 0 || player.lastTickAt.getTime() !== now.getTime()) {
    await tx.player.update({ where: { id: playerId }, data: { lastTickAt: now } });
  }

  /* --- training queue --- */
  const jobs = player.queue.map((j) => ({
    id: j.id,
    type: j.type as TroopType,
    finishesAt: j.finishesAt,
    position: j.position,
  }));
  const resolved = resolveQueue(jobs, now);

  const army: Partial<Record<TroopType, number>> = {};
  const troopLevels = Object.fromEntries(TROOP_ORDER.map((t) => [t, 1])) as Record<TroopType, number>;
  for (const t of player.troops) {
    army[t.type as TroopType] = t.count;
    troopLevels[t.type as TroopType] = t.level;
  }

  if (resolved.finished.length > 0) {
    await tx.trainJob.deleteMany({ where: { id: { in: resolved.finished.map((j) => j.id) } } });
    // A troop counts as trained when it leaves the queue, not when it is
    // ordered, so a cancelled or still-cooking job never scores a War Order.
    await tx.player.update({
      where: { id: playerId },
      data: {
        trainedTotal: { increment: resolved.finished.length },
        dayTrained: { increment: resolved.finished.length },
      },
    });
    player.trainedTotal += resolved.finished.length;
    for (const type of TROOP_ORDER) {
      const gained = resolved.gained[type];
      if (!gained) continue;
      await tx.troop.upsert({
        where: { playerId_type: { playerId, type } },
        create: { playerId, type, count: gained },
        update: { count: { increment: gained } },
      });
      army[type] = (army[type] ?? 0) + gained;
    }
  }

  const buildings = player.buildings
    .map((b) => ({
      id: b.id, type: b.type as BuildingType, gx: b.gx, gy: b.gy, level: b.level, stock: b.stock,
      completesAt: b.completesAt, upgradingTo: b.upgradingTo,
    }))
    .map((b) => {
      const updated = accrual.updated.find((u) => u.id === b.id);
      return updated ? { ...b, stock: updated.stock } : b;
    })
    // Stable order, so a snapshot taken twice is byte-identical.
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const owned = buildings.map((b) => ({ type: b.type, level: b.level }));
  const queueTypes = resolved.pending.map((j) => j.type);
  const keepLevel = keepLevelOf(owned);

  // The denormalised keepLevel column exists so matchmaking can filter without
  // a join; keep it honest whenever we are here anyway.
  if (player.keepLevel !== keepLevel) {
    await tx.player.update({ where: { id: playerId }, data: { keepLevel } });
  }

  const counters = Object.fromEntries(
    QUEST_COUNTERS.map((k) => [k, player[k]]),
  ) as Record<QuestCounter, number>;
  const daily = Object.fromEntries(
    DAILY_COUNTERS.map((k) => [k, player[k]]),
  ) as Record<DailyCounter, number>;

  return {
    id: player.id,
    name: player.name,
    isGuest: player.isGuest,
    heroLevel: player.heroLevel,
    // A timer that has already run out is the same as no timer, and settling it
    // here means no route has to remember the comparison.
    heroReadyAt: player.heroReadyAt && player.heroReadyAt.getTime() > now.getTime()
      ? player.heroReadyAt
      : null,
    troopLevels,
    gold: player.gold,
    iron: player.iron,
    trophies: player.trophies,
    keepLevel,
    shieldUntil: player.shieldUntil,
    buildings,
    army,
    queue: queueTypes,
    queueJobs: resolved.pending,
    storageCap: storageCapOf(owned),
    builders: player.builders,
    buildersFree: buildersFree(buildings.map((b) => ({
      type: b.type, level: b.level, completesAt: b.completesAt, upgradingTo: b.upgradingTo,
    })), player.builders),
    buildersTotal: player.builders,
    armyCap: armyCapOf(owned),
    armyUsed: armyUsedOf(army, queueTypes),
    counters,
    claimedQuests: player.claimedQuests,
    daily,
    dailyClaimed: player.dailyClaimed,
    streakDays: player.streakDays,
  };
}

/** Convenience wrapper for read-only routes. */
export async function loadPlayer(playerId: string, now = new Date()): Promise<LoadedPlayer> {
  return prisma.$transaction(async (tx) => settleAndLoad(tx, playerId, now));
}

/** Barracks level a player currently fields, for the army sheet. */
export function barracksLevelOf(p: LoadedPlayer): number {
  return bestBarracksLevel(p.buildings.map((b) => ({ type: b.type, level: b.level })));
}

/**
 * Create a player with the prototype's opening layout: a Keep in the middle,
 * a Gold Mine to its left and a Barracks to its right.
 */
export async function createPlayer(
  name: string,
  email?: string,
  isGuest = false,
): Promise<string> {
  const mid = Math.floor(56 / 2) - 1;
  const player = await prisma.player.create({
    data: {
      name,
      email: email ?? null,
      isGuest,
      gold: BigInt(START_GOLD),
      iron: BigInt(START_IRON),
      buildings: {
        create: [
          { type: 'keep', gx: mid, gy: mid, level: 1 },
          { type: 'mine', gx: mid - 3, gy: mid, level: 1 },
          { type: 'barr', gx: mid + 3, gy: mid, level: 1 },
        ],
      },
      troops: { create: TROOP_ORDER.map((type) => ({ type, count: 0 })) },
    },
    select: { id: true },
  });
  return player.id;
}
