/**
 * Put one player back on their first morning.
 *
 * ALFA: "reset akun ini jadi 0."
 *
 * The other side of `max-player.ts`, and it exists for the same reason: the
 * operator's own account is a test rig. Maxing it is how the late game gets
 * looked at without playing to it; resetting it is how the *first* game does —
 * the opening five buildings, the tutorial, the first raid, the moment the
 * boat becomes tappable. Those are the screens a launch is judged on and there
 * was no way back to them short of making a new account, which loses the id,
 * the name and the invitation code somebody may already have handed out.
 *
 * What "zero" means here is precise: exactly the row `createPlayer` writes, for
 * everything a player earns. Not defaults typed out again — the same constants
 * the game starts a real account with, so this cannot drift from it.
 *
 *   pnpm --filter @ironvow/api exec tsx scripts/reset-player.ts "<name or id>"
 *
 * It refuses to guess. Pass the exact name shown in SETTINGS, or the player id.
 *
 * What it deliberately does NOT touch, because none of it is progress:
 *
 *  - The account itself: id, name, email, guest flag, sign-in sessions. The
 *    player stays signed in on whatever device they are holding.
 *  - The invitation code and who invited whom. A code already posted somewhere
 *    has to keep working, and rewriting who paid whom would be rewriting
 *    somebody else's history, not this player's.
 *  - Clan membership. Leaving a clan is a thing done to other people; a reset
 *    is a thing done to yourself. Leave first if that is what you want.
 *  - Raids already fought, by or against this player, and any replay links
 *    shared from them. A published link that dies because its author started
 *    over is a broken promise to whoever clicked it.
 *
 * Everything else — both bases, both purses, both armies, both ladders, the
 * hero, the relics, the pouch, the quests, the streak, the lifetime counters —
 * goes back to nothing.
 */
import { PrismaClient } from '@prisma/client';
import {
  DAY, NIGHT, START_GOLD, START_IRON, STARTING_BUILDERS, TROOP_ORDER, WORLD_NAME,
  NEWS_LATEST, type World,
} from '@ironvow/config';

const db = new PrismaClient();
const WHO = process.argv[2];

/**
 * The five buildings a new hold is given.
 *
 * The same placement `createPlayer` uses, down to the arithmetic: a Town Hall
 * in the middle, a Gold Mine and a Barracks either side, and the two Muster
 * Fields south of the hall they belong to.
 */
const MID = Math.floor(56 / 2) - 1;
const OPENING = [
  { type: 'keep', gx: MID, gy: MID, level: 1 },
  { type: 'mine', gx: MID - 3, gy: MID, level: 1 },
  { type: 'barr', gx: MID + 3, gy: MID, level: 1 },
  { type: 'camp', gx: MID - 2, gy: MID + 4, level: 1 },
  { type: 'camp', gx: MID + 3, gy: MID + 4, level: 1 },
];

async function main(): Promise<void> {
  if (!WHO) {
    console.error('Which player? Pass the name shown in SETTINGS, or the player id.');
    console.error('  pnpm --filter @ironvow/api exec tsx scripts/reset-player.ts "Greyward 8808"');
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
  console.log(`Resetting ${player.name} (${player.id}) — Town Hall ${player.keepLevel}, ${player.trophies} trophies.`);

  const worlds: World[] = [DAY, NIGHT];
  const now = new Date();

  await db.$transaction(async (tx) => {
    /*
     * Both worlds, and the night one is emptied rather than re-laid.
     *
     * A reset player has not crossed over, so the night world should not
     * exist yet — that is what `nightStartedAt: null` says, and it is what
     * makes the first crossing lay the starting night base again. Leaving
     * buildings there with no start date would be a base the server thinks
     * has never been founded.
     */
    for (const world of worlds) {
      await tx.building.deleteMany({ where: { playerId: player.id, world } });
      await tx.trainJob.deleteMany({ where: { playerId: player.id, world } });
      await tx.layout.deleteMany({ where: { playerId: player.id, world } });
      await tx.troop.deleteMany({ where: { playerId: player.id, world } });
    }

    await tx.building.createMany({
      data: OPENING.map((b) => ({ playerId: player.id, world: DAY, ...b })),
    });
    await tx.troop.createMany({
      data: TROOP_ORDER.map((type) => ({ playerId: player.id, world: DAY, type, count: 0 })),
    });

    await tx.player.update({
      where: { id: player.id },
      data: {
        gold: BigInt(START_GOLD),
        iron: BigInt(START_IRON),
        trophies: 0,
        keepLevel: 1,
        builders: STARTING_BUILDERS,
        seasonPeak: 0,
        shards: 0,
        relics: {},
        carried: [],
        pouch: {},
        garrison: {},
        heroLevel: 1,
        heroReadyAt: null,
        shieldUntil: null,
        lastTickAt: now,

        // Lifetime counters. These feed the profile and the quest ladder, so a
        // hold at Town Hall 1 with four hundred raids behind it would be a
        // profile that does not describe the base it is attached to.
        collected: 0,
        trainedTotal: 0,
        raids: 0,
        wins: 0,
        threeStars: 0,
        claimedQuests: [],

        // Today, and the streak that counts days in a row.
        dayKey: 0,
        dayCollected: 0,
        dayTrained: 0,
        dayWins: 0,
        dayRaids: 0,
        dayStars: 0,
        dayThreeStars: 0,
        dayLootGold: 0,
        dayUpgrades: 0,
        dailyClaimed: [],
        streakDays: 0,

        // The night world, un-founded.
        nightGold: BigInt(0),
        nightIron: BigInt(0),
        nightBuilders: STARTING_BUILDERS,
        nightTrophies: 0,
        nightTickAt: now,
        nightStartedAt: null,

        /*
         * Caught up on the notes, exactly as a new account is.
         *
         * A reset is not a new player meeting the game for the first time — it
         * is this player starting the base again — and opening on nine notes
         * about features they have already seen is noise, not news.
         */
        newsSeen: NEWS_LATEST,
      },
    });
  }, { maxWait: 20_000, timeout: 120_000 });

  console.log(`  ${WORLD_NAME[DAY]}: ${OPENING.length} buildings at level 1`);
  console.log(`    ${START_GOLD} gold · ${START_IRON} iron · ${STARTING_BUILDERS} builders`);
  console.log(`  ${WORLD_NAME[NIGHT]}: not founded — the boat lays it again at Town Hall 4`);
  console.log('  hero 1 · no relics · no pouch · no trophies · quests and streak cleared');
  console.log('  kept: the account, the invitation code, the clan seat, and every raid already fought');
  console.log('Done. Reload the game.');
}

main()
  .catch((e: unknown) => { console.error(e); process.exit(1); })
  .finally(() => void db.$disconnect());
