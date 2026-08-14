export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // First, and deliberately unguarded: a bad .env should stop the server here,
    // with the full list of problems, rather than surface later as one confusing
    // request failure at a time. The workers below publish and send DMs, so
    // starting them against a configuration we could not parse is the outcome
    // worth failing to avoid.
    const { assertConfigValid } = await import("@/lib/config");
    assertConfigValid();

    // The other half of the same check. config.ts can only see .env, and the
    // live Instagram token may legitimately be in the database instead, so this
    // asks the question .env alone cannot answer. It also opens the DB, which
    // applies the 0600 tightening before any worker writes a secret into it.
    const { assertCredentialsPresent } = await import("@/lib/credentials");
    assertCredentialsPresent();

    await import("@/lib/automation-register");
    await import("@/lib/transcription/register");
    await import("@/lib/cache/register");
    await import("@/lib/token/register");
    await import("@/lib/schedule/register");
  }
}
