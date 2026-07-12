# Cloudflare R2 setup: publishing local files from Compose Studio

Compose Studio (the Reel/Photo/Story tabs) publishes by **uploading local files**, not by pasting a hosted URL; there's no URL field in the UI. To publish anything from Compose Studio, you need an R2 bucket. For why this is required rather than optional, see [`r2-integration.md`](r2-integration.md#why-this-is-required-not-just-a-convenience).

> [!NOTE]
> R2 is only skippable if you never touch the Compose Studio UI and instead drive `POST /api/publish` directly (e.g. via `curl`) with a `video_url`/`image_url` you're already hosting elsewhere. Everything else in the app (dashboard, inbox, automations) works with or without R2.

## How it works

```
Drag a file → browser uploads straight to a PRIVATE R2 bucket → server hands
Instagram a short-lived signed URL → Instagram fetches + publishes → the
object is deleted
```

The bucket is never made public: every URL Instagram ever sees is a single-object, self-expiring signed link (~2 hours), and the object is deleted right after publish (with a 1-day lifecycle rule as a backstop).

## Setup

Infra is defined as Terraform in `infra/`. One-time setup:

1. **Enable R2** on your Cloudflare account: Dashboard → R2 Object Storage → Enable/Purchase R2.
2. **Create a temporary bootstrap token**: My Profile → API Tokens → Create Token → Custom Token → **Account → Workers R2 Storage: Edit** + **Account → API Tokens: Edit**. This token only exists to let Terraform provision the bucket *and* the app's own scoped, **account-owned** R2 token in one step; create it right before the next step, and revoke it right after. It's never used by the running app. (The app's token is account-owned rather than tied to your personal login, so it keeps working even if you later lose access to the account.)
3. **Provision the bucket:**
   ```bash
   export CLOUDFLARE_API_TOKEN=<the bootstrap token>
   cd infra
   cp terraform.tfvars.example terraform.tfvars   # fill in your account_id
   ./setup.sh
   ```
4. **Reveal the app's credentials** (printed by `setup.sh`, or run manually):
   ```bash
   terraform output -raw access_key_id
   terraform output -raw secret_access_key
   ```
5. **Fill in `.env.local`** with those two values plus `R2_ACCOUNT_ID`/`R2_BUCKET` (see the [Configuration](../README.md#️-configuration) section of the README).
6. **Revoke the bootstrap token** in the dashboard; it's done its job.
7. **Set a Budget Alert**: Dashboard → Billing → Budget Alerts, a ~$0.01 tripwire. No Terraform resource covers this; it's a one-time manual click.

Restart the server, then drag a file into Compose Studio's Reel/Photo/Story tab.

## Troubleshooting

- **`storage_cap` / 429 on publish**: the local usage gate (`R2_CAP_BYTES`, default 8 GiB) thinks the bucket is near full. Check actual usage in the Cloudflare dashboard; if it's a stale reservation, restarting the server triggers reconciliation.
- **Presigned PUT rejected by the browser**: the file's `Content-Type` or size didn't match what was signed for; re-select the file and retry.
- **Terraform apply fails on token creation**: confirm the bootstrap token has both `Workers R2 Storage: Edit` and `Account API Tokens: Edit` scopes (the second is easy to miss).

For the full design rationale (security posture, storage-cap enforcement, Terraform resource layout), see [`r2-integration.md`](r2-integration.md).
