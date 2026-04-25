import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { StatCardGrid } from "@/components/dashboard/StatCardGrid";
import { FollowerChart } from "@/components/dashboard/FollowerChart";
import { VideoViewsChart } from "@/components/dashboard/VideoViewsChart";
import { PostMetricsTable } from "@/components/dashboard/PostMetricsTable";
import { DataDelayBanner } from "@/components/dashboard/DataDelayBanner";
import { PostingConsistencyChart } from "@/components/dashboard/PostingConsistencyChart";
import { BestTimeHeatmap } from "@/components/dashboard/BestTimeHeatmap";

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

          {/* Strip 1: Followers (3/5) + Video Views (2/5) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:items-stretch">
            <div className="lg:col-span-3 flex flex-col">
              <FollowerChart className="flex-1" />
            </div>
            <div className="lg:col-span-2 flex flex-col">
              <VideoViewsChart className="flex-1" />
            </div>
          </div>

          {/* Strip 2: Posting Consistency (2/5) + Heatmap (3/5) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <PostingConsistencyChart />
            </div>
            <div className="lg:col-span-3">
              <BestTimeHeatmap />
            </div>
          </div>

          {/* Post metrics table */}
          <PostMetricsTable />
        </Suspense>
      </div>
    </AppShell>
  );
}
