output "endpoint" {
  description = "R2 S3-compatible endpoint — set as the base for the AWS SDK client"
  value       = "https://${var.account_id}.r2.cloudflarestorage.com"
}

output "bucket" {
  value = cloudflare_r2_bucket.media.name
}

output "account_id" {
  value = var.account_id
}

# S3 credentials are derived from the API token, not separate resources:
# access_key_id = the token id; secret_access_key = SHA-256 of the token value.
# https://developers.cloudflare.com/r2/api/tokens/
#
# Marked sensitive so a plain `terraform output` never prints them — use
# `terraform output -raw access_key_id` / `-raw secret_access_key` explicitly
# when you're ready to copy them into .env.
output "access_key_id" {
  value     = cloudflare_account_token.r2_media.id
  sensitive = true
}

output "secret_access_key" {
  value     = sha256(cloudflare_account_token.r2_media.value)
  sensitive = true
}
