import { instagramFetch } from "../client";
import type { PaginatedResponse } from "../types";

/**
 * Conversations API — incremental inbound messages since a cursor.
 *
 *   GET /<IG_ID>/conversations?platform=instagram
 *       &fields=updated_time,messages{id,created_time,from,message}
 *
 * Conversations come back newest-first by updated_time, so we walk pages until
 * a conversation older than the cursor is reached (nothing newer lies beyond).
 * Only the 20 newest messages per conversation are available — fine at a 60s
 * cadence. Each returned item carries the sender's messaging-scoped id
 * (from.id) and the text (message).
 *
 * NOTE: a quick-reply tap arrives here as text = the button's title —
 * `quick_reply.payload` is delivered on the *webhook* event only, never on a
 * poll — so a polling build matches confirms on text (button label / keyword).
 */

interface ConversationMessage {
  id: string;
  created_time?: string;
  from?: { id: string; username?: string };
  message?: string;
}

interface Conversation {
  id: string;
  updated_time?: string;
  messages?: PaginatedResponse<ConversationMessage>;
}

export interface InboundMessage {
  from_id: string;
  text: string;
  created_time: string;
}

// Safety cap on pages walked per cycle — at 60s cadence one page is normally
// enough; the cap bounds work if `updated_time` ordering ever surprises us.
const MAX_CONVERSATION_PAGES = 5;

export async function listInboundMessagesSince(
  sinceIso?: string
): Promise<InboundMessage[]> {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("INSTAGRAM_ACCOUNT_ID is not set. Add it to .env.local.");
  }

  const out: InboundMessage[] = [];
  let url: string | undefined;
  let page = 0;

  do {
    const result: PaginatedResponse<Conversation> = url
      ? await instagramFetch<PaginatedResponse<Conversation>>(url)
      : await instagramFetch<PaginatedResponse<Conversation>>(
          `/${accountId}/conversations`,
          {
            params: {
              platform: "instagram",
              fields: "updated_time,messages{id,created_time,from,message}",
            },
          }
        );

    let sawOlderThanCursor = false;
    for (const convo of result.data ?? []) {
      // Conversations are ordered newest-first; once one predates the cursor,
      // everything after it does too.
      if (sinceIso && convo.updated_time && convo.updated_time <= sinceIso) {
        sawOlderThanCursor = true;
        continue;
      }
      for (const msg of convo.messages?.data ?? []) {
        if (!msg.from?.id || msg.from.id === accountId) continue; // inbound only
        if (!msg.message || !msg.created_time) continue;
        if (sinceIso && msg.created_time <= sinceIso) continue;
        out.push({
          from_id: msg.from.id,
          text: msg.message,
          created_time: msg.created_time,
        });
      }
    }

    url = !sawOlderThanCursor ? result.paging?.next : undefined;
    page += 1;
  } while (url && page < MAX_CONVERSATION_PAGES);

  // Oldest-first so callers can process confirms in arrival order.
  out.sort((a, b) => a.created_time.localeCompare(b.created_time));
  return out;
}
