import type { MetadataRoute } from "next";

/**
 * Web-app manifest. Installing the site to the macOS Dock / iOS home screen
 * without this makes Safari render a translucent title bar that paints the
 * document <title> over the page content. Declaring `display: "standalone"`
 * plus a solid theme color gives the installed app a proper, non-overlapping
 * title bar tinted to match the cockpit background.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Social Cockpit",
    short_name: "Cockpit",
    description: "Instagram analytics cockpit",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#121110",
    theme_color: "#121110",
  };
}
