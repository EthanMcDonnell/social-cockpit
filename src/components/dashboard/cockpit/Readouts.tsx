"use client";

import { useProfile } from "@/hooks/useProfile";
import { useUserInsights } from "@/hooks/useUserInsights";
import { useMedia } from "@/hooks/useMedia";
import { usePeriod } from "@/hooks/usePeriod";
import { extractLatestValue, calcPeriodDelta } from "@/lib/data/transforms";

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

  // ── Engagement (mirror of StatCardGrid derivation) ───────────────────────────
  const avgEngagement = insightsQuery.data
    ? (() => {
        const metric = insightsQuery.data.data.find((m) => m.name === "engagement_rate");
        if (metric?.values?.length) {
          const vals = metric.values.map((v) => v.value);
          return vals.reduce((s, v) => s + v, 0) / vals.length;
        }
        const interactions = extractLatestValue(insightsQuery.data, "total_interactions");
        const reachVal = extractLatestValue(insightsQuery.data, "reach");
        if (interactions && reachVal && reachVal > 0) return interactions / reachVal;
        return undefined;
      })()
    : undefined;

  const up = (followerDelta?.ratio ?? 0) >= 0;
  const arrow = up ? "▲" : "▼";

  return (
    <div className="readouts">
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
            : " "
        }
        barPct={
          publishedThisPeriod != null && totalPosts
            ? (publishedThisPeriod / Math.max(totalPosts, 1)) * 100
            : 0
        }
      />

      <Readout
        k="Engagement"
        code="R-03"
        value={avgEngagement != null ? `${(avgEngagement * 100).toFixed(1)}%` : DASH}
        detail={`mean per post · ${period}d`}
        barPct={avgEngagement != null ? avgEngagement * 100 * 10 : 0}
      />

      <Readout
        k="Reach"
        code="R-04"
        value={reach != null ? reach.toLocaleString() : DASH}
        detail="unique accounts"
        barPct={reach != null && followers ? (reach / followers) * 100 : 0}
      />

      <div className="syncnote">
        CACHE <b>WARM · {agoLabel(profileQuery.dataUpdatedAt)}</b>
        <br />
        SOURCE <b>META GRAPH API</b>
      </div>
    </div>
  );
}
