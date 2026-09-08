import { randomBytes } from 'node:crypto';
import type { BaseSnapshot, BattleArmy, DeployCommand, HeroLoadout, ItemCommand, TroopLevels } from '@ironvow/types';
import { parsePouch } from '@ironvow/config';
import type { Raid } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Replays anybody can watch.
 *
 * A player who wins a fight worth talking about has, until now, had no way to
 * show it to anybody. The whole battle is already stored — seed, snapshot,
 * army, every deploy command — and the same simulation runs in the browser, so
 * the missing piece was never the data. It was that the endpoint answers 403 to
 * everybody who was not in the fight.
 *
 * Watching does not need an account, and must not need one: a link that opens
 * a sign-up form is a link nobody clicks twice.
 */

/**
 * Twelve URL-safe characters from nine random bytes.
 *
 * Not the raid id. Sharing one fight must not hand out a key that can be walked
 * to the next fight, and cuids sort by creation time — publishing one would
 * publish roughly where in the table to look for the others.
 */
export function newShareId(): string {
  return randomBytes(9).toString('base64url');
}

/** What the fight was, small enough for a link preview. */
export interface ShareCard {
  shareId: string;
  attacker: string;
  defender: string;
  stars: number;
  destroyedPct: number;
  loot: { g: number; i: number };
  at: string;
}

/** Everything needed to replay the fight in a browser. */
export interface SharedReplay extends ShareCard {
  seed: number;
  snapshot: BaseSnapshot;
  army: BattleArmy;
  hero: HeroLoadout;
  troopLevels: TroopLevels;
  commands: DeployCommand[];
  pouch: ReturnType<typeof parsePouch>;
  items: ItemCommand[];
}

/** Only a finished fight can be watched: an open raid has no commands yet. */
export function shareable(raid: Pick<Raid, 'status' | 'commands'>): boolean {
  return raid.status === 'resolved' && raid.commands !== null;
}

/**
 * Start sharing, or return the link that already exists.
 *
 * Re-sharing keeps the original token on purpose. A player who withdraws a
 * replay and changes their mind gets the same address back, so a link already
 * posted somewhere starts working again instead of staying dead.
 */
export async function share(raidId: string): Promise<string> {
  const existing = await prisma.raid.findUnique({ where: { id: raidId }, select: { shareId: true } });
  const shareId = existing?.shareId ?? newShareId();
  await prisma.raid.update({
    where: { id: raidId },
    data: { shareId, sharedAt: new Date() },
  });
  return shareId;
}

/**
 * Stop sharing.
 *
 * Clears the date and keeps the token, which is what makes re-sharing return
 * the same address. `sharedAt` is therefore the field that decides whether a
 * link answers, not `shareId`.
 */
export async function unshare(raidId: string): Promise<void> {
  await prisma.raid.update({ where: { id: raidId }, data: { sharedAt: null } });
}

/** The shared raid behind a token, or null when there is no live link. */
export async function findShared(shareId: string): Promise<Raid | null> {
  const raid = await prisma.raid.findUnique({ where: { shareId } });
  if (!raid || raid.sharedAt === null || !shareable(raid)) return null;
  return raid;
}

/**
 * The headline, for a link preview and for the page before the fight loads.
 *
 * Names come from the snapshot for the defender, because a raid against a
 * generated base has no defender row to read one from.
 */
export function cardOf(raid: Raid, attackerName: string): ShareCard {
  const snapshot = raid.snapshot as unknown as BaseSnapshot;
  return {
    shareId: raid.shareId!,
    attacker: attackerName,
    defender: snapshot.defenderName,
    stars: raid.stars,
    destroyedPct: raid.destroyedPct,
    loot: { g: Number(raid.lootGold), i: Number(raid.lootIron) },
    at: (raid.resolvedAt ?? raid.createdAt).toISOString(),
  };
}

/**
 * The full replay, for a viewer who is not signed in and may not have an
 * account at all.
 *
 * The snapshot is passed through untouched but for the defender's player id,
 * which nothing in the simulation reads and which has no business being in a
 * public payload. Everything else has to stay exactly as the fight was fought:
 * strip a building or round a number and the browser's replay stops matching
 * the one the server resolved, which is the only thing making it true.
 *
 * `checksum` is not published. It is an anti-cheat internal, and handing an
 * attacker the number their forged client has to reproduce is the one thing it
 * must never do.
 */
export function replayOf(raid: Raid, attackerName: string): SharedReplay {
  const snapshot = raid.snapshot as unknown as BaseSnapshot;
  return {
    ...cardOf(raid, attackerName),
    seed: Number(raid.seed),
    snapshot: { ...snapshot, defenderId: '' },
    army: raid.army as unknown as BattleArmy,
    hero: (raid.hero as unknown as HeroLoadout | null) ?? { level: 1, available: false },
    troopLevels: (raid.troopLevels as unknown as TroopLevels | null) ?? {},
    commands: raid.commands as unknown as DeployCommand[],
    pouch: parsePouch(raid.pouch),
    items: (raid.items as unknown as ItemCommand[] | null) ?? [],
  };
}
