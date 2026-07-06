import { Suspense } from "react";
import { CockpitShell } from "@/components/dashboard/cockpit/CockpitShell";
import { Readouts } from "@/components/dashboard/cockpit/Readouts";
import { FollowerLineChart } from "@/components/dashboard/cockpit/FollowerLineChart";
import { VideoViewsChart } from "@/components/dashboard/cockpit/VideoViewsChart";
import { BestTimeHeatmap } from "@/components/dashboard/cockpit/BestTimeHeatmap";
import { PostsPerDayChart } from "@/components/dashboard/cockpit/PostsPerDayChart";

export const metadata = {
  title: "Dashboard",
};

export default function DashboardPage() {
  return (
    <CockpitShell>
      <div className="cabin">
        <Suspense>
          <Readouts />
        </Suspense>

        <div className="instruments">
          <Suspense>
            <FollowerLineChart />
          </Suspense>

          <div className="duo">
            <Suspense>
              <VideoViewsChart />
            </Suspense>
            <Suspense>
              <BestTimeHeatmap />
            </Suspense>
          </div>

          <Suspense>
            <PostsPerDayChart />
          </Suspense>
        </div>
      </div>
    </CockpitShell>
  );
}
