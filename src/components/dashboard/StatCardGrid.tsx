"use client";

import { StatCard } from "./StatCard";
import { useProfile } from "@/hooks/useProfile";
import { useUserInsights } from "@/hooks/useUserInsights";
import { usePeriod } from "@/hooks/usePeriod";
import { useMedia } from "@/hooks/useMedia";
import {
  extractLatestValue,
  calcPeriodDelta,
} from "@/lib/data/transforms";

export function StatCardGrid() {
  const [period] = usePeriod();
  const profileQuery = useProfile();
  const insightsQuery = useUserInsights(period);
  const mediaQuery = useMedia({ limit: 50 });

  const isLoading =
    profileQuery.isLoading ||
    insightsQuery.isLoading ||
    mediaQuery.isLoading;

  // Followers
  const followers = profileQuery.data?.followers_count;
  const followerDelta = insightsQuery.data
    ? calcPeriodDelta(insightsQuery.data, "follower_count")
    : undefined;

  // Total posts
  const totalPosts = mediaQuery.data?.data.length;

  // Period reach (sum from insights)
  const reach = insightsQuery.data
    ? extractLatestValue(insightsQuery.data, "reach")
    : undefined;

  // Avg engagement rate across media insights
  // We derive this from total_interactions / reach from user insights
  const avgEngagement = insightsQuery.data
    ? (() => {
        const metric = insightsQuery.data.data.find(
          (m) => m.name === "engagement_rate"
        );
        if (metric?.values?.length) {
          const vals = metric.values.map((v) => v.value);
          return vals.reduce((s, v) => s + v, 0) / vals.length;
        }
        // Fallback: total_interactions / reach
        const interactions = extractLatestValue(
          insightsQuery.data,
          "total_interactions"
        );
        const reachVal = extractLatestValue(insightsQuery.data, "reach");
        if (interactions && reachVal && reachVal > 0)
          return interactions / reachVal;
        return undefined;
      })()
    : undefined;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard
        label="Total Followers"
        value={followers}
        delta={followerDelta?.delta}
        deltaRatio={followerDelta?.ratio}
        isLoading={isLoading}
      />
      <StatCard
        label="Total Posts"
        value={totalPosts}
        isLoading={mediaQuery.isLoading}
      />
      <StatCard
        label="Avg Engagement"
        value={avgEngagement}
        isPercent={true}
        isLoading={insightsQuery.isLoading}
      />
      <StatCard
        label="Period Reach"
        value={reach}
        isLoading={insightsQuery.isLoading}
      />
    </div>
  );
}
