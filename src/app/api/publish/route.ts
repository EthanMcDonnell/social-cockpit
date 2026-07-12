import { NextRequest, NextResponse } from "next/server";
import type { PublishInput } from "@/lib/instagram/endpoints/publish";
import {
  validatePublish,
  applyReelDefaults,
  publishFromR2,
  handlePublishError,
  getContainerStatus,
  type R2Sources,
} from "@/lib/instagram/publish-flow";

export const dynamic = "force-dynamic";

/**
 * POST /api/publish — create a media container and (by default) publish it.
 *
 * Body: the full container parameter set (see PublishInput), plus an optional
 * `r2` map of local-file object keys (see docs/r2-integration.md) for
 * video_url/image_url/cover_url/children sourced from a browser→R2 upload
 * instead of a pasted URL. Options:
 *   - finalize:false        create the container but don't publish (scheduling / manual)
 *   - timeoutMs, intervalMs  processing-poll tuning
 *
 * To publish a video straight from a local filesystem path (server reads the
 * file, uploads to R2, then calls Instagram), use POST /api/publish/local.
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
    r2?: R2Sources;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "Body must be valid JSON" },
      { status: 400 }
    );
  }

  const problem = validatePublish(body);
  if (problem) {
    return NextResponse.json({ error: "invalid_param", message: problem }, { status: 400 });
  }

  const { finalize, timeoutMs, intervalMs, r2, ...input } = body;
  applyReelDefaults(input, r2);

  try {
    const { result, status } = await publishFromR2(input, r2, { finalize, timeoutMs, intervalMs });
    return NextResponse.json(result, { status });
  } catch (err) {
    return handlePublishError(err);
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
    return handlePublishError(err);
  }
}
