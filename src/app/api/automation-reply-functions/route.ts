import { NextResponse } from "next/server";
import { listReplyFunctions } from "@/lib/comment-reply-functions";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listReplyFunctions());
}
