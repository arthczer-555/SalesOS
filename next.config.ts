import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Anciennes pages de prospection (single / mass / sequences / follow-up)
  // regroupées dans l'app /prospecting.
  async redirects() {
    return [
      { source: "/mass-prospection", destination: "/prospecting/campaigns", permanent: false },
      { source: "/sequences", destination: "/prospecting/campaigns", permanent: false },
      { source: "/followup", destination: "/prospecting/tasks", permanent: false },
    ];
  },
};

export default nextConfig;
