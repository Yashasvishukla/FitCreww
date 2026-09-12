import { PrismaPlugin } from '@prisma/nextjs-monorepo-workaround-plugin';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@fitcrew/ui', '@fitcrew/application', '@fitcrew/domain'],
  experimental: {
    // Next 14 keeps tracing configuration under `experimental`. Trace from the
    // workspace root so Vercel functions can include pnpm virtual-store assets.
    outputFileTracingRoot: join(projectDirectory, '../..'),
    outputFileTracingIncludes: {
      // Prisma resolves this native engine dynamically, so static tracing alone
      // cannot see it. Include generated client assets for every server route.
      '/*': ['../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/**/*'],
    },
    serverComponentsExternalPackages: ['@node-rs/argon2', '@prisma/client', 'prisma', 'sharp', '@azure/storage-blob'],
  },
  webpack(config, { isServer }) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    if (isServer) {
      config.plugins.push(new PrismaPlugin());
      // Sharp loads one platform-specific native package at runtime. Keeping it
      // external prevents Webpack from resolving optional packages for every
      // supported platform while bundling API routes.
      config.externals.push({ sharp: 'commonjs sharp' });
    }
    return config;
  },
};

export default nextConfig;
