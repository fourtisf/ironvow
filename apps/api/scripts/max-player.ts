/**
 * Take one player to the top of everything.
 *
 * For the operator's own account: a finished hold to look at, to record, and to
 * check the late game against without playing to it. Nothing here is reachable
 * from the game — it is a script somebody runs on the server with the database
 * in front of them, which is the only reason it is allowed to exist.
 *
 * Every limit is read from `@ironvow/config` rather than typed here, so "max"
 * means what the game means by max and cannot drift from it. Placement goes
 * through `cellsFree`, the same function the server runs on every build, so the
 * base this writes is one the server would have accepted a piece at a time.
 *
 *   pnpm --filter @ironvow/api exec tsx scripts/max-player.ts "<name or id>"
 *
 * It refuses to guess. Pass the exact name shown in SETTINGS, or the player id.
 */
import { PrismaClient } from '@prisma/client';
import {
  DAY, HERO_MAX_LEVEL, ITEM, ITEM_TYPES, KEEP_MAX, MAX_BUILDERS, NIGHT, NIGHT_KEEP_MAX,
  RELIC_MAX_LEVEL, RELIC_SLOTS, RELIC_TYPES, TROOP, TROOP_MAX_LEVEL, TROOP_ORDER, TYPES,
  WORLD_NAME, armyCapOf, storageCapOf, type BuildingType, type World,
} from '@ironvow/config';
import { maxBase } from '../src/domain/maxbase.js';

const db = new PrismaClient();
const WHO = process.argv[2];

/** Both bases, day first, so the night purse is written from the night base. */
const WORLD_LIST: World[] = [DAY, NIGHT];

async function main(): Promise<void> {
  if (!WHO) {
    console.error('Which player? Pass the name shown in SETTINGS, or the player id.');
    console.error('  pnpm --filter @ironvow/api exec tsx scripts/max-player.ts "Duskmoor 4835"');
    process.exit(1);
  }

  const found = await db.player.findMany({
    where: { OR: [{ id: WHO }, { name: WHO }] },
    select: { id: true, name: true, keepLevel: true, trophies: true, nightStartedAt: true },
  });
  if (found.length === 0) {
    console.error(`No player called "${WHO}".`);
    process.exit(1);
  }
  if (found.length > 1) {
    // Names are unique, so this means the string matched an id and a name.
    console.error(`"${WHO}" matches ${found.length} players. Use the id.`);
    for (const p of found) console.error(`  ${p.id}  ${p.name}`);
    process.exit(1);
  }
  const player = found[0]!;
  console.log(`Maxing ${player.name} (${player.id}) — Town Hall ${player.keepLevel}, ${player.trophies} trophies.`);

  /* ------------------------------------------------------------ the bases --- */

  /*
   * Both of them, and scoped to one world at a time.
   *
   * This script was written before the night world existed, and left as it
   * was it would have been actively destructive: `deleteMany` on a player id
   * takes out the night base along with the day one, and everything it wrote
   * back landed in the day world because that is the column default. Running
   * it would have deleted a second base and reported success.
   */
  const plans = WORLD_LIST.map((world) => ({
    world,
    ...maxBase(world === NIGHT ? NIGHT_KEEP_MAX : KEEP_MAX, world),
  }));
  for (const p of plans) {
    if (p.missed > 0) console.log(`  ${p.missed} could not be fitted in the ${WORLD_NAME[p.world]}.`);
  }

  const relics = Object.fromEntries(RELIC_TYPES.map((t) => [t, RELIC_MAX_LEVEL]));
  const pouch = Object.fromEntries(ITEM_TYPES.map((t) => [t, ITEM[t].cap]));
  const purseOf = (rows: { type: BuildingType; level: number }[]): bigint =>
    BigInt(storageCapOf(rows.map((b) => ({ type: b.type, level: b.level }))));

  await db.$transaction(async (tx) => {
    for (const plan of plans) {
      const { world, buildings: rows } = plan;
      await tx.building.deleteMany({ where: { playerId: player.id, world } });
      await tx.building.createMany({
        data: rows.map((b) => ({ playerId: player.id, world, ...b, stock: 0 })),
      });

      // Camps decide army room, so the warband is filled against what was
      // actually placed in *this* world rather than against what was asked for.
      const room = armyCapOf(rows.map((b) => ({ type: b.type, level: b.level })));
      for (const type of TROOP_ORDER) {
        const count = Math.floor(room / TROOP_ORDER.length / TROOP[type].sp);
        /*
         * Upserted rather than updated: a night world the player has never
         * crossed into has no troop rows at all, and `updateMany` against
         * nothing succeeds silently.
         */
        await tx.troop.upsert({
          where: { playerId_world_type: { playerId: player.id, world, type } },
          create: { playerId: player.id, world, type, count, level: TROOP_MAX_LEVEL },
          update: { count, level: TROOP_MAX_LEVEL },
        });
      }
    }

    const day = plans.find((p) => p.world === DAY)!;
    const night = plans.find((p) => p.world === NIGHT)!;
    const now = new Date();

    await tx.player.update({
      where: { id: player.id },
      data: {
        keepLevel: KEEP_MAX,
        gold: purseOf(day.buildings),
        iron: purseOf(day.buildings),
        builders: MAX_BUILDERS,
        heroLevel: HERO_MAX_LEVEL,
        heroReadyAt: null,
        relics,
        // Whatever fits in the slots there are, in the order they are declared.
        carried: RELIC_TYPES.slice(0, RELIC_SLOTS),
        shards: 9999,
        pouch,
        /*
         * The night world's own purse and crew, and its own clock.
         *
         * `nightStartedAt` is what tells the server this base has been laid
         * down. Without it the first crossing would lay a starting base on top
         * of the one this just wrote.
         */
        nightGold: purseOf(night.buildings),
        nightIron: purseOf(night.buildings),
        nightBuilders: MAX_BUILDERS,
        nightStartedAt: player.nightStartedAt ?? now,
        nightTickAt: now,
      },
    });
  }, { maxWait: 20_000, timeout: 120_000 });

  for (const plan of plans) {
    const counts = new Map<string, number>();
    for (const b of plan.buildings) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
    const top = plan.world === NIGHT ? NIGHT_KEEP_MAX : KEEP_MAX;
    console.log(`  ${WORLD_NAME[plan.world]}: ${plan.buildings.length} buildings, all at level ${top}`);
    for (const [t, n] of [...counts].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(3)} × ${TYPES[t as BuildingType].n}`);
    }
    console.log(`    ${purseOf(plan.buildings)} gold and iron · ${MAX_BUILDERS} builders`);
  }
  console.log(`  hero ${HERO_MAX_LEVEL} · every troop at level ${TROOP_MAX_LEVEL} · every relic at ${RELIC_MAX_LEVEL}`);
  console.log('Done. Reload the game.');
}

main()
  .catch((e: unknown) => { console.error(e); process.exit(1); })
  .finally(() => void db.$disconnect());
