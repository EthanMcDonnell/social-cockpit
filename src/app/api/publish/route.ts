import { NextRequest, NextResponse } from "next/server";
import {
  publishMedia,
  getContainerStatus,
  ContainerFailedError,
  type PublishInput,
} from "@/lib/instagram/endpoints/publish";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

const MEDIA_TYPES = new Set(["REELS", "IMAGE", "CAROUSEL", "STORIES"]);
const GRADUATION_STRATEGIES = new Set(["MANUAL", "SS_PERFORMANCE"]);

/**
 * Validate a publish request body. Returns an error string, or null if valid.
 * Enforces the API's source requirements per media_type so we fail fast with a
 * clear message instead of a cryptic Graph API error.
 */
function validate(body: PublishInput): string | null {
  const type = body.media_type ?? "IMAGE";
  if (!MEDIA_TYPES.has(type)) {
    return `media_type must be one of REELS, IMAGE, CAROUSEL, STORIES (got "${type}")`;
  }

  switch (type) {
    case "REELS":
      if (!body.video_url) return "REELS requires video_url";
      break;
    case "IMAGE":
      if (!body.image_url) return "IMAGE requires image_url";
      break;
    case "CAROUSEL":
      if (!body.children?.length) return "CAROUSEL requires children (2–10 items)";
      break;
    case "STORIES":
      if (!body.image_url && !body.video_url) return "STORIES requires image_url or video_url";
      break;
  }

  if (body.trial_params) {
    if (type !== "REELS") return "trial_params is only valid for REELS";
    if (!GRADUATION_STRATEGIES.has(body.trial_params.graduation_strategy)) {
      return "trial_params.graduation_strategy must be MANUAL or SS_PERFORMANCE";
    }
  }

  if (body.caption && body.caption.length > 2200) {
    return "caption exceeds 2200 characters";
  }
  if (body.collaborators && body.collaborators.length > 3) {
    return "collaborators is limited to 3";
  }
  if (body.product_tags && body.product_tags.length > 5) {
    return "product_tags is limited to 5";
  }

  return null;
}

/**
 * POST /api/publish — create a media container and (by default) publish it.
 *
 * Body: the full container parameter set (see PublishInput). Options:
 *   - finalize:false        create the container but don't publish (scheduling / manual)
 *   - timeoutMs, intervalMs  processing-poll tuning
 *
 * Reusable from anywhere on the machine, e.g.:
 *   curl -X POST localhost:3000/api/publish -H 'Content-Type: application/json' \
 *     -d '{"media_type":"REELS","video_url":"https://…/reel.mp4","caption":"gm",
 *          "trial_params":{"graduation_strategy":"MANUAL"}}'
 */
export async function POST(request: NextRequest) {
  let body: PublishInput & {
    finalize?: boolean;
    timeoutMs?: number;
    intervalMs?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "Body must be valid JSON" },
      { status: 400 }
    );
  }

  const problem = validate(body);
  if (problem) {
    return NextResponse.json({ error: "invalid_param", message: problem }, { status: 400 });
  }

  const { finalize, timeoutMs, intervalMs, ...input } = body;

  try {
    const result = await publishMedia(input, { finalize, timeoutMs, intervalMs });
    // 202 when the container is still processing (timed out before FINISHED).
    const status = result.published ? 200 : result.status_code === "FINISHED" ? 200 : 202;
    return NextResponse.json(result, { status });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * GET /api/publish?container_id=… — check a container's processing status.
 * Use after a 202 to know when it's FINISHED and safe to finalize.
 */
export async function GET(request: NextRequest) {
  const containerId = request.nextUrl.searchParams.get("container_id");
  if (!containerId) {
    return NextResponse.json(
      { error: "missing_param", message: "container_id is required" },
      { status: 400 }
    );
  }

  try {
    const status = await getContainerStatus(containerId);
    return NextResponse.json(status);
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown): NextResponse {
  if (err instanceof RateLimitError) {
    return NextResponse.json({ error: "rate_limit", message: err.message }, { status: 429 });
  }
  if (err instanceof ContainerFailedError) {
    return NextResponse.json(
      { error: "processing_failed", message: err.message, container_id: err.containerId },
      { status: 422 }
    );
  }
  if (err instanceof InstagramError) {
    return NextResponse.json(
      { error: "instagram_api", message: err.message, code: err.code },
      { status: 400 }
    );
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return NextResponse.json({ error: "internal", message }, { status: 500 });
}
