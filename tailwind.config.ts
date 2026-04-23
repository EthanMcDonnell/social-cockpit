import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/providers/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-outfit)", "system-ui", "sans-serif"],
        heading: ["var(--font-syne)", "system-ui", "sans-serif"],
        mono: ["var(--font-dm-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        bg: {
          base: "var(--bg-base)",
          card: "var(--bg-card)",
          sidebar: "var(--bg-sidebar)",
        },
        text: {
          primary: "var(--text-primary)",
          muted: "var(--text-muted)",
        },
        border: "var(--border)",
        accent: {
          cyan: "var(--accent-cyan)",
          amber: "var(--accent-amber)",
          green: "var(--accent-green)",
          red: "var(--accent-red)",
        },
      },
    },
  },
  plugins: [],
};
export default config;
