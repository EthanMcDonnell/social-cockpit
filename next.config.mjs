/** @type {import('next').NextConfig} */
const nextConfig = {
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
