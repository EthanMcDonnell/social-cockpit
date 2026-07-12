"use client";

import { useYoutubeChannel } from "@/hooks/useYoutubeChannel";
import { useYoutubeVideos } from "@/hooks/useYoutubeVideos";
import type { YoutubeVideo } from "@/lib/youtube/types";

// Standalone test surface for the YouTube Data API v3 metrics MVP. Deliberately
// self-contained (inline styles, not wired into the cockpit shell) so it can be
// validated without touching the live Instagram dashboard.

const num = (n: number) => n.toLocaleString();

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid #333",
        borderRadius: 8,
        padding: "16px 20px",
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.6, textTransform: "uppercase", letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function YoutubePage() {
  const channel = useYoutubeChannel();
  const videos = useYoutubeVideos(25);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>YouTube metrics (test)</h1>
      <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 20 }}>
        Public stats via YouTube Data API v3. &ldquo;Short?&rdquo; is a duration heuristic (&le;3&nbsp;min), not authoritative.
      </p>

      {/* ── Channel ── */}
      {channel.isLoading && <p>Loading channel&hellip;</p>}
      {channel.isError && (
        <p style={{ color: "#e5484d" }}>Channel error: {(channel.error as Error).message}</p>
      )}
      {channel.data && (
        <>
          <h2 style={{ fontSize: 16, margin: "8px 0 12px" }}>{channel.data.title}</h2>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 28 }}>
            <Tile label="Subscribers" value={num(channel.data.subscriberCount)} />
            <Tile label="Total views" value={num(channel.data.viewCount)} />
            <Tile label="Videos" value={num(channel.data.videoCount)} />
          </div>
        </>
      )}

      {/* ── Recent videos ── */}
      <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>Recent videos</h2>
      {videos.isLoading && <p>Loading videos&hellip;</p>}
      {videos.isError && (
        <p style={{ color: "#e5484d" }}>Videos error: {(videos.error as Error).message}</p>
      )}
      {videos.data && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #333" }}>
                <th style={{ padding: "8px 10px" }}>Title</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Views</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Likes</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Comments</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Length</th>
                <th style={{ padding: "8px 10px" }}>Short?</th>
              </tr>
            </thead>
            <tbody>
              {videos.data.map((v: YoutubeVideo) => (
                <tr key={v.id} style={{ borderBottom: "1px solid #222" }}>
                  <td style={{ padding: "8px 10px", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {v.title}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{num(v.viewCount)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{num(v.likeCount)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{num(v.commentCount)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtDuration(v.durationSeconds)}</td>
                  <td style={{ padding: "8px 10px" }}>{v.isLikelyShort ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
