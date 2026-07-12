terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {}

resource "cloudflare_r2_bucket" "media" {
  account_id = var.account_id
  name       = var.bucket_name
  location   = "ENAM"
}

# Private bucket — no public/r2.dev access is enabled anywhere in this config.
resource "cloudflare_r2_bucket_cors" "media" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.media.name

  rules = [
    {
      allowed = {
        methods = ["PUT"]
        origins = [var.allowed_origin]
        headers = ["content-type", "content-length"]
      }
      max_age_seconds = 300
    }
  ]
}

# Backstop: auto-delete publish/ objects after object_ttl_days, independent of
# whether the app's own delete-after-publish step ever ran.
resource "cloudflare_r2_bucket_lifecycle" "media" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.media.name

  rules = [
    {
      id      = "expire-publish-objects"
      enabled = true
      conditions = {
        prefix = "publish/"
      }
      abort_multipart_uploads_transition = null
      delete_objects_transition = {
        condition = {
          type    = "Age"
          max_age = var.object_ttl_days * 24 * 60 * 60
        }
      }
    }
  ]
}

# Scoped, account-owned R2 token — Object Read & Write on this one bucket only.
# Account-owned (cloudflare_account_token, not the user-owned cloudflare_api_token)
# so it belongs to the account itself and keeps working even if whoever ran
# Terraform later loses access to the account. This is the credential the running
# app uses continuously (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY in .env). If it
# leaks, blast radius is one bucket.
#
# ── Why this requires a powerful bootstrap token, and why that's OK here ──
# Creating an API token via Terraform requires the PROVIDER's own token (the
# one behind $CLOUDFLARE_API_TOKEN when you run `terraform apply`) to hold the
# "Account -> API Tokens: Edit" permission — which can mint a token with ANY
# permissions on the account, not just R2. That's a categorically bigger risk
# than the one-bucket token it produces: if that bootstrap token leaks, an
# attacker could mint their own independent token before you even know to
# revoke yours.
#
# The mitigation is treating the bootstrap token as strictly single-use:
#   1. Create it (Account -> Workers R2 Storage: Edit + Account -> API Tokens: Edit)
#      immediately before running `terraform apply` (see infra/setup.sh).
#   2. Run `terraform apply`.
#   3. Revoke it immediately after, in the same sitting. Never leave it active.
# This is a deliberate trade-off, not an oversight: for a local, single-user
# credential typed into one terminal session, the realistic leak vector is
# "you paste it somewhere you shouldn't," which is equally (un)likely whether
# the token holds one extra permission or not — and letting Terraform manage
# this token removes a real, demonstrated source of error: manually clicking
# through the dashboard's permission/scope pickers is easy to get wrong (e.g.
# picking "Admin Read & Write" + "all buckets" instead of "Object Read &
# Write" scoped to just this bucket — Admin permissions are ALWAYS
# account-wide and can't be bucket-scoped, unlike Object permissions).
resource "cloudflare_account_token" "r2_media" {
  account_id = var.account_id
  name       = "social-cockpit-r2-media"

  policies = [
    {
      effect = "allow"
      # Object Read *and* Write: the app PUTs uploads and DELETEs after publish
      # (Write), and hands Instagram a presigned GET to fetch from (Read). Write
      # alone would 403 every Instagram fetch. See src/lib/storage/r2.ts.
      permission_groups = [
        { id = local.r2_permission_groups["Workers R2 Storage Bucket Item Read"] },
        { id = local.r2_permission_groups["Workers R2 Storage Bucket Item Write"] },
      ]
      # v5 provider: resources is a JSON-encoded string, not an HCL map.
      resources = jsonencode({
        "com.cloudflare.edge.r2.bucket.${var.account_id}_default_${cloudflare_r2_bucket.media.name}" = "*"
      })
    }
  ]
}

# Look up the permission-group IDs by name via the account endpoint
# (/accounts/{id}/tokens/permission_groups). The bootstrap token carries only
# Account-scoped permissions, so it can't authenticate against the /user/*
# endpoints at all ("Valid user-level authentication not found") — the account
# endpoint is the right one for it. Its "Account -> API Tokens: Edit" permission
# is what authorizes this read (without it you get 403 / code 9109
# "Unauthorized to access requested resource").
#
# Note the _list variant: the non-list data source returns a null
# `permission_groups` unless given a name/scope filter, whereas _list returns the
# full set under `result` (a list of { id, name, scopes }). We filter to just the
# two R2 groups so an unrelated duplicate name elsewhere can't collide the map
# key, then look each up by name below.
data "cloudflare_account_api_token_permission_groups_list" "all" {
  account_id = var.account_id
}

locals {
  r2_permission_groups = {
    for g in data.cloudflare_account_api_token_permission_groups_list.all.result :
    g.name => g.id
    if contains([
      "Workers R2 Storage Bucket Item Read",
      "Workers R2 Storage Bucket Item Write",
    ], g.name)
  }
}
