import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { PostGrid } from "@/components/posts/PostGrid";

export const metadata = {
  title: "Posts",
};

export default function PostsPage() {
  return (
    <AppShell>
      <TopBar title="Posts" />
      <div className="flex-1 overflow-y-auto p-6">
        <PostGrid />
      </div>
    </AppShell>
  );
}
