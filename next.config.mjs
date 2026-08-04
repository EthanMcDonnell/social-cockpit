/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Keep the dev server's build output away from production's.
   *
   * `next dev` and `next start` both default to `.next`, so running a dev server
   * in this directory — on ANY port — overwrites the build the live server is
   * serving from, and takes the site down. Git doesn't protect you either:
   * `.next` is gitignored, so it's one shared directory across every branch.
   *
   * Splitting on NODE_ENV makes that impossible rather than merely discouraged.
   * Next sets NODE_ENV itself per command (development for `next dev`,
   * production for `next build` / `next start`), and the npm scripts set it
   * explicitly as well, so this needs no flag and nothing to remember.
   */
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
  webpack(config, { nextRuntime }) {
    if (nextRuntime === "nodejs") {
      const existing = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
      config.externals = [...existing, "better-sqlite3"];
    }
    return config;
  },
};

export default nextConfig;
