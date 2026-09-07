import type { Cost } from './buildings.js';

/**
 * Invitations.
 *
 * ALFA is launching by handing out an access code in replies on X, one person
 * at a time. That is already a referral programme — it is just one nobody is
 * writing down. Giving every player a code of their own turns the door the
 * game already has into the only growth loop it needs: the code opens it, and
 * the person whose code it was gets paid for it.
 *
 * All numbers here are TUNABLE.
 */

/**
 * How long a code is, and what it is made of.
 *
 * Six characters from an alphabet with no O/0, I/1 or S/5 in it, because these
 * get read off a phone screen and typed into another one. Thirty to the
 * sixth is seven hundred million codes, so a collision is a retry and not a
 * design problem.
 */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
export const INVITE_LENGTH = 6;

/**
 * What the inviter is paid, and when.
 *
 * Not at sign-up. A code that pays on a fresh account pays for scripts, and a
 * launch that gets farmed on day one is worse than a launch nobody joins. It
 * pays when the invited hold reaches the Keep level below — far enough in that
 * somebody had to actually play, close enough that a real player reaches it on
 * their first evening.
 */
export const INVITE_REWARD_KEEP_LEVEL = 3;
export const INVITE_REWARD: Cost = { g: 3000, i: 1200 };

/**
 * And what the newcomer gets for arriving with a code rather than at random.
 *
 * Smaller than the inviter's share on purpose: the point is to make the code
 * worth handing out, not to make it worth farming from the other end.
 */
export const INVITE_WELCOME: Cost = { g: 1200, i: 400 };

/** Codes are stored and compared upper-case; players will type them either way. */
export function normaliseInvite(code: string): string {
  return code.trim().toUpperCase();
}

export function looksLikeInvite(code: string): boolean {
  const c = normaliseInvite(code);
  if (c.length !== INVITE_LENGTH) return false;
  for (const ch of c) if (!INVITE_ALPHABET.includes(ch)) return false;
  return true;
}
