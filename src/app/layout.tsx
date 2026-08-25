import type { Metadata, Viewport } from "next";
import { DM_Mono, Barlow, Barlow_Semi_Condensed } from "next/font/google";
import { QueryProvider } from "@/providers/QueryProvider";
import { ThemeProvider } from "@/providers/ThemeProvider";
import "./globals.css";

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

/* Two families, three jobs: Barlow reads body copy, its semi-condensed sibling
   carries every uppercase label/heading/readout in the cockpit, DM Mono holds
   the numeric columns. Same superfamily, so labels and prose share skeletons. */
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const barlowCondensed = Barlow_Semi_Condensed({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cond",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Social Cockpit",
    template: "%s | Social Cockpit",
  },
  description: "Instagram analytics dashboard",
};

export const viewport: Viewport = {
  themeColor: "#121110",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${dmMono.variable} ${barlow.variable} ${barlowCondensed.variable}`}
    >
      <body>
        <ThemeProvider>
          <QueryProvider>{children}</QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
