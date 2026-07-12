variable "account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "bucket_name" {
  description = "R2 bucket name for published media"
  type        = string
  default     = "social-cockpit-media"
}

variable "cap_bytes" {
  description = "Soft storage cap enforced by the app's usage gate (informational here; the real cap lives in R2_CAP_BYTES)"
  type        = number
  default     = 8589934592 # 8 GiB
}

variable "allowed_origin" {
  description = "Origin allowed to PUT directly to the bucket via CORS"
  type        = string
  default     = "http://localhost:3000"
}

variable "object_ttl_days" {
  description = "Lifecycle expiry for publish/ objects, as a crash-orphan backstop"
  type        = number
  default     = 1
}
