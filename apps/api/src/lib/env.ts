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
   * With no mail provider wired up, magic links are written to the log instead
   * of sent. Allowed in development only; production refuses to start.
   */
  MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
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
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
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
