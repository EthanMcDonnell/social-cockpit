"use client";

import { useProfile } from "@/hooks/useProfile";
import { useUserInsights } from "@/hooks/useUserInsights";
import { useMedia } from "@/hooks/useMedia";
import { usePeriod } from "@/hooks/usePeriod";
import { usePlatform } from "@/hooks/usePlatform";
import { useYoutubeChannel } from "@/hooks/useYoutubeChannel";
import { useYoutubeVideos } from "@/hooks/useYoutubeVideos";
import { extractLatestValue, calcPeriodDelta } from "@/lib/data/transforms";
import { formatCount } from "@/lib/utils/format";
import { PlatformSwitch } from "./PlatformSwitch";

const DASH = "—";

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function agoLabel(updatedAt: number | undefined): string {
  if (!updatedAt) return "SYNCING…";
  const secs = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  if (secs < 60) return `SYNCED ${secs}S AGO`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `SYNCED ${mins}M AGO`;
  return `SYNCED ${Math.round(mins / 60)}H AGO`;
}

interface ReadoutProps {
  k: string;
  code: string;
  value: string;
  detail: React.ReactNode;
  barPct: number;
  hero?: boolean;
}

function Readout({ k, code, value, detail, barPct, hero }: ReadoutProps) {
  return (
    <div className={hero ? "ro hero" : "ro"}>
      <div className="k">
        {k} <i>{code}</i>
      </div>
      <div className="v">{value}</div>
      <div className="d">{detail}</div>
      <div className="g">
        <i style={{ width: `${clampPct(barPct)}%` }} />
      </div>
    </div>
  );
}

export function Readouts() {
  const [platform] = usePlatform();

  return (
    <div className="readouts">
      <PlatformSwitch />
      {platform === "yt" ? <YoutubeReadouts /> : <InstagramReadouts />}
    </div>
  );
}

// ── Instagram ────────────────────────────────────────────────────────────────

function InstagramReadouts() {
  const [period] = usePeriod();
  const profileQuery = useProfile();
  const insightsQuery = useUserInsights(period);
  const mediaQuery = useMedia({ all: true });

  // ── Followers ──────────────────────────────────────────────────────────────
  const followers = profileQuery.data?.followers_count;
  const followerDelta = insightsQuery.data
    ? calcPeriodDelta(insightsQuery.data, "follower_count")
    : undefined;

  // ── Posts (total + published within the selected window) ─────────────────────
  const allMedia = mediaQuery.data?.data ?? [];
  const totalPosts = mediaQuery.data ? allMedia.length : undefined;
  const cutoff = Date.now() - period * 24 * 60 * 60 * 1000;
  const publishedThisPeriod = mediaQuery.data
    ? allMedia.filter((m) => new Date(m.timestamp).getTime() >= cutoff).length
    : undefined;

  // ── Reach ────────────────────────────────────────────────────────────────────
  const reach = insightsQuery.data
    ? extractLatestValue(insightsQuery.data, "reach")
    : undefined;

  // ── Avg likes / comments per post (basic media fields, not Insights —
  //    Insights is unavailable beyond reach/follower_count for this account) ──
  const postsInPeriod = mediaQuery.data
    ? allMedia.filter((m) => new Date(m.timestamp).getTime() >= cutoff)
    : undefined;
  const avgLikes =
    postsInPeriod && postsInPeriod.length > 0
      ? postsInPeriod.reduce((sum, m) => sum + (m.like_count ?? 0), 0) /
        postsInPeriod.length
      : undefined;
  const avgComments =
    postsInPeriod && postsInPeriod.length > 0
      ? postsInPeriod.reduce((sum, m) => sum + (m.comments_count ?? 0), 0) /
        postsInPeriod.length
      : undefined;

  const up = (followerDelta?.ratio ?? 0) >= 0;
  const arrow = up ? "▲" : "▼";

  return (
    <>
      <Readout
        hero
        k="Followers"
        code="R-01"
        value={followers != null ? followers.toLocaleString() : DASH}
        detail={
          followerDelta ? (
            <>
              <b className={up ? undefined : "dn"}>
                {arrow} {up ? "+" : "−"}
                {Math.abs(followerDelta.ratio * 100).toFixed(1)}%
              </b>{" "}
              · {followerDelta.delta >= 0 ? "+" : "−"}
              {Math.abs(followerDelta.delta).toLocaleString()} this period
            </>
          ) : (
            "trend unavailable"
          )
        }
        barPct={followerDelta ? Math.abs(followerDelta.ratio) * 1000 : 0}
      />

      <Readout
        k="Posts"
        code="R-02"
        value={totalPosts != null ? totalPosts.toLocaleString() : DASH}
        detail={
          publishedThisPeriod != null
            ? `${publishedThisPeriod} published this period`
            : " "
        }
        barPct={
          publishedThisPeriod != null && totalPosts
            ? (publishedThisPeriod / Math.max(totalPosts, 1)) * 100
            : 0
        }
      />

      <Readout
        k="Avg Likes"
        code="R-03"
        value={avgLikes != null ? avgLikes.toFixed(1) : DASH}
        detail={`mean per post · ${period}d`}
        barPct={avgLikes != null ? avgLikes : 0}
      />

      <Readout
        k="Avg Comments"
        code="R-04"
        value={avgComments != null ? avgComments.toFixed(1) : DASH}
        detail={`mean per post · ${period}d`}
        barPct={avgComments != null ? avgComments * 10 : 0}
      />

      <Readout
        k="Reach"
        code="R-05"
        value={reach != null ? reach.toLocaleString() : DASH}
        detail="unique accounts"
        barPct={reach != null && followers ? (reach / followers) * 100 : 0}
      />

      <div className="syncnote">
        CACHE <b>WARM · {agoLabel(profileQuery.dataUpdatedAt)}</b>
        <br />
        SOURCE <b>META GRAPH API</b>
      </div>
    </>
  );
}

// ── YouTube ──────────────────────────────────────────────────────────────────

function YoutubeReadouts() {
  const channelQuery = useYoutubeChannel();
  const videosQuery = useYoutubeVideos(30);

  const ch = channelQuery.data;
  const videos = videosQuery.data ?? [];
  const withViews = videos.filter((v) => v.viewCount > 0);

  // Averages over the recent-video sample the API key gives us.
  const avgViews = withViews.length
    ? Math.round(withViews.reduce((s, v) => s + v.viewCount, 0) / withViews.length)
    : undefined;
  const maxViews = withViews.reduce((m, v) => Math.max(m, v.viewCount), 0);

  const engRates = withViews.map((v) => (v.likeCount + v.commentCount) / v.viewCount);
  const engagement = engRates.length
    ? engRates.reduce((s, r) => s + r, 0) / engRates.length
    : undefined;

  const shorts = videos.filter((v) => v.isLikelyShort).length;
  // How far a typical recent video's reach runs past the subscriber base.
  const reachRatio = ch && avgViews ? avgViews / Math.max(ch.subscriberCount, 1) : undefined;

  return (
    <>
      <Readout
        hero
        k="Subscribers"
        code="R-01"
        value={ch ? ch.subscriberCount.toLocaleString() : DASH}
        detail="channel total"
        barPct={reachRatio != null ? reachRatio * 100 : 0}
      />

      <Readout
        k="Total Views"
        code="R-02"
        value={ch ? formatCount(ch.viewCount) : DASH}
        detail={avgViews != null ? `avg ${formatCount(avgViews)} / video` : "lifetime"}
        barPct={maxViews > 0 && avgViews ? (avgViews / maxViews) * 100 : 0}
      />

      <Readout
        k="Engagement"
        code="R-03"
        value={engagement != null ? `${(engagement * 100).toFixed(1)}%` : DASH}
        detail={
          withViews.length
            ? `likes+comments / views · last ${withViews.length}`
            : "no recent videos"
        }
        barPct={engagement != null ? engagement * 100 * 10 : 0}
      />

      <Readout
        k="Videos"
        code="R-04"
        value={ch ? ch.videoCount.toLocaleString() : DASH}
        detail={videos.length ? `${shorts} shorts · last ${videos.length}` : "uploads"}
        barPct={videos.length ? (shorts / videos.length) * 100 : 0}
      />

      <div className="syncnote">
        CACHE <b>WARM · {agoLabel(channelQuery.dataUpdatedAt)}</b>
        <br />
        SOURCE <b>YOUTUBE DATA API v3</b>
      </div>
    </>
  );
}
