import {
  INVITE_ALPHABET,
  INVITE_LENGTH,
  INVITE_REWARD,
  INVITE_REWARD_KEEP_LEVEL,
  INVITE_WELCOME,
  normaliseInvite,
} from '@ironvow/config';
import { randomInt } from 'node:crypto';
import { prisma, type Tx } from '../lib/prisma.js';

/**
 * Invitations, server-side.
 *
 * Two rules hold this together and both are about not paying a script:
 *
 *  - The inviter is paid when the invited hold reaches
 *    `INVITE_REWARD_KEEP_LEVEL`, never at sign-up. A code that pays on a fresh
 *    account pays for account farms.
 *  - It is paid once, and the once is enforced by the row rather than by the
 *    caller: `invitePaidAt` is set in the same statement that reads it as
 *    null, so two requests arriving together settle to one payment.
 */

/** A fresh code, drawn from an alphabet nobody can misread off a phone. */
export function newInviteCode(): string {
  let out = '';
  for (let i = 0; i < INVITE_LENGTH; i++) {
    out += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  }
  return out;
}

/**
 * This player's code, made on first use.
 *
 * Every hold raised before invitations existed has none, and there is no point
 * backfilling a table for a string nobody has asked for yet. Collisions are a
 * retry: a billion codes against a few thousand players is not a design
 * problem, but "assume it cannot happen" is.
 */
export async function inviteCodeFor(playerId: string): Promise<string> {
  const found = await prisma.player.findUnique({
    where: { id: playerId }, select: { inviteCode: true },
  });
  if (found?.inviteCode) return found.inviteCode;

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newInviteCode();
    try {
      const saved = await prisma.player.update({
        where: { id: playerId }, data: { inviteCode: code }, select: { inviteCode: true },
      });
      return saved.inviteCode!;
    } catch {
      // Taken. Draw another.
    }
  }
  throw new Error('could not allocate an invite code');
}

/** Whose code this is, or null. Case- and whitespace-insensitive by design. */
export async function inviterFor(code: string): Promise<string | null> {
  const found = await prisma.player.findUnique({
    where: { inviteCode: normaliseInvite(code) }, select: { id: true },
  });
  return found?.id ?? null;
}

/**
 * Pay the inviter, if this hold has just earned it.
 *
 * Called wherever the Keep goes up. Cheap enough to call every time: it is one
 * indexed read, and it stops at the first `null` check for the overwhelming
 * majority of players, who were not invited by anybody.
 */
export async function settleInvite(tx: Tx, playerId: string): Promise<{ paid: string } | null> {
  const me = await tx.player.findUnique({
    where: { id: playerId },
    select: { invitedById: true, invitePaidAt: true, keepLevel: true },
  });
  if (!me?.invitedById || me.invitePaidAt) return null;
  if (me.keepLevel < INVITE_REWARD_KEEP_LEVEL) return null;

  /*
   * The claim and the payment in one statement each, with the claim first.
   *
   * `updateMany` with `invitePaidAt: null` in the where clause is the lock:
   * whichever request updates a row wins, the other updates none and returns
   * without paying. Doing it the other way round — pay, then mark — pays twice
   * under a burst.
   */
  const claimed = await tx.player.updateMany({
    where: { id: playerId, invitePaidAt: null },
    data: { invitePaidAt: new Date() },
  });
  if (claimed.count === 0) return null;

  await tx.player.update({
    where: { id: me.invitedById },
    data: {
      gold: { increment: BigInt(INVITE_REWARD.g) },
      iron: { increment: BigInt(INVITE_REWARD.i) },
    },
  });
  return { paid: me.invitedById };
}

/** What a newcomer arriving with a code starts with on top of the usual purse. */
export const welcomeBonus = INVITE_WELCOME;
