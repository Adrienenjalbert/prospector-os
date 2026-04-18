import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next 16 Cache Components (PPR + `use cache`) is opt-in. We intentionally
  // don't enable it globally because every dashboard page is tenant-scoped
  // and dynamic — enabling cacheComponents at the config level would require
  // auditing every page for cache directives first. Phase 8+ follow-up.
};

export default nextConfig;
