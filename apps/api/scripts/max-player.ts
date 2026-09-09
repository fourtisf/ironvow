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
  HERO_MAX_LEVEL, ITEM, ITEM_TYPES, KEEP_MAX, MAX_BUILDERS,
  RELIC_MAX_LEVEL, RELIC_SLOTS, RELIC_TYPES, TROOP, TROOP_MAX_LEVEL, TROOP_ORDER, TYPES,
  armyCapOf, storageCapOf, type BuildingType,
} from '@ironvow/config';
import { maxBase } from '../src/domain/maxbase.js';

const db = new PrismaClient();
const WHO = process.argv[2];

async function main(): Promise<void> {
  if (!WHO) {
    console.error('Which player? Pass the name shown in SETTINGS, or the player id.');
    console.error('  pnpm --filter @ironvow/api exec tsx scripts/max-player.ts "Duskmoor 4835"');
    process.exit(1);
  }

  const found = await db.player.findMany({
    where: { OR: [{ id: WHO }, { name: WHO }] },
    select: { id: true, name: true, keepLevel: true, trophies: true },
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

  /* ---------------------------------------------------------- the base --- */

  const { buildings: rows, missed } = maxBase();
  if (missed > 0) console.log(`  ${missed} could not be fitted on the field.`);

  /* --------------------------------------------------------- the player --- */

  const owned = rows.map((b) => ({ type: b.type, level: b.level }));
  const purse = BigInt(storageCapOf(owned));
  const relics = Object.fromEntries(RELIC_TYPES.map((t) => [t, RELIC_MAX_LEVEL]));
  const pouch = Object.fromEntries(ITEM_TYPES.map((t) => [t, ITEM[t].cap]));

  await db.$transaction(async (tx) => {
    await tx.building.deleteMany({ where: { playerId: player.id } });
    await tx.building.createMany({
      data: rows.map((b) => ({ playerId: player.id, ...b, stock: 0 })),
    });

    // Camps decide army room, so the warband is filled against what was
    // actually placed rather than against what was asked for.
    const room = armyCapOf(owned);
    for (const type of TROOP_ORDER) {
      await tx.troop.updateMany({
        where: { playerId: player.id, type },
        // An even share of the room, in whole troops of that size.
        data: { count: Math.floor(room / TROOP_ORDER.length / TROOP[type].sp), level: TROOP_MAX_LEVEL },
      });
    }

    await tx.player.update({
      where: { id: player.id },
      data: {
        keepLevel: KEEP_MAX,
        gold: purse,
        iron: purse,
        builders: MAX_BUILDERS,
        heroLevel: HERO_MAX_LEVEL,
        heroReadyAt: null,
        relics,
        // Whatever fits in the slots there are, in the order they are declared.
        carried: RELIC_TYPES.slice(0, RELIC_SLOTS),
        shards: 9999,
        pouch,
      },
    });
  }, { maxWait: 20_000, timeout: 120_000 });

  const counts = new Map<string, number>();
  for (const b of rows) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  console.log(`  ${rows.length} buildings, all at level ${KEEP_MAX}:`);
  for (const [t, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(3)} × ${TYPES[t as BuildingType].n}`);
  }
  console.log(`  ${purse} gold and iron · ${MAX_BUILDERS} builders · hero ${HERO_MAX_LEVEL}`);
  console.log(`  every troop at level ${TROOP_MAX_LEVEL} · every relic at ${RELIC_MAX_LEVEL}`);
  console.log('Done. Reload the game.');
}

main()
  .catch((e: unknown) => { console.error(e); process.exit(1); })
  .finally(() => void db.$disconnect());
