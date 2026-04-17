import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "heygen.com",
      },
      {
        protocol: "https",
        hostname: "**.heygen.com",
      },
      {
        protocol: "https",
        hostname: "heygen.ai",
      },
      {
        protocol: "https",
        hostname: "**.heygen.ai",
      },
    ],
  },
};

export default nextConfig;
