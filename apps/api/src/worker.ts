import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { TYPES, type BuildingType } from '@ironvow/config';
import { purgeExpired } from './lib/auth.js';
import { pushBuildFinished } from './lib/push.js';
import { env } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { expireChallenges, matchSearching, settleDueWars } from './lib/war.js';

/**
 * Background housekeeping.
 *
 * Nothing that decides a game outcome runs here. Production and the training
 * queue are settled lazily on read, precisely so a stalled worker cannot cost a
 * player their resources. This only tidies rows that no longer matter.
 */

const connection = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });

export const MAINTENANCE_QUEUE = 'ironvow:maintenance';

interface MaintenanceJob {
  kind: 'expireRaids' | 'purgeSessions' | 'notifyBuilders' | 'wars';
}

/**
 * Clan wars: pair up clans that are searching, drop challenges nobody
 * answered, and close wars whose clock has run out. The one job here that
 * does decide something — who won — decides it from rows the raid route
 * already wrote, and is idempotent on the war's state.
 */
async function tendWars(): Promise<{ started: number; expired: number; settled: number }> {
  const now = new Date();
  const started = await prisma.$transaction((tx) => matchSearching(tx, now));
  const expired = await prisma.$transaction((tx) => expireChallenges(tx, now));
  const settled = await settleDueWars(now);
  return { started, expired, settled };
}

/** Close raids nobody submitted. The attacker keeps their troops. */
async function expireRaids(): Promise<number> {
  const result = await prisma.raid.updateMany({
    where: { status: 'open', expiresAt: { lte: new Date() } },
    data: { status: 'expired' },
  });
  return result.count;
}

/**
 * Tell players their builders are free.
 *
 * Notifications are pushed once, from here, rather than when the player next
 * loads the game — the whole point is to reach somebody who is not looking.
 * `lastNotifiedAt` on the building is what stops a job being announced twice.
 */
async function notifyBuilders(): Promise<number> {
  const now = new Date();
  const finished = await prisma.building.findMany({
    where: {
      completesAt: { lte: now, not: null },
      notifiedAt: null,
    },
    select: { id: true, playerId: true, type: true },
    take: 200,
  });
  if (finished.length === 0) return 0;

  // Mark first. A notification lost is better than one sent twice, and a
  // crash between the two would otherwise repeat on every tick.
  await prisma.building.updateMany({
    where: { id: { in: finished.map((b) => b.id) } },
    data: { notifiedAt: now },
  });

  // One notification per player, not per building: three builders finishing
  // together is one thing that happened, not three.
  const byPlayer = new Map<string, string[]>();
  for (const b of finished) {
    const list = byPlayer.get(b.playerId) ?? [];
    list.push(TYPES[b.type as BuildingType]?.n ?? b.type);
    byPlayer.set(b.playerId, list);
  }

  for (const [playerId, names] of byPlayer) {
    const what = names.length === 1 ? names[0]! : `${names.length} buildings`;
    await pushBuildFinished(playerId, what).catch(() => undefined);
  }
  return finished.length;
}

export function createWorker(): Worker<MaintenanceJob> {
  return new Worker<MaintenanceJob>(
    MAINTENANCE_QUEUE,
    async (job) => {
      if (job.data.kind === 'expireRaids') return { expired: await expireRaids() };
      if (job.data.kind === 'purgeSessions') return purgeExpired();
      if (job.data.kind === 'notifyBuilders') return { notified: await notifyBuilders() };
      if (job.data.kind === 'wars') return tendWars();
      return {};
    },
    { connection },
  );
}

export async function scheduleMaintenance(): Promise<void> {
  const queue = new Queue<MaintenanceJob>(MAINTENANCE_QUEUE, { connection });
  await queue.add('expireRaids', { kind: 'expireRaids' }, {
    repeat: { every: 60_000 },
    removeOnComplete: 20,
    removeOnFail: 50,
  });
  await queue.add('purgeSessions', { kind: 'purgeSessions' }, {
    repeat: { every: 3_600_000 },
    removeOnComplete: 20,
    removeOnFail: 50,
  });
  // Often enough that "your builder is free" is still true when it lands.
  await queue.add('notifyBuilders', { kind: 'notifyBuilders' }, {
    repeat: { every: 30_000 },
    removeOnComplete: 20,
    removeOnFail: 50,
  });
  await queue.add('wars', { kind: 'wars' }, {
    repeat: { every: 60_000 },
    removeOnComplete: 20,
    removeOnFail: 50,
  });
}

// Run standalone: `node dist/worker.js`
if (process.argv[1]?.endsWith('worker.js') || process.argv[1]?.endsWith('worker.ts')) {
  const worker = createWorker();
  await scheduleMaintenance();
  // eslint-disable-next-line no-console
  console.log('[worker] maintenance queue running');

  const stop = async (): Promise<void> => {
    await worker.close();
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}
