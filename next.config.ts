import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Imagen de Docker (infra/Dockerfile) consume .next/standalone
  output: 'standalone',
};

export default nextConfig;
