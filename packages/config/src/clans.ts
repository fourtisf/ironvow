/**
 * Clans.
 *
 * Not in the build document. Added because everything else in IRONVOW is
 * something a player does alone: you raid a frozen snapshot of somebody who is
 * not there, and the only trace another human leaves is a line in your attack
 * log. A clan is the only place two players are in the same room.
 *
 * What is here: membership, roles, applications, a member list, chat, and a
 * clan ladder. What is deliberately not here: clan wars. A war is a second
 * game mode — its own matchmaking, its own clock, its own attack allocation,
 * its own rewards — and every one of those is a design decision nobody has
 * made. Half a war would be worse than none.
 *
 * All numbers TUNABLE.
 */

export const CLAN_ROLES = ['leader', 'elder', 'member'] as const;
export type ClanRole = (typeof CLAN_ROLES)[number];

/** Higher outranks lower. The only thing that decides who may do what. */
export const ROLE_RANK: Record<ClanRole, number> = { leader: 3, elder: 2, member: 1 };

export function outranks(a: ClanRole, b: ClanRole): boolean {
  return ROLE_RANK[a] > ROLE_RANK[b];
}

export function isClanRole(v: string): v is ClanRole {
  return (CLAN_ROLES as readonly string[]).includes(v);
}

export const JOIN_POLICIES = ['open', 'request', 'closed'] as const;
export type JoinPolicy = (typeof JOIN_POLICIES)[number];

export function isJoinPolicy(v: string): v is JoinPolicy {
  return (JOIN_POLICIES as readonly string[]).includes(v);
}

/**
 * Founding a clan costs gold.
 *
 * Two reasons, and only one of them is the sink. The other is that a free
 * create button produces a server full of one-member clans called "test", and
 * then the find-a-clan list is useless to the players it exists for.
 */
export const CLAN_CREATE_COST = { g: 20_000, i: 0 };

/** A Keep below this cannot found one — but can join one from the first minute. */
export const CLAN_CREATE_KEEP_LEVEL = 3;

export const CLAN_MAX_MEMBERS = 40;

export const CLAN_NAME_MIN = 3;
export const CLAN_NAME_MAX = 24;
export const CLAN_TAG_MIN = 2;
export const CLAN_TAG_MAX = 5;
export const CLAN_DESC_MAX = 180;
export const CLAN_BADGES = 8;

/* --- chat -------------------------------------------------------------- */

export const CHAT_MAX_LENGTH = 220;
/** How many lines a client is handed, and how many are kept per clan. */
export const CHAT_HISTORY = 100;
/** Messages one player may post inside CHAT_RATE_WINDOW_MS. */
export const CHAT_RATE_LIMIT = 5;
export const CHAT_RATE_WINDOW_MS = 15_000;

/**
 * What a message is allowed to contain.
 *
 * Control characters are stripped, runs of whitespace collapsed, and the
 * result trimmed. There is no word filter: a list of banned words is a
 * moderation policy, it is culture-specific, it is trivially evaded, and it
 * would be me deciding on ALFA's behalf what their players may say. Elders can
 * delete and leaders can kick, which is moderation by people who know the
 * room.
 */
export function cleanMessage(raw: string): string {
  // Control characters out first, then runs of whitespace collapsed: a message
  // of four hundred newlines must not be able to push the rest of the room off
  // the screen.
  const stripped = raw.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return stripped.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
}

/** Names are shown to strangers, so they get the same treatment. */
export function cleanClanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, CLAN_NAME_MAX);
}

export function cleanTag(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, CLAN_TAG_MAX);
}

export function validClanName(name: string): boolean {
  return name.length >= CLAN_NAME_MIN && name.length <= CLAN_NAME_MAX;
}

export function validTag(tag: string): boolean {
  return tag.length >= CLAN_TAG_MIN && tag.length <= CLAN_TAG_MAX;
}

/**
 * A clan's standing on the ladder.
 *
 * The sum of its members' trophies, not an average: a clan of forty is meant
 * to outrank a clan of four, because recruiting forty people is the thing the
 * ladder is measuring.
 */
export function clanTrophies(members: readonly { trophies: number }[]): number {
  let n = 0;
  for (const m of members) n += m.trophies;
  return n;
}
