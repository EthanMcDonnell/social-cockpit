/**
 * Guess the trigger keyword a caption is asking people to comment.
 *
 * Captions that drive a comment funnel almost always say so literally —
 * "comment LINK below", "type GUIDE for the checklist", "drop WORD 👇". The
 * keyword is nearly always shouted in caps, which is the signal we key on.
 *
 * This only ever *prefills* the automation form. It never writes a flow on its
 * own: a wrong guess that silently starts DMing people would be far worse than
 * no guess at all.
 *
 * Pure and client-safe.
 */

/** Verbs that introduce a keyword, and the window we look at after them. */
const CUE = /\b(comment|type|drop|dm|send|reply|write|say)\b/gi;

/** All-caps runs that are words, not acronyms we'd rather not suggest. */
const CAPS_WORD = /\b[A-Z][A-Z0-9]{2,15}\b/g;

/** Common all-caps noise that is never somebody's trigger keyword. */
const STOPWORDS = new Set([
  "THE", "AND", "FOR", "YOU", "YOUR", "NOW", "NEW", "ALL", "GET", "OUT",
  "WITH", "THIS", "THAT", "HOW", "WHY", "WHAT", "FREE", "BIO", "LINK IN BIO",
  "DM", "DMS", "PDF", "AI", "USA", "CEO", "OMG", "LOL", "POV", "FYI",
]);

/**
 * Ranked keyword suggestions, best first. A caps word within ~30 characters
 * after a cue verb ranks above one that merely appears somewhere in the caption.
 */
export function suggestKeywords(caption: string, limit = 3): string[] {
  if (!caption?.trim()) return [];

  const scored = new Map<string, number>();

  const consider = (word: string, score: number) => {
    const key = word.toUpperCase();
    if (STOPWORDS.has(key)) return;
    scored.set(key, Math.max(scored.get(key) ?? 0, score));
  };

  // Pass 1 — caps words shortly after a cue verb. Strongest signal by far.
  CUE.lastIndex = 0;
  let cue: RegExpExecArray | null;
  while ((cue = CUE.exec(caption)) !== null) {
    const window = caption.slice(cue.index + cue[0].length, cue.index + cue[0].length + 30);
    const inWindow = window.match(CAPS_WORD);
    if (inWindow?.length) consider(inWindow[0], 2);
  }

  // Pass 2 — any caps word, as a weaker fallback.
  for (const word of caption.match(CAPS_WORD) ?? []) consider(word, 1);

  return Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}
