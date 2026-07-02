import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium"],
  outputFileTracingIncludes: {
    "/api/ingest-url": ["./node_modules/@sparticuz/chromium/bin/**/*"]
  }
};

export default nextConfig;
