import { formatCount, formatPercent } from "@/lib/utils/format";
import type { PostTableRow } from "@/lib/data/transforms";

export type MetricKey =
  | "engagementRate"
  | "likes"
  | "comments"
  | "shares"
  | "saves"
  | "reach"
  | "views";

export interface MetricDef {
  key: MetricKey;
  /** Full label, e.g. for selectors */
  label: string;
  /** Compact column label */
  short: string;
  /** Monochrome unicode glyph */
  glyph: string;
  format: (v: number) => string;
}

export const METRICS: MetricDef[] = [
  { key: "engagementRate", label: "Engagement", short: "Eng", glyph: "◎", format: (v) => formatPercent(v) },
  { key: "likes", label: "Likes", short: "Likes", glyph: "♥", format: formatCount },
  { key: "comments", label: "Comments", short: "Comments", glyph: "✎", format: formatCount },
  { key: "shares", label: "Shares", short: "Shares", glyph: "↗", format: formatCount },
  { key: "saves", label: "Saves", short: "Saves", glyph: "⚐", format: formatCount },
  { key: "reach", label: "Reach", short: "Reach", glyph: "◇", format: formatCount },
  { key: "views", label: "Views", short: "Views", glyph: "▷", format: formatCount },
];

export const METRIC_MAP: Record<MetricKey, MetricDef> = Object.fromEntries(
  METRICS.map((m) => [m.key, m])
) as Record<MetricKey, MetricDef>;

export function metricValue(row: PostTableRow, key: MetricKey): number {
  return row[key];
}

export const MEDIA_TYPE_LABEL: Record<string, string> = {
  IMAGE: "Photo",
  VIDEO: "Video",
  CAROUSEL_ALBUM: "Carousel",
  REEL: "Reel",
};
