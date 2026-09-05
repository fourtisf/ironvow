import {
  RAID_EXPIRY_MINUTES,
  SCOUT_REROLL_COST,
  TROOP_ORDER,
  heroRespawnMinutes,
  heroUnlocked,
  type BuildingType,
  type TroopType,
} from '@ironvow/config';
import { randomSeed, seedToInt32, simulate } from '@ironvow/sim';
import type { BaseSnapshot, BattleArmy, DeployCommand, DeployableType, HeroLoadout, TroopLevels } from '@ironvow/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { debitDefender, revengeCutoff, settleRaid, snapshotBase, trophyBand } from '../domain/raid.js';
import { grant } from '../domain/production.js';
import { requireAuth } from '../lib/auth.js';
import { lockPlayer, settleAndLoad } from '../lib/player.js';
import { COMMAND_TX, prisma } from '../lib/prisma.js';
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

const submitSchema = z.object({
  commands: z.array(commandSchema).max(400),
  /** Optional, for divergence telemetry only. Never used to decide anything. */
  clientChecksum: z.string().max(64).optional(),
  clientStars: z.number().int().min(0).max(3).optional(),
});

function armyOf(army: Partial<Record<TroopType, number>>): BattleArmy {
  return {
    raider: army.raider ?? 0,
    archer: army.archer ?? 0,
    lancer: army.lancer ?? 0,
    ram: army.ram ?? 0,
  };
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
  app.post('/raid/find', async (request, reply) => {
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
      const excluded = new Set<string>([me.id, ...recent.map((r) => r.defenderId)]);

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
      if (!opponent) return { kind: 'none' as const };

      const withBuildings = opponent as typeof opponent & {
        buildings: {
          id: string; type: string; gx: number; gy: number; level: number;
          completesAt: Date | null; upgradingTo: number | null;
        }[];
      };

      const snapshot = snapshotBase({
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
          seed: BigInt(randomSeed()),
          snapshot: snapshot as unknown as object,
          army: armyOf(me.army) as unknown as object,
          // Frozen for the same reason as the warband: upgrading the hero or
          // the lab mid-raid would change what a replay is allowed to field.
          hero: {
            level: me.heroLevel,
            available: heroUnlocked(me.keepLevel) && me.heroReadyAt === null,
          } satisfies HeroLoadout as unknown as object,
          troopLevels: me.troopLevels as unknown as object,
          expiresAt: new Date(now.getTime() + RAID_EXPIRY_MINUTES * 60_000),
        },
      });
      return { kind: 'new' as const, raid, player: await settleAndLoad(tx, me.id) };
    }, COMMAND_TX);

    if (result.kind === 'none') return reply.code(404).send({ error: 'noOpponent' });
    if (result.kind === 'poor') return reply.code(409).send({ error: 'cannotAfford' });

    const snapshot = result.raid.snapshot as unknown as BaseSnapshot;
    return reply.send({
      raidId: result.raid.id,
      seed: Number(result.raid.seed),
      snapshot,
      army: result.raid.army as unknown as BattleArmy,
      hero: (result.raid.hero as unknown as HeroLoadout | null) ?? { level: 1, available: false },
      troopLevels: (result.raid.troopLevels as unknown as TroopLevels | null) ?? {},
      expiresAt: result.raid.expiresAt.toISOString(),
      rerollCost: SCOUT_REROLL_COST,
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
      // at each other cannot deadlock.
      const [first, second] = [raid.attackerId, raid.defenderId].sort();
      await lockPlayer(tx, first!);
      if (second !== first) await lockPlayer(tx, second!);

      const attacker = await settleAndLoad(tx, raid.attackerId, now);
      const snapshot = raid.snapshot as unknown as BaseSnapshot;
      // The frozen warband, not the current one: the client fought with what it
      // had when the raid opened, and a replay must be able to do the same.
      const army = raid.army as unknown as BattleArmy;
      const hero = (raid.hero as unknown as HeroLoadout | null) ?? { level: 1, available: false };
      const troopLevels = (raid.troopLevels as unknown as TroopLevels | null) ?? {};

      const sim = simulate({
        snapshot,
        commands: parsed.data.commands,
        army,
        seed: seedToInt32(raid.seed),
        hero,
        troopLevels,
      });

      const defender = await tx.player.findUnique({
        where: { id: raid.defenderId },
        select: { gold: true, iron: true, trophies: true },
      });
      if (!defender) return { kind: 'notFound' as const };

      const settlement = settleRaid({
        stars: sim.stars,
        simLoot: sim.loot,
        defenderGold: defender.gold,
        defenderIron: defender.iron,
        defenderTrophies: defender.trophies,
        now,
      });

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
          // War Order counters. Derived from the server's own result, never
          // from anything the client claimed about the battle.
          raids: { increment: 1 },
          ...(sim.stars >= 1 ? { wins: { increment: 1 } } : {}),
          ...(sim.stars === 3 ? { threeStars: { increment: 1 } } : {}),
          // A fallen hero is away for a while. That cost is what makes
          // committing it a decision rather than a reflex.
          ...(sim.heroDied
            ? { heroReadyAt: new Date(now.getTime() + heroRespawnMinutes(hero.level) * 60_000) }
            : {}),
        },
      });

      /* --- the defender pays, and is shielded if they were hurt --- */
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

      const saved = await tx.raid.update({
        where: { id: raid.id },
        data: {
          status: 'resolved',
          commands: parsed.data.commands as unknown as object,
          stars: sim.stars,
          destroyedPct: sim.destroyedPct,
          lootGold: BigInt(settlement.loot.g),
          lootIron: BigInt(settlement.loot.i),
          trophyDelta: settlement.trophyDelta,
          checksum: sim.checksum,
          resolvedAt: now,
        },
      });

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
        player: await settleAndLoad(tx, attacker.id, now),
      };
    }, COMMAND_TX);

    if (outcome.kind === 'notFound') return reply.code(404).send({ error: 'noSuchRaid' });
    if (outcome.kind === 'notYours') return reply.code(403).send({ error: 'notYours' });
    if (outcome.kind === 'expired') return reply.code(410).send({ error: 'raidExpired' });
    if (outcome.kind === 'alreadyResolved') {
      return reply.code(409).send({ error: 'alreadyResolved', stars: outcome.raid.stars });
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
      player: serialise(outcome.player),
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
      })),
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
      attackerName: attacker?.name ?? 'Unknown',
      stars: raid.stars,
      destroyedPct: raid.destroyedPct,
      loot: { g: Number(raid.lootGold), i: Number(raid.lootIron) },
      checksum: raid.checksum,
    });
  });
}
