import { DAY, asWorld, type World } from '@ironvow/config';
import type { FastifyRequest } from 'fastify';

/**
 * Which base a request is acting in.
 *
 * Sent with every command rather than remembered on the session, and that is
 * deliberate. A "current world" held server-side is a piece of state two tabs
 * disagree about: switch to the night base on a phone, tap COLLECT on a laptop
 * still showing the day base, and the gold lands in the wrong world with
 * nothing anywhere to say why. Saying which world each command means costs one
 * query parameter and removes the question entirely.
 *
 * Absent or unrecognised is the day world, never an error: every client that
 * existed before the night world did sends nothing, and every one of them means
 * the day base.
 */
export function worldOf(request: FastifyRequest): World {
  const query = (request.query as { world?: unknown } | undefined)?.world;
  if (query !== undefined) return asWorld(query);
  const body = (request.body as { world?: unknown } | undefined)?.world;
  if (body !== undefined) return asWorld(body);
  return DAY;
}
