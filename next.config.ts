import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Optimize for production
  reactStrictMode: true,

  // Enable experimental features for better performance
  experimental: {
    // Optimize package imports for faster builds
    optimizePackageImports: ['antd', '@ant-design/icons', 'maplibre-gl'],
  },

  // Include ski-resort-status data files in serverless functions
  // These CSV files contain OpenSkiMap ID mappings needed for lift/run status matching
  outputFileTracingIncludes: {
    '/api/lift-status/[id]': ['./node_modules/ski-resort-status/data/**/*'],
    '/api/lift-status/supported': ['./node_modules/ski-resort-status/data/**/*'],
  },

  // Keep ski-resort-status as external package to preserve file system structure
  serverExternalPackages: ['ski-resort-status'],

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.maptiler.com',
      },
    ],
  },

  // Headers for map tiles
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
        ],
      },
    ];
  },
};

export default nextConfig;
