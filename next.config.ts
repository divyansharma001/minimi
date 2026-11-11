import type { NextConfig } from "next";

const config: NextConfig = {
  // Next.js writes an AGENTS.md file when it detects an AI coding tool.
  // It is not part of this project, so keep the repo free of it.
  agentRules: false,
};

export default config;
