import { NextRequest, NextResponse } from "next/server";
import { getDb, rowToAutomation, type AutomationRow } from "@/lib/db";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const postId = request.nextUrl.searchParams.get("post_id");
  if (!postId) {
    return NextResponse.json({ error: "missing_param", message: "post_id is required" }, { status: 400 });
  }
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM automations WHERE post_id = ? ORDER BY created_at ASC")
      .all(postId) as AutomationRow[];
    return NextResponse.json(rows.map(rowToAutomation));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { post_id, keyword, action_type, template_body, placeholder_values = {} } = body;

    if (!post_id || !keyword?.trim() || !action_type || !template_body?.trim()) {
      return NextResponse.json({ error: "missing_param", message: "post_id, keyword, action_type, template_body required" }, { status: 400 });
    }
    if (!["comment", "dm"].includes(action_type)) {
      return NextResponse.json({ error: "invalid_param", message: "action_type must be 'comment' or 'dm'" }, { status: 400 });
    }

    const db = getDb();
    const id = randomUUID();
    db.prepare(
      "INSERT INTO automations (id, post_id, keyword, action_type, template_body, placeholder_values) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, post_id, keyword.trim(), action_type, template_body.trim(), JSON.stringify(placeholder_values));

    const row = db.prepare("SELECT * FROM automations WHERE id = ?").get(id) as AutomationRow;
    return NextResponse.json(rowToAutomation(row), { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
