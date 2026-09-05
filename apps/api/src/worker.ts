import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { purgeExpired } from './lib/auth.js';
import { env } from './lib/env.js';
import { prisma } from './lib/prisma.js';

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
  kind: 'expireRaids' | 'purgeSessions';
}

/** Close raids nobody submitted. The attacker keeps their troops. */
async function expireRaids(): Promise<number> {
  const result = await prisma.raid.updateMany({
    where: { status: 'open', expiresAt: { lte: new Date() } },
    data: { status: 'expired' },
  });
  return result.count;
}

export function createWorker(): Worker<MaintenanceJob> {
  return new Worker<MaintenanceJob>(
    MAINTENANCE_QUEUE,
    async (job) => {
      if (job.data.kind === 'expireRaids') return { expired: await expireRaids() };
      if (job.data.kind === 'purgeSessions') return purgeExpired();
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
