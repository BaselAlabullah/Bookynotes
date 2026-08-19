import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fail the production build on type errors instead of shipping them. This is
  // already Next's default; stating it stops anyone from "fixing" a red build
  // by flipping it to true.
  typescript: { ignoreBuildErrors: false },

  // There is deliberately no `eslint` key here. Next 16 removed the built-in
  // lint-during-build step, so linting is its own command (`npm run lint`) and
  // belongs in CI, not in the bundler.
};

export default nextConfig;
