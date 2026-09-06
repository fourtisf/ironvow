/**
 * Where the game points outside itself.
 *
 * Read from the environment rather than written in, because the accounts are
 * the operator's and not the code's. Next bakes NEXT_PUBLIC_* at build time,
 * so each one is declared in `turbo.json` and passed as a build argument in
 * `docker-compose.yml` — the same three places `NEXT_PUBLIC_API_URL` lives,
 * and the ones a missing variable is silently dropped by otherwise.
 */

const trim = (v: string | undefined): string => (v ?? '').trim();

export const X_URL = trim(process.env.NEXT_PUBLIC_X_URL);
export const TELEGRAM_URL = trim(process.env.NEXT_PUBLIC_TG_URL);

/**
 * The contract address, once there is one.
 *
 * Empty means "coming soon", which is what the chip says. Nothing about the
 * game depends on this; it is a line for the people who ask before they play.
 */
export const CONTRACT = trim(process.env.NEXT_PUBLIC_CONTRACT);

/** A long address, shortened the way every explorer shortens one. */
export function shortAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
