import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';
import { env } from './env.js';

/**
 * Email magic-link auth, session in an httpOnly cookie.
 *
 * Only hashes are stored. A leaked database gives an attacker no usable
 * session token and no usable login link.
 */

export const SESSION_COOKIE = 'ironvow_session';
const SESSION_DAYS = 30;
const LINK_MINUTES = 15;

function hash(token: string): string {
  return createHash('sha256').update(token).update(env().SESSION_SECRET).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Issue a login link. Returns the raw token, which is emailed and never stored. */
export async function createLoginLink(email: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + LINK_MINUTES * 60_000);
  const player = await prisma.player.findUnique({ where: { email }, select: { id: true } });
  await prisma.loginLink.create({
    data: { tokenHash: hash(token), email, playerId: player?.id ?? null, expiresAt },
  });
  return { token, expiresAt };
}

export interface ConsumedLink {
  email: string;
  playerId: string | null;
}

/** Redeem a login link exactly once. Returns null for expired, used or unknown tokens. */
export async function consumeLoginLink(token: string): Promise<ConsumedLink | null> {
  const tokenHash = hash(token);
  // The updateMany guard makes redemption atomic: two concurrent clicks on the
  // same link cannot both come back with a session.
  const claimed = await prisma.loginLink.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  const link = await prisma.loginLink.findUnique({ where: { tokenHash } });
  return link ? { email: link.email, playerId: link.playerId } : null;
}

export async function issueSession(reply: FastifyReply, playerId: string): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({ data: { tokenHash: hash(token), playerId, expiresAt } });

  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().NODE_ENV === 'production',
    path: '/',
    domain: env().COOKIE_DOMAIN,
    expires: expiresAt,
  });
}

export async function revokeSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hash(token) } });
  reply.clearCookie(SESSION_COOKIE, { path: '/', domain: env().COOKIE_DOMAIN });
}

export async function playerIdFromRequest(request: FastifyRequest): Promise<string | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hash(token) },
    select: { playerId: true, expiresAt: true },
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  return session.playerId;
}

declare module 'fastify' {
  interface FastifyRequest {
    playerId?: string;
  }
}

/** Route guard. Attaches `request.playerId` or answers 401. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const playerId = await playerIdFromRequest(request);
  if (!playerId) {
    await reply.code(401).send({ error: 'notAuthenticated' });
    return;
  }
  request.playerId = playerId;
}

/** Housekeeping, run by the worker. */
export async function purgeExpired(): Promise<{ sessions: number; links: number }> {
  const now = new Date();
  const sessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const links = await prisma.loginLink.deleteMany({ where: { expiresAt: { lt: now } } });
  return { sessions: sessions.count, links: links.count };
}
