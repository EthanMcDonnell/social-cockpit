import type { Platform } from "@/hooks/usePlatform";

interface PlatformGlyphProps {
  platform: Platform;
  size?: number;
  /** Tint the glyph with the platform's brand hue (else inherits currentColor). */
  brand?: boolean;
  className?: string;
}

const BRAND: Record<Platform, string> = {
  ig: "#e04a8c",
  yt: "#ff3d31",
};

/**
 * Small inline brand mark for a platform. Inlined (not an asset file) so it
 * needs no network fetch and inherits the cockpit's currentColor when brand is
 * off. The one spot of non-amber color in the dashboard.
 */
export function PlatformGlyph({ platform, size = 13, brand = true, className }: PlatformGlyphProps) {
  const color = brand ? BRAND[platform] : "currentColor";

  if (platform === "yt") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
        <rect x="1.5" y="5" width="21" height="14" rx="4.4" fill={color} />
        <path d="M10 8.6 L16 12 L10 15.4 Z" fill="var(--char)" />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke={color} strokeWidth="1.9" />
      <circle cx="12" cy="12" r="4.4" fill="none" stroke={color} strokeWidth="1.9" />
      <circle cx="17.4" cy="6.6" r="1.35" fill={color} />
    </svg>
  );
}
