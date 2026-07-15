/**
 * Upload a local file straight to R2 from the browser: reserve cap + sign via
 * /api/publish/r2-sign, then PUT the bytes directly to R2 (this server never sees
 * them). Returns the object key. Shared by the Instagram and YouTube publish
 * hooks. See docs/r2-integration.md.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

function extOf(file: File): string {
  const dot = file.name.lastIndexOf(".");
  return dot >= 0 ? file.name.slice(dot + 1) : "";
}

export interface R2Upload {
  key: string;
  contentType: string;
  size: number;
}

export async function uploadToR2Detailed(file: File): Promise<R2Upload> {
  const contentType = file.type || "application/octet-stream";
  const signRes = await fetch("/api/publish/r2-sign", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ contentType, size: file.size, ext: extOf(file) }),
  });
  const signData = (await signRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!signRes.ok) throw new Error((signData.message as string) ?? "Could not start upload");

  const { key, uploadUrl } = signData as { key: string; uploadUrl: string };
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload to storage failed (${put.status})`);
  return { key, contentType, size: file.size };
}

/** Key-only variant for callers that just need the R2 key (Instagram path). */
export async function uploadToR2(file: File): Promise<string> {
  return (await uploadToR2Detailed(file)).key;
}
