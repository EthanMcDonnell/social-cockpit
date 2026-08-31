import { NextRequest, NextResponse } from "next/server";
import { requireScheduleAuth } from "@/lib/schedule/auth";
import { ensureSlug, listSlugs, normalizeSlug, updateSlug } from "@/lib/slugs/store";
import { getDefaultSelectionMethod } from "@/lib/slugs/settings";
import { isSelectionMethod, SELECTION_METHODS } from "@/lib/slugs/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/slugs — every content pool, with its counts and the automation flow
 * sharing its name. `default_selection` is reported alongside so the UI can
 * label a slug with no override of its own without a second request.
 */
export async function GET(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  return NextResponse.json({
    default_selection: getDefaultSelectionMethod(),
    methods: SELECTION_METHODS,
    slugs: listSlugs(),
  });
}

/**
 * POST /api/slugs — create a pool, or rename one that already exists.
 *
 *   { "slug": "gym-tips", "name": "Gym tips", "selection_method": "most_views" }
 *
 * Creating a pool by hand is optional: publishing or scheduling with a slug
 * creates it. This exists so a pool can be filled before anything is booked
 * against it.
 */
export async function POST(request: NextRequest) {
  const denied = requireScheduleAuth(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const invalid = (message: string) =>
    NextResponse.json({ error: "invalid_param", message }, { status: 400 });

  if (typeof body?.slug !== "string" || !body.slug.trim()) {
    return invalid("slug is required.");
  }
  const slug = normalizeSlug(body.slug);
  if (!slug) return invalid("A slug needs at least one letter or digit.");

  if (body.selection_method !== undefined && body.selection_method !== null) {
    if (!isSelectionMethod(body.selection_method)) {
      return invalid(`selection_method must be one of: ${SELECTION_METHODS.join(", ")}.`);
    }
  }

  if (body.repost_eligible !== undefined && typeof body.repost_eligible !== "boolean") {
    return invalid("repost_eligible must be a boolean.");
  }

  ensureSlug(slug, typeof body.name === "string" ? body.name : undefined);
  const updated = updateSlug(slug, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.selection_method !== undefined ? { selection_method: body.selection_method } : {}),
    ...(body.repost_eligible !== undefined ? { repost_eligible: body.repost_eligible } : {}),
  });

  return NextResponse.json({ slug: updated }, { status: 201 });
}
