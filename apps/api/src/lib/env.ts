import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  /** Where the client is served from, for the cookie and CORS. */
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  /** Signs nothing on its own; used to derive the session token hash pepper. */
  SESSION_SECRET: z.string().min(16).default('dev-only-session-secret-change-me'),
  COOKIE_DOMAIN: z.string().optional(),
  /**
   * How login links leave the server.
   *
   * `console` writes them to the log — development only; production refuses
   * to start with it. `smtp` sends them. `off` sends nothing and tells the
   * player so: guest play needs no email at all, and a server with no mail
   * provider yet should still be able to run the game. It was refusing to,
   * and the first deployment of IRONVOW spent its first hour crash-looping
   * on that rule while the field rendered behind a client that could not
   * reach it.
   */
  MAIL_TRANSPORT: z.enum(['console', 'smtp', 'off']).default('console'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('IRONVOW <no-reply@ironvow.example.com>'),

  /**
   * Guards the operations endpoints. Unset means they are refused outright,
   * which is the right default: an unauthenticated divergence feed tells an
   * attacker exactly how close their forged client is to matching.
   */
  OPS_TOKEN: z.string().min(16).optional(),

  /**
   * Web Push keys. Generate with `npx web-push generate-vapid-keys`.
   *
   * Entirely optional: without them push is off and every send is a no-op, so
   * the game runs identically. That is deliberate — notifications should never
   * be load-bearing.
   */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:ops@ironvow.example.com'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * Empty means unset.
 *
 * A `.env` file and docker compose both hand an unset variable over as "",
 * not as absent — `OPS_TOKEN: ${OPS_TOKEN:-}` is the empty string — and zod's
 * `.optional()` only accepts absence. So an optional-but-validated field like
 * OPS_TOKEN failed with "must contain at least 16 characters" on a server
 * where nobody had set it, and the API refused to start. Dropping empty
 * strings before parsing makes "" and unset the same thing, which is what
 * every operator already assumes they are.
 */
function withoutEmpty(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(withoutEmpty(process.env));
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment:\n  ${detail}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.MAIL_TRANSPORT === 'console') {
      throw new Error('MAIL_TRANSPORT=console logs login links in plain text and must not run in production.');
    }
    if (parsed.data.SESSION_SECRET.startsWith('dev-only')) {
      throw new Error('SESSION_SECRET is still the development default.');
    }
    if (parsed.data.MAIL_TRANSPORT === 'smtp' && !parsed.data.SMTP_HOST) {
      throw new Error('MAIL_TRANSPORT=smtp needs SMTP_HOST, or no login link will ever arrive.');
    }
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached environment after mutating process.env. */
export function resetEnv(): void {
  cached = null;
}
