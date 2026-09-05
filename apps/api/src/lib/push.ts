import webpush from 'web-push';
import { env } from './env.js';
import { prisma } from './prisma.js';

/**
 * Browser push (spec S8.4).
 *
 * Two things are worth waking a player for: a builder finished, and somebody
 * raided them. Anything beyond that is the game asking for attention it has not
 * earned, which is how notifications get switched off for good.
 *
 * Nothing here is required. With no VAPID keys configured the whole feature is
 * off and every call is a no-op, so the game runs identically without it.
 */

let configured: boolean | null = null;

function ready(): boolean {
  if (configured !== null) return configured;
  const config = env();
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(
    config.VAPID_SUBJECT,
    config.VAPID_PUBLIC_KEY,
    config.VAPID_PRIVATE_KEY,
  );
  configured = true;
  return true;
}

export function pushAvailable(): boolean {
  return ready();
}

export function publicKey(): string | null {
  return ready() ? env().VAPID_PUBLIC_KEY! : null;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Collapses older notifications of the same kind rather than stacking them. */
  tag: string;
  url?: string;
}

/**
 * Send to every device a player has registered.
 *
 * Failures are swallowed on purpose: a push that does not arrive must never
 * fail the request that triggered it. A 404 or 410 means the browser dropped
 * the subscription, and the row is removed rather than retried forever.
 */
export async function pushTo(playerId: string, message: PushMessage): Promise<number> {
  if (!ready()) return 0;

  const subs = await prisma.pushSubscription.findMany({ where: { playerId } });
  if (subs.length === 0) return 0;

  const payload = JSON.stringify(message);
  let delivered = 0;

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 3600, urgency: 'normal' },
      );
      delivered++;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
      }
      // Anything else is transient. Losing one notification is not worth
      // failing the raid that produced it.
    }
  }));

  if (delivered > 0) {
    await prisma.pushSubscription
      .updateMany({ where: { playerId }, data: { lastSentAt: new Date() } })
      .catch(() => undefined);
  }
  return delivered;
}

/** Somebody raided you while you were away. */
export async function pushRaided(
  defenderId: string,
  attackerName: string,
  stars: number,
  loot: { g: number; i: number },
): Promise<void> {
  await pushTo(defenderId, {
    title: `${attackerName} raided your hold`,
    body: stars === 0
      ? 'They were driven off empty-handed.'
      : `${stars}★ — they took ${loot.g} gold and ${loot.i} iron.`,
    tag: 'raided',
    url: '/',
  });
}

/** A builder is free again. */
export async function pushBuildFinished(playerId: string, what: string): Promise<void> {
  await pushTo(playerId, {
    title: 'A builder is free',
    body: `Your ${what} is finished.`,
    tag: 'builder',
    url: '/',
  });
}
