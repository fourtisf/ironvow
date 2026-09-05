/**
 * Seed one deliberately maximal hold, and a session cookie for it.
 *
 * The renderer was only ever measured against small bases, which is how a
 * 10 fps frame time on a full one went unnoticed. This builds the worst case a
 * player can actually reach — Keep 8, a hundred and twenty ramparts, 164
 * structures in all — and prints a session token so a browser can be pointed
 * straight at it. See the Performance section of docs/STATUS.md.
 *
 * Run: pnpm --filter @ironvow/api exec tsx scripts/seed-perf.ts
 * Then set the ironvow_session cookie to the token it prints.
 */
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const mid = 26;
const buildings: { type: string; gx: number; gy: number; level: number }[] = [
  { type: 'keep', gx: mid, gy: mid, level: 8 },
];
const put = (type: string, n: number, r: number, lv: number) => {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283;
    const gx = Math.round(mid + 1 + Math.cos(a) * r), gy = Math.round(mid + 1 + Math.sin(a) * r);
    const s = type === 'wall' ? 1 : 2;
    if (buildings.some(b => { const bs = b.type === 'keep' ? 3 : b.type === 'wall' ? 1 : 2;
      return gx < b.gx + bs && gx + s > b.gx && gy < b.gy + bs && gy + s > b.gy; })) continue;
    buildings.push({ type, gx, gy, level: lv });
  }
};
put('cannon', 9, 5, 8); put('tower', 8, 8, 7); put('mine', 10, 11, 7);
put('forge', 7, 13, 7); put('store', 5, 15, 7); put('barr', 4, 17, 6);
put('wall', 60, 19, 6); put('wall', 60, 21, 6);
const player = await db.player.create({
  data: {
    name: 'Perf ' + Math.floor(Math.random() * 99999), isGuest: true,
    gold: 90000n, iron: 90000n, keepLevel: 8, trophies: 1500, heroLevel: 8,
    buildings: { create: buildings },
    troops: { create: [
      { type: 'raider', count: 30, level: 6 }, { type: 'archer', count: 20, level: 5 },
      { type: 'lancer', count: 12, level: 5 }, { type: 'ram', count: 6, level: 6 },
    ] },
  }, select: { id: true },
});
const token = randomBytes(32).toString('base64url');
await db.session.create({ data: {
  tokenHash: createHash('sha256').update(token).update(process.env.SESSION_SECRET!).digest('hex'),
  playerId: player.id, expiresAt: new Date(Date.now() + 86_400_000),
} });
console.log(token, buildings.length);
await db.$disconnect();
