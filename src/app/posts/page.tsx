import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { PostsExplorer } from "@/components/posts/PostsExplorer";

export const metadata = {
  title: "Posts",
};

export default function PostsPage() {
  return (
    <AppShell>
      <TopBar title="Posts" />
      <div className="flex-1 overflow-y-auto p-6">
        <PostsExplorer />
      </div>
    </AppShell>
  );
}
