/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@fitcrew/ui', '@fitcrew/application', '@fitcrew/domain', '@fitcrew/db'],
};

export default nextConfig;
