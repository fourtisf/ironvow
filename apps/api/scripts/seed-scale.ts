/**
 * Populate a realistic server.
 *
 * Everything in IRONVOW has been exercised against a handful of players. This
 * fills a database with a plausible population — a long tail of new holds, a
 * middle, and a thin top — so matchmaking, the ladder and the shield rules can
 * be measured against something resembling a real server rather than six rows.
 *
 * Run: pnpm --filter @ironvow/api exec tsx scripts/seed-scale.ts [count]
 */
import { PrismaClient } from '@prisma/client';
import { CAP, TROOP_ORDER, capOf } from '@ironvow/config';
import { mulberry } from '@ironvow/sim';

const db = new PrismaClient();
const COUNT = Number(process.argv[2] ?? 500);
const rng = mulberry(20260905);

/**
 * Trophies follow a long tail: most players are new, a few are not. A uniform
 * spread would make matchmaking look far healthier than it is, because every
 * band would be equally populated.
 */
function trophiesFor(): number {
  const roll = rng();
  if (roll < 0.55) return Math.floor(rng() * 200);
  if (roll < 0.85) return 200 + Math.floor(rng() * 600);
  if (roll < 0.97) return 800 + Math.floor(rng() * 1200);
  return 2000 + Math.floor(rng() * 2000);
}

function keepFor(trophies: number): number {
  return Math.max(1, Math.min(9, 1 + Math.floor(trophies / 260)));
}

function layoutFor(keepLevel: number) {
  const mid = 26;
  const out: { type: string; gx: number; gy: number; level: number }[] = [
    { type: 'keep', gx: mid, gy: mid, level: keepLevel },
  ];
  const place = (type: keyof typeof CAP, count: number, radius: number) => {
    const allowed = Math.min(count, capOf(type, keepLevel));
    for (let i = 0; i < allowed; i++) {
      const a = (i / Math.max(1, allowed)) * 6.283;
      out.push({
        type,
        gx: Math.round(mid + 1 + Math.cos(a) * radius),
        gy: Math.round(mid + 1 + Math.sin(a) * radius),
        level: Math.max(1, keepLevel - 1),
      });
    }
  };
  place('mine', keepLevel + 2, 7);
  place('forge', keepLevel, 9);
  place('store', 3, 5);
  place('cannon', keepLevel, 4);
  place('tower', keepLevel - 1, 11);

  // Drop anything that overlaps rather than letting the seed produce an
  // impossible base the game itself would have rejected.
  const kept: typeof out = [];
  const size = (t: string) => (t === 'keep' ? 3 : t === 'wall' ? 1 : 2);
  for (const b of out) {
    const s = size(b.type);
    const clash = kept.some((k) => {
      const ks = size(k.type);
      return b.gx < k.gx + ks && b.gx + s > k.gx && b.gy < k.gy + ks && b.gy + s > k.gy;
    });
    if (!clash) kept.push(b);
  }
  return kept;
}

async function main(): Promise<void> {
  const existing = await db.player.count();
  // Names are unique, so a second run has to start where the first left off.
  const offset = existing;
  console.log(`existing players: ${existing}; seeding ${COUNT}`);
  const started = Date.now();

  for (let batch = 0; batch < COUNT; batch += 50) {
    const size = Math.min(50, COUNT - batch);
    await Promise.all(Array.from({ length: size }, async (_, n) => {
      const i = batch + n;
      const trophies = trophiesFor();
      const keepLevel = keepFor(trophies);
      // A fifth of the population is shielded at any moment, which is roughly
      // what a 12-hour shield produces on an active server.
      const shielded = rng() < 0.2;

      await db.player.create({
        data: {
          name: `Hold ${String(offset + i).padStart(5, '0')}`,
          trophies,
          keepLevel,
          gold: BigInt(Math.floor(rng() * 60_000)),
          iron: BigInt(Math.floor(rng() * 40_000)),
          heroLevel: Math.max(1, Math.min(keepLevel, 1 + Math.floor(rng() * keepLevel))),
          shieldUntil: shielded ? new Date(Date.now() + rng() * 12 * 3_600_000) : null,
          lastTickAt: new Date(Date.now() - rng() * 6 * 3_600_000),
          buildings: { create: layoutFor(keepLevel) },
          troops: {
            create: TROOP_ORDER.map((type) => ({
              type,
              count: Math.floor(rng() * 20),
              level: Math.max(1, Math.min(keepLevel, 1 + Math.floor(rng() * 4))),
            })),
          },
        },
      });
    }));
    process.stdout.write(`\r  ${Math.min(batch + 50, COUNT)}/${COUNT}`);
  }

  const total = await db.player.count();
  console.log(`\nseeded in ${((Date.now() - started) / 1000).toFixed(1)}s; total players: ${total}`);
  await db.$disconnect();
}

await main();
