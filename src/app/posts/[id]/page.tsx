import { CockpitShell } from "@/components/dashboard/cockpit/CockpitShell";
import { PostDetailPanel } from "@/components/posts/PostDetailPanel";

export const metadata = {
  title: "Post Detail",
};

export default function PostDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <CockpitShell>
      <PostDetailPanel mediaId={params.id} />
    </CockpitShell>
  );
}
