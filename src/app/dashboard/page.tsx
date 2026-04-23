import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { StatCardGrid } from "@/components/dashboard/StatCardGrid";
import { FollowerChart } from "@/components/dashboard/FollowerChart";
import { VideoViewsChart } from "@/components/dashboard/VideoViewsChart";
import { PostMetricsTable } from "@/components/dashboard/PostMetricsTable";
import { DataDelayBanner } from "@/components/dashboard/DataDelayBanner";
import { PostingConsistencyChart } from "@/components/dashboard/PostingConsistencyChart";

export const metadata = {
  title: "Dashboard",
};

export default function DashboardPage() {
  return (
    <AppShell>
      <TopBar title="Dashboard" showPeriodSelector />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <DataDelayBanner />
        <Suspense>
          {/* KPI row */}
          <StatCardGrid />

          {/* Followers + Profile Views (50/50) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FollowerChart />
            <VideoViewsChart />
          </div>

          {/* Posting consistency */}
          <PostingConsistencyChart />

          {/* Post metrics table */}
          <PostMetricsTable />
        </Suspense>
      </div>
    </AppShell>
  );
}
