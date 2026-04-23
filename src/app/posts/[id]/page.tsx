import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
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
    <AppShell>
      <TopBar title="Post Detail" />
      <div className="flex-1 overflow-y-auto p-6">
        <PostDetailPanel mediaId={params.id} />
      </div>
    </AppShell>
  );
}
