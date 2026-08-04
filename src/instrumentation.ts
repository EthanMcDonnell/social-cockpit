export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/lib/automation-register");
    await import("@/lib/transcription/register");
    await import("@/lib/cache/register");
    await import("@/lib/token/register");
    await import("@/lib/schedule/register");
  }
}
