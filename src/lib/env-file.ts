/**
 * Update-or-append an environment variable in the project's `.env` file.
 *
 * Extracted so new server-side auth code (YouTube OAuth) can persist refreshed
 * credentials the same way the Instagram token manager does, without importing
 * from that module. Regex replace on a single line — same behavior as the copy
 * in src/lib/token/manager.ts (which predates this and keeps its own for now).
 *
 * Server-side only — reads/writes the filesystem.
 */

import fs from "fs";
import path from "path";

export const ENV_FILE = path.resolve(process.cwd(), ".env");

export function writeEnvVar(key: string, value: string, filePath = ENV_FILE): void {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `${key}=${value}\n`, "utf-8");
      return;
    }

    let text = fs.readFileSync(filePath, "utf-8");
    const pattern = new RegExp(`^${key}=.*$`, "m");

    if (pattern.test(text)) {
      text = text.replace(pattern, `${key}=${value}`);
    } else {
      text = text.replace(/\n?$/, `\n${key}=${value}\n`);
    }

    fs.writeFileSync(filePath, text, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to write ${key} to ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
