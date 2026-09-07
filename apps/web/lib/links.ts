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

/**
 * When the running build was made, stamped by `next.config.mjs`.
 *
 * "16 Sep 23:40" in the viewer's own time zone. Its whole job is to answer
 * "did my deploy land?" without reading markup.
 *
 * Which is also why it must not be rendered on the server: `toLocaleString`
 * gives a different answer in the container, which runs in UTC, than in the
 * player's browser, and a server-rendered string the client disagrees with is
 * a hydration mismatch. React does not merely warn about that — it throws the
 * tree away and rebuilds it, which is what the three console errors on the
 * first screen were. Call it after mount only.
 */
export function builtAtLabel(): string {
  const raw = trim(process.env.NEXT_PUBLIC_BUILT_AT);
  if (raw === '') return '';
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/** A long address, shortened the way every explorer shortens one. */
export function shortAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
