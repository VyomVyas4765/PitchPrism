import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@pitchprism/contracts'],
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000'}/api/v1/:path*` }];
  },
};
export default config;
