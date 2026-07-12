/**
 * DM message packs for the comment_to_follow_dm funnel — the DM equivalent of
 * comment-reply-functions.ts. A pack bundles the *opener* and *nudge* in one
 * voice so the funnel reads consistently; the reward stays manual (it's your
 * actual link/code). Copy uses a `{{resource}}` token (default "resources")
 * always as a grammatical object, so one pack serves any reward and reads
 * correctly whether it's "the guide" or "the resources". Emoji only ever at the
 * end of a line, at most one.
 *
 * The funnel confirms via reply-to-confirm: the opener is a plain DM asking the
 * user to follow, then reply the confirm keyword, so copy references
 * `${keyword}` (e.g. `reply "DONE"`) rather than any button.
 *
 * `name` is a ready-to-drop personal address: ` @handle` when we know the
 * commenter's handle, or "" when we don't — so `commenting${name}!` reads as
 * "commenting @jane!" or just "commenting!" with no stray spaces.
 */

export interface FollowDmContext {
  username: string;
  name: string;       // " @handle" if known, else "" — drop straight into copy
  comment: string;
  keyword: string;    // confirm keyword the user replies (e.g. "DONE")
  resource: string;   // {{resource}} value, default "resources"
}

type DmFn = (ctx: FollowDmContext) => string;
interface DmPack {
  opener: DmFn;
  nudge: DmFn;
}

const pick = (o: string[]) => o[Math.floor(Math.random() * o.length)];

export const followDmPacks: Record<string, DmPack> = {
  casual: {
    opener: ({ resource, keyword, name }) =>
      pick([
        `Thanks for commenting${name}!\n\nReply "${keyword}" to get the ${resource} — just make sure you're following.`,
        `Appreciate the comment${name}.\n\nReply "${keyword}" for the ${resource} once you're following.`,
        `Cheers for the comment${name}.\n\nFollow, then reply "${keyword}" to get the ${resource}.`,
      ]),
    nudge: ({ resource, keyword }) =>
      pick([
        `Just need you to follow so I can send the ${resource} through 👍`,
        `Can't send the ${resource} till you follow, do that then reply "${keyword}" again`,
        `Chuck me a cheeky follow first and then reply here with "${keyword}" for the ${resource}`,
        `Gotta be following before I can send the ${resource}. Follow me then reply here with "${keyword}"`,
        `Follow me and I'll send the ${resource} straight through`,
        `Follow me and I'll get the ${resource} to you, then reply here with "${keyword}"`,
        `Need you following before I can send the ${resource}. Follow me and then reply here with "${keyword} again" 🙏`,
        `Almost there, follow me so I can send the ${resource} then reply here with "${keyword}" again`,
      ]),
  },
};

export function callDmPack(
  name: string,
  slot: "opener" | "nudge",
  ctx: FollowDmContext
): string | null {
  const pack = followDmPacks[name];
  return pack ? pack[slot](ctx) : null;
}

export function listDmPacks(): Array<{ name: string; opener: string; nudge: string }> {
  const s: FollowDmContext = {
    username: "",
    name: "",
    comment: "",
    keyword: "DONE",
    resource: "resources",
  };
  return Object.entries(followDmPacks).map(([name, p]) => ({
    name,
    opener: p.opener(s),
    nudge: p.nudge(s),
  }));
}
