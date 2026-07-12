/**
 * Cloudflare R2 media-hosting layer (S3-compatible). Private bucket, single-object
 * capability URLs only — see docs/r2-integration.md for the full design.
 *
 * Browser PUTs a local file straight to R2 via presignPut(); the server later hands
 * Instagram a presignGet() URL to fetch + publish from; deleteObject() cleans up.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const PUT_TTL_SECONDS = 5 * 60;
const GET_TTL_SECONDS = 2 * 60 * 60;

let _client: S3Client | null = null;

function client(): S3Client {
  if (_client) return _client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY must be set. Add them to .env."
    );
  }

  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

function bucket(): string {
  const name = process.env.R2_BUCKET;
  if (!name) throw new Error("R2_BUCKET must be set. Add it to .env.");
  return name;
}

/** Unguessable object key under publish/, preserving the file's extension. */
export function generateKey(ext: string): string {
  const clean = ext.replace(/^\./, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `publish/${randomUUID()}${clean ? `.${clean}` : ""}`;
}

/**
 * Presigned PUT for a direct browser→R2 upload. Pinned to the exact key,
 * Content-Type, and Content-Length so a leaked URL can't be reused to upload
 * anything other than the declared file — the caller's declared `size` becomes
 * the actual size, since S3 rejects a PUT whose Content-Length doesn't match.
 */
export async function presignPut(
  key: string,
  contentType: string,
  size: number
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
    ContentLength: size,
  });
  return getSignedUrl(client(), command, { expiresIn: PUT_TTL_SECONDS });
}

/**
 * Server-side upload straight into the bucket. Used by the local-file publish
 * path (POST /api/publish/local), where the server reads a filesystem path and
 * pushes the bytes itself rather than handing the browser a presigned PUT. The
 * body is an in-memory Buffer, so `size` is authoritative for the Content-Length.
 */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
  size: number
): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: size,
    })
  );
}

/** Presigned GET for Instagram to fetch the object from. ~2h TTL. */
export async function presignGet(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket(), Key: key });
  return getSignedUrl(client(), command, { expiresIn: GET_TTL_SECONDS });
}

/** Best-effort delete — callers should not let a failure here block the response. */
export async function deleteObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
