/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@fitcrew/ui', '@fitcrew/application', '@fitcrew/domain'],
  experimental: {
    serverComponentsExternalPackages: ['@node-rs/argon2'],
  },
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
