import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { TROOP_ORDER } from '@ironvow/config';

/**
 * Integration tests run against a real Postgres.
 *
 * The concurrency test in particular is meaningless without one: it exists to
 * prove that SELECT ... FOR UPDATE stops a double-spend, and no in-memory
 * substitute can demonstrate that.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

export const hasDatabase = TEST_DATABASE_URL.length > 0;

/**
 * In CI, a skipped suite is a failure.
 *
 * These tests skip themselves without a database so a contributor can run the
 * pure ones on a laptop with nothing installed. That courtesy becomes a trap
 * the moment CI is misconfigured: twelve tests quietly do not run and the build
 * still goes green, which is worse than a red one because it looks fine.
 *
 * Setting IRONVOW_REQUIRE_DB turns the skip into a loud failure. CI sets it.
 */
if (!hasDatabase && process.env.IRONVOW_REQUIRE_DB === '1') {
  throw new Error(
    'IRONVOW_REQUIRE_DB is set but TEST_DATABASE_URL is empty, so the database-backed '
    + 'suites would skip and the run would still report success. Point TEST_DATABASE_URL at a database.',
  );
}

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ??= 'test-session-secret-at-least-16';

let migrated = false;

export function migrate(): void {
  if (migrated || !hasDatabase) return;
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
  migrated = true;
}

export const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

export async function resetDatabase(): Promise<void> {
  await db.$executeRawUnsafe(
    // Clan and Counter are listed explicitly: unlike everything else here they
    // do not hang off a Player, so truncating players leaves them behind — the
    // next test fails on a clan name that is still taken, or reads a funnel
    // carrying the previous test's doors.
    'TRUNCATE "Divergence", "Session", "LoginLink", "Raid", "TrainJob", "Troop", "Building", "ClanWar", "Feedback", "ServerSetting", "Season", "Counter", "Clan", "Player" RESTART IDENTITY CASCADE',
  );
}

/** A fresh player with the opening layout and an optional custom purse. */
export async function makePlayer(
  name: string,
  opts: {
    gold?: number; iron?: number; trophies?: number; seasonPeak?: number;
    keepLevel?: number; builders?: number; pouch?: Record<string, number>;
    shards?: number; relics?: Record<string, number>; carried?: (string | null)[];
  } = {},
): Promise<string> {
  const mid = Math.floor(56 / 2) - 1;
  const player = await db.player.create({
    data: {
      name,
      gold: BigInt(opts.gold ?? 900),
      iron: BigInt(opts.iron ?? 320),
      trophies: opts.trophies ?? 0,
      seasonPeak: opts.seasonPeak ?? opts.trophies ?? 0,
      ...(opts.pouch === undefined ? {} : { pouch: opts.pouch }),
      ...(opts.shards === undefined ? {} : { shards: opts.shards }),
      ...(opts.relics === undefined ? {} : { relics: opts.relics }),
      ...(opts.carried === undefined ? {} : { carried: opts.carried }),
      keepLevel: opts.keepLevel ?? 1,
      // The schema default is the opening crew; a test that is about
      // something else says so by asking for more.
      ...(opts.builders === undefined ? {} : { builders: opts.builders }),
      buildings: {
        create: [
          { type: 'keep', gx: mid, gy: mid, level: opts.keepLevel ?? 1 },
          { type: 'mine', gx: mid - 3, gy: mid, level: 1 },
          { type: 'barr', gx: mid + 3, gy: mid, level: 1 },
          // The same opening layout createPlayer lays down, fields included:
          // warband room comes from these, so a fixture without them has a
          // capacity of zero and every training test fails for the wrong
          // reason. See CAMP_NOTE in @ironvow/config.
          { type: 'camp', gx: mid - 2, gy: mid + 4, level: 1 },
          { type: 'camp', gx: mid + 3, gy: mid + 4, level: 1 },
        ],
      },
      troops: { create: TROOP_ORDER.map((type) => ({ type, count: 0 })) },
    },
    select: { id: true },
  });
  return player.id;
}

/** Log in without going through email, for tests that need a cookie. */
export async function loginAs(app: { inject: Function }, playerId: string): Promise<string> {
  const { createHash, randomBytes } = await import('node:crypto');
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).update(process.env.SESSION_SECRET!).digest('hex');
  await db.session.create({
    data: { tokenHash, playerId, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return `ironvow_session=${token}`;
}
