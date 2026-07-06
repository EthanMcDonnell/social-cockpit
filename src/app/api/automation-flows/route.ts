import { NextRequest, NextResponse } from "next/server";
import { getDb, rowToFlow, type AutomationFlowRow, type AutomationConfig, type AutomationTemplateType } from "@/lib/db";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM automation_flows ORDER BY created_at ASC")
      .all() as AutomationFlowRow[];
    return NextResponse.json(rows.map(rowToFlow));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, trigger_keywords, config, media_id, media_ids, template_type } = body as {
      name: string;
      trigger_keywords: string[];
      config: AutomationConfig;
      media_id?: string;
      media_ids?: string[];
      template_type?: AutomationTemplateType;
    };

    const keywords = (Array.isArray(trigger_keywords) ? trigger_keywords : [])
      .map((k) => k.trim().toUpperCase())
      .filter(Boolean);

    // Support both the new multi-video field and the legacy single media_id.
    const mediaIds = Array.isArray(media_ids)
      ? media_ids.filter(Boolean)
      : media_id
        ? [media_id]
        : [];

    if (!name?.trim() || keywords.length === 0) {
      return NextResponse.json(
        { error: "missing_param", message: "name and at least one trigger_keyword are required" },
        { status: 400 }
      );
    }

    const resolvedType: AutomationTemplateType =
      template_type === "comment_to_reply"
        ? "comment_to_reply"
        : template_type === "comment_to_follow_dm"
          ? "comment_to_follow_dm"
          : "comment_to_dm";

    // Persist the full target list inside config; keep the media_id column
    // populated with the primary id for backward-compatible list display.
    const storedConfig = { ...(config ?? {}), media_ids: mediaIds };

    const db = getDb();
    const id = randomUUID();
    db.prepare(
      "INSERT INTO automation_flows (id, name, template_type, trigger_keyword, config, media_id) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, name.trim(), resolvedType, JSON.stringify(keywords), JSON.stringify(storedConfig), mediaIds[0] ?? null);

    const row = db.prepare("SELECT * FROM automation_flows WHERE id = ?").get(id) as AutomationFlowRow;
    return NextResponse.json(rowToFlow(row), { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
