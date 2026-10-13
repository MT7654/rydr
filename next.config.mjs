/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep production artifacts separate from WorkBuddy's running dev servers.
  distDir: process.env.RYDR_BUILD_DIR ?? '.next',
  // All runtime state lives in local JSON under data/runtime/ behind a repository
  // interface. Nothing here assumes a durable filesystem on a hosting target.
};

export default nextConfig;
