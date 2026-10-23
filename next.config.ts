import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/machines/install": [
      "./scripts/install-machine.sh",
      "./scripts/setup-machine.mjs",
      "./scripts/orca-*.mjs",
    ],
  },
};

export default nextConfig;
