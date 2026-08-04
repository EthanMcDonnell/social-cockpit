/**
 * Optional bearer-token gate for the scheduling API.
 *
 * The rest of this app is unauthenticated because it binds to localhost for a
 * single user, and POST /api/schedule is no more privileged than the existing
 * POST /api/publish/local. But it *does* take a filesystem path and publish to
 * your accounts, so if the port is ever reachable off-localhost it wants a lock.
 *
 * No-op unless SCHEDULE_API_TOKEN is set, so the default single-user install is
 * unchanged. Pair it with LOCAL_MEDIA_ROOT, which confines which paths the
 * endpoint will read at all.
 */

import { NextResponse, type NextRequest } from "next/server";

/** Returns a 401 response when the request should be rejected, else null. */
export function requireScheduleAuth(request: NextRequest): NextResponse | null {
  const expected = process.env.SCHEDULE_API_TOKEN;
  if (!expected) return null;

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : header;

  if (!timingSafeEqual(presented, expected)) {
    return NextResponse.json(
      { error: "unauthorized", message: "Missing or invalid SCHEDULE_API_TOKEN." },
      { status: 401 }
    );
  }
  return null;
}

/** Constant-time compare — the token is short and guessing it is the attack. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
