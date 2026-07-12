import { NextRequest, NextResponse } from "next/server";
import {
  publishMedia,
  getContainerStatus,
  ContainerFailedError,
  type PublishInput,
} from "@/lib/instagram/endpoints/publish";
import { InstagramError, RateLimitError } from "@/lib/instagram/types";
import { presignGet } from "@/lib/storage/r2";
import { reclaimKeys } from "@/lib/storage/reclaim";

export const dynamic = "force-dynamic";

const MEDIA_TYPES = new Set(["REELS", "IMAGE", "CAROUSEL", "STORIES"]);
const GRADUATION_STRATEGIES = new Set(["MANUAL", "SS_PERFORMANCE"]);

/**
 * Local-file sources uploaded straight to R2 (see docs/r2-integration.md). Each
 * value is an object key; `children` is index-aligned with `PublishInput.children`.
 * Resolved to a presigned GET and injected into the matching field before
 * publishMedia is called — the R2 key never reaches Instagram or publishMedia.
 */
interface R2Sources {
  video_url?: string;
  image_url?: string;
  cover_url?: string;
  children?: (string | null | undefined)[];
}

/**
 * Validate a publish request body. Returns an error string, or null if valid.
 * Enforces the API's source requirements per media_type so we fail fast with a
 * clear message instead of a cryptic Graph API error. A local-file R2 key
 * (`r2.*`) satisfies the same requirement as the matching pasted-URL field.
 */
function validate(body: PublishInput & { r2?: R2Sources }): string | null {
  const type = body.media_type ?? "IMAGE";
  if (!MEDIA_TYPES.has(type)) {
    return `media_type must be one of REELS, IMAGE, CAROUSEL, STORIES (got "${type}")`;
  }

  switch (type) {
    case "REELS":
      if (!body.video_url && !body.r2?.video_url) return "REELS requires video_url or a local file";
      break;
    case "IMAGE":
      if (!body.image_url && !body.r2?.image_url) return "IMAGE requires image_url or a local file";
      break;
    case "CAROUSEL":
      if (!body.children?.length) return "CAROUSEL requires children (2–10 items)";
      break;
    case "STORIES":
      if (!body.image_url && !body.video_url && !body.r2?.image_url && !body.r2?.video_url) {
        return "STORIES requires image_url or video_url or a local file";
      }
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
 * Resolve every `r2.*` key to a presigned GET and inject it into the matching
 * `PublishInput` field (or carousel child's image_url — carousel local files in
 * this app are always images, per the Photo tab). Returns the keys touched so the
 * caller can reclaim them once Instagram has ingested the media.
 */
async function resolveR2Sources(
  input: PublishInput,
  r2: R2Sources | undefined
): Promise<{ resolved: PublishInput; keysUsed: string[] }> {
  if (!r2) return { resolved: input, keysUsed: [] };

  const keysUsed: string[] = [];
  const resolved: PublishInput = { ...input };

  if (r2.video_url) {
    resolved.video_url = await presignGet(r2.video_url);
    keysUsed.push(r2.video_url);
  }
  if (r2.image_url) {
    resolved.image_url = await presignGet(r2.image_url);
    keysUsed.push(r2.image_url);
  }
  if (r2.cover_url) {
    resolved.cover_url = await presignGet(r2.cover_url);
    keysUsed.push(r2.cover_url);
  }
  if (r2.children?.length && resolved.children?.length) {
    const children = [...resolved.children];
    for (let i = 0; i < r2.children.length; i++) {
      const key = r2.children[i];
      if (!key) continue;
      const existing = children[i];
      const base = typeof existing === "string" ? {} : (existing ?? {});
      children[i] = { ...base, image_url: await presignGet(key) };
      keysUsed.push(key);
    }
    resolved.children = children;
  }

  return { resolved, keysUsed };
}

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

  const problem = validate(body);
  if (problem) {
    return NextResponse.json({ error: "invalid_param", message: problem }, { status: 400 });
  }

  const { finalize, timeoutMs, intervalMs, r2, ...input } = body;

  let keysUsed: string[] = [];
  try {
    const resolvedR2 = await resolveR2Sources(input, r2);
    keysUsed = resolvedR2.keysUsed;

    const result = await publishMedia(resolvedR2.resolved, { finalize, timeoutMs, intervalMs });
    // 202 when the container is still processing (timed out before FINISHED).
    const status = result.published ? 200 : result.status_code === "FINISHED" ? 200 : 202;

    // Only reclaim the R2 source once Instagram no longer needs it: the media is
    // published, or the container reached FINISHED (bytes fully ingested). On a
    // 202 the container is still IN_PROGRESS and may still be fetching the
    // source, so deleting it now would fail the container — leave those objects
    // in place. The client hands their keys to /api/publish/finalize (which
    // reclaims them once FINISHED), and the bucket lifecycle rule backstops
    // anything that never gets finalized.
    if (keysUsed.length && (result.published || result.status_code === "FINISHED")) {
      await reclaimKeys(keysUsed);
    }
    return NextResponse.json(result, { status });
  } catch (err) {
    // The publish failed outright — the container will never successfully fetch
    // this source, so it's safe to reclaim now.
    if (keysUsed.length) await reclaimKeys(keysUsed);
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
