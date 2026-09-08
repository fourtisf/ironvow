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
let keys: { publicKey: string; privateKey: string } | null = null;

/**
 * Keys come from the environment when given, and otherwise are generated once
 * and kept in the database: a fresh deployment gets working push without
 * anyone running a key generator and pasting the output into a file, which is
 * the step that was skipped on the first server and left notifications dead.
 */
async function ready(): Promise<boolean> {
  if (configured !== null) return configured;
  const config = env();
  let pub = config.VAPID_PUBLIC_KEY;
  let priv = config.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    try {
      const row = await prisma.serverSetting.findUnique({ where: { key: 'vapid' } });
      const stored = row?.value as { publicKey?: string; privateKey?: string } | null;
      if (stored?.publicKey && stored?.privateKey) {
        pub = stored.publicKey;
        priv = stored.privateKey;
      } else {
        const made = webpush.generateVAPIDKeys();
        // Two instances starting together both get here; the unique key lets
        // exactly one row land, and the other reads back whichever it was.
        await prisma.$executeRaw`INSERT INTO "ServerSetting" ("key", "value", "updatedAt")
          VALUES ('vapid', ${JSON.stringify({ publicKey: made.publicKey, privateKey: made.privateKey })}::jsonb, now())
          ON CONFLICT ("key") DO NOTHING`;
        const again = await prisma.serverSetting.findUnique({ where: { key: 'vapid' } });
        const v = again?.value as { publicKey?: string; privateKey?: string } | null;
        if (!v?.publicKey || !v.privateKey) return false;
        pub = v.publicKey;
        priv = v.privateKey;
      }
    } catch {
      // The database was not there to ask. Not cached: it is asked again next time.
      return false;
    }
  }
  webpush.setVapidDetails(config.VAPID_SUBJECT, pub, priv);
  keys = { publicKey: pub, privateKey: priv };
  configured = true;
  return true;
}

export async function pushAvailable(): Promise<boolean> {
  return ready();
}

export async function publicKey(): Promise<string | null> {
  return (await ready()) ? keys!.publicKey : null;
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
  if (!(await ready())) return 0;

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
    title: `${attackerName} attacked your base`,
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
