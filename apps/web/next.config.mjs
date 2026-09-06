/*
 * When this build was made.
 *
 * Stamped on the first screen. Twice now a deploy has landed and looked
 * exactly like one that had not, and the only way to tell was to read the
 * markup: a date under the card answers it in a glance. Computed here rather
 * than passed in, so nobody has to remember a build argument. (Turbo caches
 * builds, so a local rebuild with no source change keeps the old stamp; a
 * Docker image build always starts fresh, which is the case that matters.)
 */
const builtAt = new Date().toISOString();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILT_AT: builtAt },
  // The client bundles the very same build of @ironvow/sim that the API
  // imports. That is not a convenience — it is what makes the server's replay
  // of a battle trustworthy enough to overrule the client silently.
  transpilePackages: ['@ironvow/config', '@ironvow/sim', '@ironvow/types'],
  /*
   * Where /api goes.
   *
   * Baked into the routes manifest at build time, not read at boot — so this
   * has to be right when `next build` runs, and setting it later does nothing.
   *
   * API_PROXY_URL is separate from NEXT_PUBLIC_API_URL on purpose. The public
   * one is inlined into the browser bundle and has to be reachable from a
   * phone; this one is used by the Next server and has to be reachable from
   * inside the network the server is on. Under docker compose those are
   * genuinely different strings — `/api` and `http://api:4000` — and sharing
   * one variable meant one of the two was always wrong.
   */
  async rewrites() {
    const target = process.env.API_PROXY_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    // A relative target means the rewrite points at this same server: /api/me
    // becomes /api/me, Next answers 404, and every player sees "the server
    // answered 404" over an empty field. That is exactly what shipped once,
    // because Turbo's strict env mode dropped API_PROXY_URL on the way to this
    // file (it has to be declared in turbo.json to survive). A build that
    // cannot reach its API must not succeed quietly.
    if (!/^https?:\/\//.test(target)) {
      throw new Error(
        `API rewrite target is "${target}", which is not an absolute URL. ` +
        'Set API_PROXY_URL (the address the Next server can reach the API on), ' +
        'and make sure turbo.json lists it under build.env.',
      );
    }
    return [
      { source: '/api/:path*', destination: `${target}/:path*` },
    ];
  },
};

export default nextConfig;
