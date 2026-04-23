import { NextRequest, NextResponse } from "next/server";
import { getDb, rowToAutomation, type AutomationRow } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM automations WHERE id = ?").get(params.id) as AutomationRow | undefined;
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const body = await request.json();
    const keyword = body.keyword?.trim() ?? existing.keyword;
    const action_type = body.action_type ?? existing.action_type;
    const template_body = body.template_body?.trim() ?? existing.template_body;
    const placeholder_values =
      body.placeholder_values !== undefined
        ? JSON.stringify(body.placeholder_values)
        : existing.placeholder_values;
    const is_active =
      body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;

    db.prepare(
      "UPDATE automations SET keyword=?, action_type=?, template_body=?, placeholder_values=?, is_active=? WHERE id=?"
    ).run(keyword, action_type, template_body, placeholder_values, is_active, params.id);

    const updated = db.prepare("SELECT * FROM automations WHERE id = ?").get(params.id) as AutomationRow;
    return NextResponse.json(rowToAutomation(updated));
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
    db.prepare("DELETE FROM fired_automations WHERE automation_id = ?").run(params.id);
    const result = db.prepare("DELETE FROM automations WHERE id = ?").run(params.id);
    if (result.changes === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "internal", message }, { status: 500 });
  }
}
