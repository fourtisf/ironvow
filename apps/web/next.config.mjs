/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
    return [
      { source: '/api/:path*', destination: `${target}/:path*` },
    ];
  },
};

export default nextConfig;
