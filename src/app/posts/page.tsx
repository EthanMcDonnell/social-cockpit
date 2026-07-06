import { CockpitShell } from "@/components/dashboard/cockpit/CockpitShell";
import { PostsExplorer } from "@/components/posts/PostsExplorer";

export const metadata = {
  title: "Posts",
};

export default function PostsPage() {
  return (
    <CockpitShell>
      <PostsExplorer />
    </CockpitShell>
  );
}
