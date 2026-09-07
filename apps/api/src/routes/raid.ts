import {
  RAID_EXPIRY_MINUTES,
  SCOUT_REROLL_COST,
  SEASON_TIERS,
  nextTier,
  seasonLeft,
  seasonReset,
  tierAt,
  ITEM_TYPES,
  parseGarrison,
  parsePouch,
  type ItemType,
  type Pouch,
  TROOP_ORDER,
  heroRespawnMinutes,
  heroUnlocked,
  stageFromTrophies,
  type BuildingType,
  type TroopType,
} from '@ironvow/config';
import {
  garrisonName,
  generateDefendWave,
  generateOpponent,
  randomSeed,
  seedToInt32,
  simulate,
} from '@ironvow/sim';
import type { BaseSnapshot, BattleArmy, DeployCommand, DeployableType, HeroLoadout, ItemCommand, TroopLevels } from '@ironvow/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { debitDefender, revengeCutoff, settleRaid, snapshotBase, trophyBand } from '../domain/raid.js';
import { grant } from '../domain/production.js';
import { requireAuth } from '../lib/auth.js';
import { lockPlayer, settleAndLoad } from '../lib/player.js';
import { peakAfter, standing } from '../lib/seasons.js';
import { COMMAND_TX, prisma } from '../lib/prisma.js';
import { pushRaided } from '../lib/push.js';
import { recordWarAttack } from '../lib/war.js';
import { serialise } from './auth.js';

/**
 * Raiding.
 *
 * The contract with the client is deliberately thin: it asks for an opponent,
 * receives a frozen snapshot and a raid id, and later sends back the ordered
 * deploys it made. It never sends stars, loot or damage — the server replays
 * the same commands through @ironvow/sim and writes down what it finds.
 */

const findSchema = z.object({ reroll: z.boolean().default(false) });

const DEPLOYABLE = [...TROOP_ORDER, 'hero'] as const;

const commandSchema = z.object({
  tickIndex: z.number().int().min(0).max(20_000),
  troopType: z.enum(DEPLOYABLE as unknown as [DeployableType, ...DeployableType[]]),
  gx: z.number().min(-10).max(70),
  gy: z.number().min(-10).max(70),
});

/**
 * A battle item used.
 *
 * Bounded at a number no honest pouch can reach, because the cap that matters
 * is the frozen pouch inside the simulation and this is only here to stop a
 * megabyte of JSON reaching it.
 */
const itemCommandSchema = z.object({
  tickIndex: z.number().int().min(0).max(20_000),
  item: z.enum(ITEM_TYPES),
  gx: z.number().min(-10).max(70),
  gy: z.number().min(-10).max(70),
});

const submitSchema = z.object({
  commands: z.array(commandSchema).max(400),
  /** Absent from a client that used none, and from every client built before items. */
  items: z.array(itemCommandSchema).max(40).optional(),
  /** Optional, for divergence telemetry only. Never used to decide anything. */
  clientChecksum: z.string().max(64).optional(),
  clientStars: z.number().int().min(0).max(3).optional(),
});

/**
 * Fill in every troop type, including ones the player has never trained.
 *
 * Built from TROOP_ORDER rather than spelled out, so a new troop is one edit in
 * `@ironvow/config` and not a silent zero here. It also normalises an old
 * raid's frozen warband, which predates whatever was added since.
 */
export function armyOf(army: Partial<Record<TroopType, number>>): BattleArmy {
  const out = {} as BattleArmy;
  for (const t of TROOP_ORDER) out[t] = army[t] ?? 0;
  return out;
}

export async function raidRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * Find an opponent and open a raid.
   *
   * Scouting is the point: the response carries the defender's actual layout so
   * the player can look before committing (spec S8.1). Rerolling costs gold,
   * charged here rather than trusted from the client.
   */
  /*
   * Rate limited harder than the rest.
   *
   * Matchmaking is the most expensive thing the server does: it widens the
   * trophy band up to twelve times, each a query, then snapshots a whole base.
   * The global ceiling of 300 a minute would let one player fire three hundred
   * of those, and the reroll path charges gold precisely so it is not free.
   */
  app.post('/raid/find', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = findSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      await lockPlayer(tx, request.playerId!);
      const me = await settleAndLoad(tx, request.playerId!, now);

      // Expire any raid this player left open, then enforce one at a time.
      await tx.raid.updateMany({
        where: { attackerId: me.id, status: 'open', expiresAt: { lte: now } },
        data: { status: 'expired' },
      });
      const open = await tx.raid.findFirst({
        where: { attackerId: me.id, status: 'open' },
        orderBy: { createdAt: 'desc' },
      });

      if (open && !parsed.data.reroll) {
        return { kind: 'existing' as const, raid: open, player: me };
      }

      let gold = me.gold;
      if (open && parsed.data.reroll) {
        if (gold < BigInt(SCOUT_REROLL_COST)) {
          return { kind: 'poor' as const };
        }
        gold -= BigInt(SCOUT_REROLL_COST);
        await tx.raid.update({ where: { id: open.id }, data: { status: 'expired' } });
        await tx.player.update({ where: { id: me.id }, data: { gold } });
      }

      const recent = await tx.raid.findMany({
        where: { attackerId: me.id, createdAt: { gte: revengeCutoff(now) } },
        select: { defenderId: true },
      });
      // Raids against generated holds carry no defender id and exclude nobody.
      const excluded = new Set<string>([
        me.id,
        ...recent.map((r) => r.defenderId).filter((id): id is string => id !== null),
      ]);

      // Widen the trophy band on each attempt until somebody qualifies.
      let opponent: Awaited<ReturnType<typeof tx.player.findFirst>> = null;
      for (let attempt = 0; attempt < 12 && !opponent; attempt++) {
        const band = trophyBand(me.trophies, attempt);
        opponent = await tx.player.findFirst({
          where: {
            id: { notIn: [...excluded] },
            trophies: { gte: band.lo, lte: band.hi },
            OR: [{ shieldUntil: null }, { shieldUntil: { lte: now } }],
          },
          include: { buildings: true },
          orderBy: { trophies: 'asc' },
        });
      }
      /*
       * No human in band, so fall back to a generated hold.
       *
       * This is the floor under matchmaking, not a substitute for it: the band
       * has already widened twelve times looking for a real player. Without it
       * the first player on a new server presses RAID and nothing happens,
       * which is the worst possible answer to the most important button.
       */
      if (!opponent) {
        const seed = randomSeed();
        const stage = stageFromTrophies(me.trophies);
        const snapshot = generateOpponent(stage, 'ai', garrisonName(seed), seed);

        const raid = await tx.raid.create({
          data: {
            attackerId: me.id,
            defenderId: null,
            seed: BigInt(seed),
            snapshot: snapshot as unknown as object,
            army: armyOf(me.army) as unknown as object,
            hero: {
              level: me.heroLevel,
              available: heroUnlocked(me.keepLevel) && me.heroReadyAt === null,
            } satisfies HeroLoadout as unknown as object,
            troopLevels: me.troopLevels as unknown as object,
            pouch: me.pouch as unknown as object,
            expiresAt: new Date(now.getTime() + RAID_EXPIRY_MINUTES * 60_000),
          },
        });
        return { kind: 'new' as const, raid, player: await settleAndLoad(tx, me.id) };
      }

      const withBuildings = opponent as typeof opponent & {
        garrison: unknown;
        buildings: {
          id: string; type: string; gx: number; gy: number; level: number;
          completesAt: Date | null; upgradingTo: number | null;
        }[];
      };

      // Rolled before the snapshot, because the snapshot is what freezes where
      // the garrison stands and a replay has to land them in the same spots.
      const seed = randomSeed();
      const snapshot = snapshotBase({
        seed,
        garrison: parseGarrison(withBuildings.garrison),
        id: withBuildings.id,
        name: withBuildings.name,
        keepLevel: withBuildings.keepLevel,
        gold: withBuildings.gold,
        iron: withBuildings.iron,
        buildings: withBuildings.buildings
          // A building still going up is scaffolding: it does not defend, does
          // not hold loot, and is not something an attacker can knock over. One
          // being upgraded is a real building at its current level and stays.
          .filter((b) => !(b.completesAt !== null && b.upgradingTo === null))
          .map((b) => ({
            id: b.id, type: b.type as BuildingType, gx: b.gx, gy: b.gy, level: b.level,
          })),
      });

      const raid = await tx.raid.create({
        data: {
          attackerId: me.id,
          defenderId: withBuildings.id,
          seed: BigInt(seed),
          snapshot: snapshot as unknown as object,
          army: armyOf(me.army) as unknown as object,
          // Frozen for the same reason as the warband: upgrading the hero or
          // the lab mid-raid would change what a replay is allowed to field.
          hero: {
            level: me.heroLevel,
            available: heroUnlocked(me.keepLevel) && me.heroReadyAt === null,
          } satisfies HeroLoadout as unknown as object,
          troopLevels: me.troopLevels as unknown as object,
          pouch: me.pouch as unknown as object,
          expiresAt: new Date(now.getTime() + RAID_EXPIRY_MINUTES * 60_000),
        },
      });
      return { kind: 'new' as const, raid, player: await settleAndLoad(tx, me.id) };
    }, COMMAND_TX);


    if (result.kind === 'poor') return reply.code(409).send({ error: 'cannotAfford' });

    const snapshot = result.raid.snapshot as unknown as BaseSnapshot;
    return reply.send({
      raidId: result.raid.id,
      seed: Number(result.raid.seed),
      snapshot,
      army: result.raid.army as unknown as BattleArmy,
      hero: (result.raid.hero as unknown as HeroLoadout | null) ?? { level: 1, available: false },
      troopLevels: (result.raid.troopLevels as unknown as TroopLevels | null) ?? {},
      pouch: parsePouch(result.raid.pouch),
      expiresAt: result.raid.expiresAt.toISOString(),
      rerollCost: SCOUT_REROLL_COST,
      /** False for a generated hold, so the client can say so plainly. */
      isPlayer: result.raid.defenderId !== null,
      player: serialise(result.player),
    });
  });

  /**
   * Hit back at someone who raided you.
   *
   * The attack log was watchable but not answerable, which made it a record
   * rather than a hook. Revenge skips the trophy band and the twelve-hour
   * cooldown deliberately — the point is to go after that specific player —
   * but every other rule holds: they must still be unshielded, and the base is
   * snapshotted fresh at the moment the raid opens, not as it stood when they
   * hit you.
   */
  app.post('/raid/revenge', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = z.object({ raidId: z.string().min(1).max(40) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const source = await tx.raid.findUnique({ where: { id: parsed.data.raidId } });
      if (!source) return { kind: 'notFound' as const };
      // Only the player who was raided may answer it.
      if (source.defenderId !== request.playerId) return { kind: 'notYours' as const };
      if (source.status !== 'resolved') return { kind: 'notFound' as const };

      await lockPlayer(tx, request.playerId!);
      const me = await settleAndLoad(tx, request.playerId!, now);

      await tx.raid.updateMany({
        where: { attackerId: me.id, status: 'open' },
        data: { status: 'expired' },
      });

      const target = await tx.player.findUnique({
        where: { id: source.attackerId },
        include: { buildings: true },
      });
      if (!target) return { kind: 'goneAway' as const };
      if (target.shieldUntil && target.shieldUntil.getTime() > now.getTime()) {
        return { kind: 'shielded' as const };
      }

      const seed = randomSeed();
      const snapshot = snapshotBase({
        seed,
        garrison: parseGarrison(target.garrison),
        id: target.id,
        name: target.name,
        keepLevel: target.keepLevel,
        gold: target.gold,
        iron: target.iron,
        buildings: target.buildings
          .filter((b) => !(b.completesAt !== null && b.upgradingTo === null))
          .map((b) => ({
            id: b.id, type: b.type as BuildingType, gx: b.gx, gy: b.gy, level: b.level,
          })),
      });

      const raid = await tx.raid.create({
        data: {
          attackerId: me.id,
          defenderId: target.id,
          seed: BigInt(seed),
          snapshot: snapshot as unknown as object,
          army: armyOf(me.army) as unknown as object,
          hero: {
            level: me.heroLevel,
            available: heroUnlocked(me.keepLevel) && me.heroReadyAt === null,
          } satisfies HeroLoadout as unknown as object,
          troopLevels: me.troopLevels as unknown as object,
          pouch: me.pouch as unknown as object,
          expiresAt: new Date(now.getTime() + RAID_EXPIRY_MINUTES * 60_000),
        },
      });
      return { kind: 'new' as const, raid, player: await settleAndLoad(tx, me.id) };
    }, COMMAND_TX);

    if (result.kind === 'notFound') return reply.code(404).send({ error: 'noSuchRaid' });
    if (result.kind === 'notYours') return reply.code(403).send({ error: 'notYours' });
    if (result.kind === 'goneAway') return reply.code(410).send({ error: 'playerGone' });
    if (result.kind === 'shielded') return reply.code(409).send({ error: 'shielded' });

    return reply.send({
      raidId: result.raid.id,
      seed: Number(result.raid.seed),
      snapshot: result.raid.snapshot as unknown as BaseSnapshot,
      army: result.raid.army as unknown as BattleArmy,
      hero: (result.raid.hero as unknown as HeroLoadout | null) ?? { level: 1, available: false },
      troopLevels: (result.raid.troopLevels as unknown as TroopLevels | null) ?? {},
      pouch: parsePouch(result.raid.pouch),
      expiresAt: result.raid.expiresAt.toISOString(),
      rerollCost: SCOUT_REROLL_COST,
      isPlayer: true,
      player: serialise(result.player),
    });
  });

  /** Re-read an open raid, so a reload mid-scout does not lose it. */
  app.get<{ Params: { id: string } }>('/raid/:id', async (request, reply) => {
    const raid = await prisma.raid.findUnique({ where: { id: request.params.id } });
    if (!raid) return reply.code(404).send({ error: 'noSuchRaid' });
    if (raid.attackerId !== request.playerId && raid.defenderId !== request.playerId) {
      return reply.code(403).send({ error: 'notYours' });
    }
    return reply.send({
      raidId: raid.id,
      status: raid.status,
      seed: Number(raid.seed),
      snapshot: raid.snapshot as unknown as BaseSnapshot,
      army: raid.army as unknown as BattleArmy,
      commands: (raid.commands as unknown as DeployCommand[] | null) ?? null,
      stars: raid.stars,
      destroyedPct: raid.destroyedPct,
      loot: { g: Number(raid.lootGold), i: Number(raid.lootIron) },
      trophyDelta: raid.trophyDelta,
      createdAt: raid.createdAt.toISOString(),
      expiresAt: raid.expiresAt.toISOString(),
    });
  });

  /**
   * Submit a raid.
   *
   * The body is a list of deploys and nothing else. The server replays them
   * through the same simulation the client rendered, and the result it computes
   * is the result — a client that claims otherwise is simply ignored, and the
   * disagreement is logged so a determinism bug shows up as a spike rather than
   * as a slow drip of wrong payouts (spec S4.6).
   */
  app.post<{ Params: { id: string } }>('/raid/:id/submit', async (request, reply) => {
    const parsed = submitSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'badRequest' });

    const now = new Date();
    const outcome = await prisma.$transaction(async (tx) => {
      const raid = await tx.raid.findUnique({ where: { id: request.params.id } });
      if (!raid) return { kind: 'notFound' as const };
      if (raid.attackerId !== request.playerId) return { kind: 'notYours' as const };
      if (raid.status !== 'open') return { kind: 'alreadyResolved' as const, raid };
      if (raid.expiresAt.getTime() <= now.getTime()) {
        await tx.raid.update({ where: { id: raid.id }, data: { status: 'expired' } });
        return { kind: 'expired' as const };
      }

      // Lock both sides in a fixed id order, so two raids that happen to point
      // at each other cannot deadlock. A generated hold has nothing to lock.
      const ids = [raid.attackerId, ...(raid.defenderId ? [raid.defenderId] : [])].sort();
      for (const id of ids) await lockPlayer(tx, id);

      const attacker = await settleAndLoad(tx, raid.attackerId, now);
      const snapshot = raid.snapshot as unknown as BaseSnapshot;
      // The frozen warband, not the current one: the client fought with what it
      // had when the raid opened, and a replay must be able to do the same.
      const army = raid.army as unknown as BattleArmy;
      const hero = (raid.hero as unknown as HeroLoadout | null) ?? { level: 1, available: false };
      const troopLevels = (raid.troopLevels as unknown as TroopLevels | null) ?? {};
      // The frozen pouch, for the same reason as the warband: buying a Warhorn
      // while this raid was open must not let it be spent inside this raid.
      const pouch = parsePouch(raid.pouch);
      const items = parsed.data.items ?? [];

      const sim = simulate({
        snapshot,
        commands: parsed.data.commands,
        army,
        seed: seedToInt32(raid.seed),
        hero,
        troopLevels,
        pouch,
        items,
      });

      /*
       * What the pouch actually paid for this raid.
       *
       * Counted from the commands the simulation *accepted*, never from the
       * list the client sent: a client that submits ten Warhorns with one in
       * the pouch has nine rejected, and must be charged for the one.
       */
      const refused = new Set(sim.rejected.map((r) => r.index));
      const usedItems: Partial<Record<ItemType, number>> = {};
      items.forEach((cmd, i) => {
        if (refused.has(i)) return;
        usedItems[cmd.item] = (usedItems[cmd.item] ?? 0) + 1;
      });

      // A generated hold has no row to read and nothing to lose. Its loot comes
      // from the stage curve already frozen into the snapshot, so the attacker
      // is paid without anybody being charged.
      const defender = raid.defenderId
        ? await tx.player.findUnique({
            where: { id: raid.defenderId },
            select: { gold: true, iron: true, trophies: true },
          })
        : null;
      if (raid.defenderId && !defender) return { kind: 'notFound' as const };

      // A war attack is scored, not paid: the frozen roster base has an empty
      // pool, nobody is robbed for being on a roster, and trophies stay put.
      // The war reads the stars; the reward comes when the war ends.
      const isWar = raid.warId !== null;
      if (isWar) {
        const war = await tx.clanWar.findUnique({ where: { id: raid.warId! }, select: { state: true, endsAt: true } });
        if (!war || war.state !== 'active' || !war.endsAt || war.endsAt.getTime() <= now.getTime()) {
          await tx.raid.update({ where: { id: raid.id }, data: { status: 'expired' } });
          return { kind: 'warOver' as const };
        }
      }
      const settlement = isWar
        ? { loot: { g: 0, i: 0 }, trophyDelta: 0, shieldUntil: null }
        : settleRaid({
          stars: sim.stars,
          simLoot: sim.loot,
          // Against a generated hold the pool is the cap, so pass it through.
          defenderGold: defender?.gold ?? BigInt(snapshot.pool.g),
          defenderIron: defender?.iron ?? BigInt(snapshot.pool.i),
          defenderTrophies: defender?.trophies ?? stageFromTrophies(attacker.trophies) * 120,
          now,
        });

      /*
       * The defender's garrison is spent, whatever happened to it.
       *
       * A garrison that survives is a garrison nobody ever asks their clan for
       * again, and the asking is the whole point of having one. Only on a real
       * raid: a war attack is scored against a frozen roster base and nobody's
       * hold is actually touched.
       */
      if (!isWar && raid.defenderId && snapshot.garrison && snapshot.garrison.length > 0) {
        await tx.player.update({ where: { id: raid.defenderId }, data: { garrison: {} } });
      }

      /* --- the attacker spends the troops they deployed, wins or loses --- */
      const spent: Partial<Record<TroopType, number>> = {};
      const rejectedIndexes = new Set(sim.rejected.map((r) => r.index));
      parsed.data.commands.forEach((c, i) => {
        if (rejectedIndexes.has(i)) return;
        // The hero costs no warband room and is not drawn from any count.
        if (c.troopType === 'hero') return;
        spent[c.troopType] = (spent[c.troopType] ?? 0) + 1;
      });
      for (const type of TROOP_ORDER) {
        const n = spent[type];
        if (!n) continue;
        await tx.troop.update({
          where: { playerId_type: { playerId: attacker.id, type } },
          data: { count: Math.max(0, (attacker.army[type] ?? 0) - n) },
        });
      }

      const credited = grant(
        attacker.gold,
        attacker.iron,
        settlement.loot.g,
        settlement.loot.i,
        attacker.buildings.map((b) => ({ type: b.type as BuildingType, level: b.level })),
      );
      await tx.player.update({
        where: { id: attacker.id },
        data: {
          gold: credited.gold,
          iron: credited.iron,
          trophies: Math.max(0, attacker.trophies + settlement.trophyDelta),
          // The season is paid on the highest total reached, so the watermark
          // moves here, in the same write that moved the trophies. A losing
          // raid leaves it exactly where it was, which is the point of it.
          seasonPeak: peakAfter(
            attacker.seasonPeak,
            Math.max(0, attacker.trophies + settlement.trophyDelta),
          ),
          // War Order counters. Derived from the server's own result, never
          // from anything the client claimed about the battle.
          raids: { increment: 1 },
          ...(sim.stars >= 1 ? { wins: { increment: 1 } } : {}),
          ...(sim.stars === 3 ? { threeStars: { increment: 1 } } : {}),
          // The same figures again for today only. Daily orders are measured
          // off these; the settle at the top of the request has already zeroed
          // them if this is the first raid after midnight.
          dayRaids: { increment: 1 },
          dayStars: { increment: sim.stars },
          ...(sim.stars >= 1 ? { dayWins: { increment: 1 } } : {}),
          ...(sim.stars === 3 ? { dayThreeStars: { increment: 1 } } : {}),
          // What was actually carried off, not what was on the table: a raid
          // that wins nothing counts nothing toward a plunder order.
          dayLootGold: { increment: Number(settlement.loot.g) },
          // A fallen hero is away for a while. That cost is what makes
          // committing it a decision rather than a reflex.
          ...(sim.heroDied
            ? { heroReadyAt: new Date(now.getTime() + heroRespawnMinutes(hero.level) * 60_000) }
            : {}),
        },
      });

      /* --- the defender pays, and is shielded if they were hurt --- */
      if (raid.defenderId && defender && !isWar) {
        const debited = debitDefender(defender.gold, defender.iron, settlement.loot);
        await tx.player.update({
          where: { id: raid.defenderId },
          data: {
            gold: debited.gold,
            iron: debited.iron,
            trophies: Math.max(0, defender.trophies - settlement.trophyDelta),
            ...(settlement.shieldUntil ? { shieldUntil: settlement.shieldUntil } : {}),
          },
        });
      }

      if (Object.keys(usedItems).length > 0) {
        const live = parsePouch(attacker.pouch);
        const after: Pouch = {};
        for (const t of ITEM_TYPES) {
          const left = Math.max(0, (live[t] ?? 0) - (usedItems[t] ?? 0));
          // Zeroes are dropped rather than stored. An empty pouch is `{}`,
          // which is what a hold that has never bought one also has, so there
          // is one representation of "none" instead of two.
          if (left > 0) after[t] = left;
        }
        // Read from the live pouch rather than the frozen one, so two raids
        // resolving out of order cannot restore an item the other spent.
        await tx.player.update({
          where: { id: attacker.id }, data: { pouch: after as unknown as object },
        });
      }

      const saved = await tx.raid.update({
        where: { id: raid.id },
        data: {
          status: 'resolved',
          commands: parsed.data.commands as unknown as object,
          items: items.length > 0 ? (items as unknown as object) : undefined,
          stars: sim.stars,
          destroyedPct: sim.destroyedPct,
          lootGold: BigInt(settlement.loot.g),
          lootIron: BigInt(settlement.loot.i),
          trophyDelta: settlement.trophyDelta,
          checksum: sim.checksum,
          resolvedAt: now,
        },
      });

      if (isWar && raid.warMemberId) {
        await recordWarAttack(tx, {
          warId: raid.warId!,
          attackerPlayerId: attacker.id,
          defenderMemberId: raid.warMemberId,
          raidId: raid.id,
          stars: sim.stars,
          destroyedPct: sim.destroyedPct,
        });
      }

      if (parsed.data.clientChecksum && parsed.data.clientChecksum !== sim.checksum) {
        await tx.divergence.create({
          data: {
            raidId: raid.id,
            playerId: attacker.id,
            clientChecksum: parsed.data.clientChecksum,
            serverChecksum: sim.checksum,
            clientStars: parsed.data.clientStars ?? null,
            serverStars: sim.stars,
            userAgent: String(request.headers['user-agent'] ?? '').slice(0, 200),
          },
        });
      }

      return {
        kind: 'resolved' as const,
        sim,
        settlement,
        raid: saved,
        attackerName: attacker.name,
        player: await settleAndLoad(tx, attacker.id, now),
      };
    }, COMMAND_TX);

    if (outcome.kind === 'notFound') return reply.code(404).send({ error: 'noSuchRaid' });
    if (outcome.kind === 'notYours') return reply.code(403).send({ error: 'notYours' });
    if (outcome.kind === 'expired') return reply.code(410).send({ error: 'raidExpired' });
    if (outcome.kind === 'warOver') return reply.code(410).send({ error: 'warOver' });
    if (outcome.kind === 'alreadyResolved') {
      return reply.code(409).send({ error: 'alreadyResolved', stars: outcome.raid.stars });
    }

    // Fire-and-forget: a notification that does not arrive must never fail the
    // raid that produced it.
    if (outcome.raid.defenderId && outcome.raid.warId === null) {
      void pushRaided(
        outcome.raid.defenderId,
        outcome.attackerName,
        outcome.sim.stars,
        outcome.settlement.loot,
      ).catch(() => undefined);
    }

    if (outcome.sim.checksum !== parsed.data.clientChecksum && parsed.data.clientChecksum) {
      request.log.warn(
        { raidId: outcome.raid.id, client: parsed.data.clientChecksum, server: outcome.sim.checksum },
        'simulation divergence',
      );
    }

    return reply.send({
      raidId: outcome.raid.id,
      stars: outcome.sim.stars,
      destroyedPct: outcome.sim.destroyedPct,
      loot: outcome.settlement.loot,
      trophyDelta: outcome.settlement.trophyDelta,
      heroDied: outcome.sim.heroDied,
      heroDeployed: outcome.sim.heroDeployed,
      rejected: outcome.sim.rejected,
      checksum: outcome.sim.checksum,
      war: outcome.raid.warId !== null,
      player: serialise(outcome.player),
    });
  });

  /**
   * Hold your own walls.
   *
   * The simulation has supported this since it was written and nothing ever
   * called it: `generateDefendWave` existed, `defendWave` was in the snapshot
   * type, and no route reached either. So a player never actually defended —
   * they watched a replay of a raid after the fact.
   *
   * This is a drill rather than a real attack: nothing is at stake, nobody
   * loses resources, and it exists so a player can find out whether their
   * layout works before somebody else finds out for them. That makes it safe
   * to open as often as they like.
   */
  app.post('/defend', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const now = new Date();
    const me = await prisma.$transaction((tx) => settleAndLoad(tx, request.playerId!, now));

    const seed = randomSeed();
    const stage = stageFromTrophies(me.trophies);

    const snapshot: BaseSnapshot = {
      version: 1,
      defenderId: me.id,
      defenderName: me.name,
      keepLevel: me.keepLevel,
      buildings: me.buildings
        // Scaffolding does not defend, exactly as in a real raid.
        .filter((b) => !(b.completesAt !== null && b.upgradingTo === null))
        .map((b) => ({ id: b.id, type: b.type, gx: b.gx, gy: b.gy, level: b.level }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      // A drill takes nothing, so there is nothing on the table.
      pool: { g: 0, i: 0 },
      // Rolled here, where trigonometry is free to be engine-dependent, and
      // frozen so the client and any replay see the same wave.
      defendWave: generateDefendWave(seed, stage),
    };

    return reply.send({
      seed,
      snapshot,
      /** The warband you may throw in behind your own walls. */
      army: armyOf(me.army),
      hero: {
        level: me.heroLevel,
        available: heroUnlocked(me.keepLevel) && me.heroReadyAt === null,
      } satisfies HeroLoadout,
      troopLevels: me.troopLevels,
      stage,
      player: serialise(me),
    });
  });

  /**
   * Raids taken against me. The attack log, and the input to revenge.
   *
   * Every row here is replayable: seed plus snapshot plus commands reproduces
   * the battle exactly, so a defender can watch what happened rather than being
   * told a number (spec S8.5).
   */
  app.get('/raids/incoming', async (request, reply) => {
    const raids = await prisma.raid.findMany({
      where: { defenderId: request.playerId!, status: 'resolved' },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { attacker: { select: { id: true, name: true, trophies: true, keepLevel: true } } },
    });
    return reply.send({
      raids: raids.map((r) => ({
        raidId: r.id,
        attacker: r.attacker,
        stars: r.stars,
        destroyedPct: r.destroyedPct,
        lost: { g: Number(r.lootGold), i: Number(r.lootIron) },
        trophyDelta: -r.trophyDelta,
        at: r.createdAt.toISOString(),
        replayable: r.commands !== null,
        /** Whether the attacker is still around to be hit back. */
        avengeable: r.attacker !== null,
      })),
    });
  });

  /**
   * The ladder.
   *
   * Trophies existed with nothing to compare them against, which makes a number
   * rather than a competition. The player's own rank is computed even when they
   * are nowhere near the top, because that is the number they actually care
   * about.
   */
  app.get('/leaderboard', async (request, reply) => {
    const top = await prisma.player.findMany({
      orderBy: [{ trophies: 'desc' }, { createdAt: 'asc' }],
      take: 50,
      select: { id: true, name: true, trophies: true, keepLevel: true },
    });

    const me = await prisma.player.findUnique({
      where: { id: request.playerId! },
      select: { id: true, name: true, trophies: true, keepLevel: true, createdAt: true },
    });

    // Rank is the count of players strictly ahead, plus one. Ties break on who
    // got there first, matching the ordering above.
    const ahead = me
      ? await prisma.player.count({
          where: {
            OR: [
              { trophies: { gt: me.trophies } },
              { trophies: me.trophies, createdAt: { lt: me.createdAt } },
            ],
          },
        })
      : 0;

    return reply.send({
      top: top.map((p, i) => ({ ...p, rank: i + 1, isMe: p.id === request.playerId })),
      me: me ? { id: me.id, name: me.name, trophies: me.trophies, keepLevel: me.keepLevel, rank: ahead + 1 } : null,
      total: await prisma.player.count(),
    });
  });

  /**
   * The running season.
   *
   * Separate from `/leaderboard` because it answers a different question: not
   * "who is ahead" but "how long have I got, and what is the climb worth". The
   * previous season's receipt rides along, because the first thing anybody does
   * when a season ends is look for what they were paid.
   */
  app.get('/season', async (request, reply) => {
    const now = new Date();
    const s = await standing(request.playerId!, now);
    const tier = tierAt(s.peak);
    const next = nextTier(s.peak);
    return reply.send({
      index: s.season.index,
      startedAt: s.season.startedAt.toISOString(),
      endsAt: s.season.endsAt.toISOString(),
      msLeft: seasonLeft(s.season.endsAt, now),
      peak: s.peak,
      trophies: s.trophies,
      rank: s.rank,
      contenders: s.contenders,
      tier: tier ? { id: tier.id, n: tier.n, at: tier.at, reward: tier.reward } : null,
      next: next ? { id: next.id, n: next.n, at: next.at, reward: next.reward } : null,
      tiers: SEASON_TIERS.map((t) => ({ id: t.id, n: t.n, at: t.at, reward: t.reward })),
      resetTo: seasonReset(s.trophies),
      last: s.last,
    });
  });

  /** Everything needed to replay a stored raid client-side. */
  app.get<{ Params: { id: string } }>('/raid/:id/replay', async (request, reply) => {
    const raid = await prisma.raid.findUnique({ where: { id: request.params.id } });
    if (!raid) return reply.code(404).send({ error: 'noSuchRaid' });
    if (raid.attackerId !== request.playerId && raid.defenderId !== request.playerId) {
      return reply.code(403).send({ error: 'notYours' });
    }
    if (raid.status !== 'resolved' || !raid.commands) {
      return reply.code(409).send({ error: 'notReplayable' });
    }

    const attacker = await prisma.player.findUnique({
      where: { id: raid.attackerId },
      select: { name: true },
    });
    return reply.send({
      raidId: raid.id,
      seed: Number(raid.seed),
      snapshot: raid.snapshot as unknown as BaseSnapshot,
      army: raid.army as unknown as BattleArmy,
      hero: (raid.hero as unknown as HeroLoadout | null) ?? { level: 1, available: false },
      troopLevels: (raid.troopLevels as unknown as TroopLevels | null) ?? {},
      commands: raid.commands as unknown as DeployCommand[],
      // Both halves, or the replay is not the fight: the pouch bounds what the
      // items list is allowed to do, so a replay without it would reject the
      // very commands the live raid accepted.
      pouch: parsePouch(raid.pouch),
      items: (raid.items as unknown as ItemCommand[] | null) ?? [],
      attackerName: attacker?.name ?? 'Unknown',
      stars: raid.stars,
      destroyedPct: raid.destroyedPct,
      loot: { g: Number(raid.lootGold), i: Number(raid.lootIron) },
      checksum: raid.checksum,
    });
  });
}
