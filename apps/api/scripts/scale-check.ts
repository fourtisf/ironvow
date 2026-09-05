/**
 * Measure the server against a populated database.
 *
 * Everything here has only ever been exercised against a handful of rows.
 * These are the queries whose cost depends on how many players exist, so they
 * are the ones that can look fine in a test and fall over on a real server.
 */
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';

const db = new PrismaClient();
const SECRET = process.env.SESSION_SECRET!;

async function sessionFor(playerId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.session.create({
    data: {
      tokenHash: createHash('sha256').update(token).update(SECRET).digest('hex'),
      playerId,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return `ironvow_session=${token}`;
}

function report(label: string, times: number[], extra = ''): void {
  const sorted = [...times].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!.toFixed(0);
  console.log(
    `${label.padEnd(28)} n=${String(times.length).padStart(4)}  ` +
    `median ${p(0.5).padStart(5)}ms  p95 ${p(0.95).padStart(5)}ms  max ${p(1).padStart(5)}ms  ${extra}`,
  );
}

async function main(): Promise<void> {
  const app = await buildApp();
  await app.ready();

  const players = await db.player.findMany({
    select: { id: true, trophies: true },
    orderBy: { trophies: 'asc' },
  });
  console.log(`population: ${players.length} players, trophies ${players[0]!.trophies}..${players.at(-1)!.trophies}\n`);

  // Sample across the whole distribution, not just the middle: the bottom of
  // the ladder is where matchmaking has the fewest neighbours to choose from.
  const sample = Array.from({ length: 60 }, (_, i) =>
    players[Math.floor((i / 60) * players.length)]!);

  const cookies = new Map<string, string>();
  for (const p of sample) cookies.set(p.id, await sessionFor(p.id));

  /* --- /me: the request every client makes constantly --- */
  const meTimes: number[] = [];
  for (const p of sample) {
    const t = performance.now();
    const res = await app.inject({ method: 'GET', url: '/me', headers: { cookie: cookies.get(p.id)! } });
    meTimes.push(performance.now() - t);
    if (res.statusCode !== 200) throw new Error(`/me returned ${res.statusCode}`);
  }
  report('/me', meTimes);

  /* --- matchmaking: the most expensive thing the server does --- */
  const findTimes: number[] = [];
  let garrisons = 0;
  let humans = 0;
  for (const p of sample) {
    const t = performance.now();
    const res = await app.inject({
      method: 'POST', url: '/raid/find', headers: { cookie: cookies.get(p.id)! }, payload: {},
    });
    findTimes.push(performance.now() - t);
    if (res.statusCode !== 200) throw new Error(`/raid/find returned ${res.statusCode}`);
    if (res.json().isPlayer) humans++; else garrisons++;
  }
  report('/raid/find', findTimes, `humans ${humans}, garrisons ${garrisons}`);

  /* --- the ladder: a rank query over the whole table --- */
  const ladderTimes: number[] = [];
  for (const p of sample) {
    const t = performance.now();
    const res = await app.inject({
      method: 'GET', url: '/leaderboard', headers: { cookie: cookies.get(p.id)! },
    });
    ladderTimes.push(performance.now() - t);
    if (res.statusCode !== 200) throw new Error(`/leaderboard returned ${res.statusCode}`);
  }
  report('/leaderboard', ladderTimes);

  /* --- concurrent matchmaking, which is the realistic shape of load --- */
  const burstStart = performance.now();
  const burst = await Promise.all(sample.slice(0, 30).map((p) =>
    app.inject({ method: 'POST', url: '/raid/find', headers: { cookie: cookies.get(p.id)! }, payload: { reroll: true } })));
  const burstMs = performance.now() - burstStart;
  const failures = burst.filter((r) => r.statusCode !== 200);
  console.log(
    `30 concurrent /raid/find     total ${burstMs.toFixed(0)}ms  ` +
    `failures ${failures.length}${failures.length ? ' -> ' + failures[0]!.statusCode : ''}`,
  );

  /* --- does anyone get matched against a shielded player? --- */
  const shieldedIds = new Set(
    (await db.player.findMany({
      where: { shieldUntil: { gt: new Date() } }, select: { id: true },
    })).map((p) => p.id),
  );
  const openRaids = await db.raid.findMany({
    where: { status: 'open', defenderId: { not: null } },
    select: { defenderId: true, attackerId: true },
  });
  const shieldViolations = openRaids.filter((r) => shieldedIds.has(r.defenderId!)).length;
  const selfMatches = openRaids.filter((r) => r.defenderId === r.attackerId).length;
  console.log(`\nshielded players: ${shieldedIds.size}/${players.length}`);
  console.log(`open raids against a shielded player: ${shieldViolations}  (must be 0)`);
  console.log(`open raids against oneself: ${selfMatches}  (must be 0)`);

  await app.close();
  await db.$disconnect();
}

await main();
