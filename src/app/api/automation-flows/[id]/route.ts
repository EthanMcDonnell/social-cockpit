import { NextRequest, NextResponse } from "next/server";
import { getDb, rowToFlow, type AutomationFlowRow } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = getDb();
    const existing = db
      .prepare("SELECT * FROM automation_flows WHERE id = ?")
      .get(params.id) as AutomationFlowRow | undefined;
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const body = await request.json();
    const name = body.name?.trim() ?? existing.name;
    const trigger_keyword = body.trigger_keywords !== undefined
      ? JSON.stringify(
          (body.trigger_keywords as string[])
            .map((k: string) => k.trim().toUpperCase())
            .filter(Boolean)
        )
      : existing.trigger_keyword;
    const config =
      body.config !== undefined ? JSON.stringify(body.config) : existing.config;
    const is_active =
      body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;
    const media_id =
      "media_id" in body ? (body.media_id ?? null) : (existing.media_id ?? null);
    const activated_at =
      is_active === 1 && existing.is_active === 0
        ? new Date().toISOString()
        : (existing.activated_at ?? null);

    db.prepare(
      "UPDATE automation_flows SET name=?, trigger_keyword=?, config=?, is_active=?, media_id=?, activated_at=? WHERE id=?"
    ).run(name, trigger_keyword, config, is_active, media_id, activated_at, params.id);

    const updated = db
      .prepare("SELECT * FROM automation_flows WHERE id = ?")
      .get(params.id) as AutomationFlowRow;
    return NextResponse.json(rowToFlow(updated));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = getDb();
    const result = db
      .prepare("DELETE FROM automation_flows WHERE id = ?")
      .run(params.id);
    if (result.changes === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
