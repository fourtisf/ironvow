/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The client bundles the very same build of @ironvow/sim that the API
  // imports. That is not a convenience — it is what makes the server's replay
  // of a battle trustworthy enough to overrule the client silently.
  transpilePackages: ['@ironvow/config', '@ironvow/sim', '@ironvow/types'],
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/:path*` },
    ];
  },
};

export default nextConfig;
