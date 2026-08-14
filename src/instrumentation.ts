export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // First, and deliberately unguarded: a bad .env should stop the server here,
    // with the full list of problems, rather than surface later as one confusing
    // request failure at a time. The workers below publish and send DMs, so
    // starting them against a configuration we could not parse is the outcome
    // worth failing to avoid.
    const { assertConfigValid } = await import("@/lib/config");
    assertConfigValid();

    await import("@/lib/automation-register");
    await import("@/lib/transcription/register");
    await import("@/lib/cache/register");
    await import("@/lib/token/register");
    await import("@/lib/schedule/register");
  }
}
