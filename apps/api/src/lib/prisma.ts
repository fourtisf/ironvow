import { PrismaClient } from '@prisma/client';

/**
 * One client per process. Next.js-style hot reload can otherwise leak a pool
 * per rebuild until Postgres refuses new connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Transaction settings for a command that takes the player's row lock.
 *
 * Under a burst, requests queue on `SELECT ... FOR UPDATE` while holding a
 * connection, so both waits need headroom: `maxWait` for getting a connection
 * out of the pool, `timeout` for the lock itself. The defaults of 2s and 5s
 * turn a legitimate queue into spurious 500s.
 *
 * Note that a command must do all of its work in one transaction. Opening a
 * second one to read the player back deadlocks the pool: the connections held
 * by lock-waiters are exactly the ones the finished writer needs.
 */
export const COMMAND_TX = { maxWait: 15_000, timeout: 20_000 } as const;
