import { NextRequest, NextResponse } from "next/server";
import { listComments } from "@/lib/instagram/endpoints/comments";
import { replyToComment, sendPrivateReply } from "@/lib/instagram/endpoints/comments";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";
import { getDb, rowToAutomation, resolveTemplate, type AutomationRow } from "@/lib/db";

export const dynamic = "force-dynamic";

async function processAutomations(postId: string, comments: Awaited<ReturnType<typeof listComments>>["data"]) {
  const db = getDb();
  const automations = (
    db.prepare("SELECT * FROM automations WHERE post_id = ? AND is_active = 1").all(postId) as AutomationRow[]
  ).map(rowToAutomation);

  if (automations.length === 0) return;

  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;

  for (const automation of automations) {
    for (const comment of comments) {
      if (!comment.text) continue;
      if (accountId && comment.from?.id === accountId) continue;
      if (!comment.text.toLowerCase().includes(automation.keyword.toLowerCase())) continue;

      const alreadyFired = db
        .prepare("SELECT 1 FROM fired_automations WHERE automation_id = ? AND comment_id = ?")
        .get(automation.id, comment.id);
      if (alreadyFired) continue;

      const message = resolveTemplate(automation.template_body, automation.placeholder_values);

      try {
        if (automation.action_type === "comment") {
          await replyToComment(comment.id, message);
        } else {
          await sendPrivateReply(comment.id, message);
        }
        db.prepare("INSERT OR IGNORE INTO fired_automations (automation_id, comment_id) VALUES (?, ?)").run(
          automation.id,
          comment.id
        );
      } catch (err) {
        console.error(`Automation ${automation.id} failed for comment ${comment.id}:`, err);
      }
    }
  }
}

export async function GET(request: NextRequest) {
  const postId = request.nextUrl.searchParams.get("post_id");
  if (!postId) {
    return NextResponse.json({ error: "missing_param", message: "post_id is required" }, { status: 400 });
  }

  try {
    const result = await listComments(postId);
    await processAutomations(postId, result.data).catch(console.error);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: "rate_limit", message: err.message }, { status: 429 });
    }
    if (err instanceof InstagramError) {
      return NextResponse.json({ error: "instagram_api", message: err.message, code: err.code }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
