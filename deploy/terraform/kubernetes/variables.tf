# ── Cluster access ─────────────────────────────────────────────────────

variable "kubeconfig_path" {
  description = "Path of the kubeconfig both providers read."
  type        = string
  default     = "~/.kube/config"
}

variable "kubeconfig_context" {
  description = "Context inside the kubeconfig. null = the current context."
  type        = string
  default     = null
}

# ── Release ────────────────────────────────────────────────────────────

variable "namespace" {
  description = "Namespace the release is installed into."
  type        = string
  default     = "turbo-ea"
}

variable "create_namespace" {
  description = "Create the namespace. false = it already exists."
  type        = bool
  default     = true
}

variable "release_name" {
  description = "Helm release name; also the prefix of every Kubernetes object the chart creates."
  type        = string
  default     = "turbo-ea"
}

variable "chart_repository" {
  description = "OCI registry the chart is pulled from."
  type        = string
  default     = "oci://ghcr.io/vincentmakes/turbo-ea/charts"
}

variable "chart_version" {
  description = "Chart version to install. Chart, images and docs share one version number. Required on purpose: never `latest`."
  type        = string

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$", var.chart_version))
    error_message = "chart_version must be a release version such as 2.141.0."
  }
}

variable "image_tag" {
  description = "Image tag override. null = the chart's appVersion, which is the same number as chart_version."
  type        = string
  default     = null
}

variable "helm_wait" {
  description = "Wait until every workload is ready before returning."
  type        = bool
  default     = true
}

variable "helm_timeout" {
  description = "Seconds to wait for the release (the backend runs migrations at first boot)."
  type        = number
  default     = 720
}

variable "helm_atomic" {
  description = "Roll the release back when the install or upgrade fails."
  type        = bool
  default     = false
}

variable "extra_values" {
  description = "Extra values documents (YAML strings) merged after the generated one — later documents win."
  type        = list(string)
  default     = []
}

# ── Application ────────────────────────────────────────────────────────

variable "public_url" {
  description = "Public origin users open, e.g. https://ea.example.com — no path, no trailing slash."
  type        = string

  validation {
    condition     = can(regex("^https?://[^/?#]+$", var.public_url))
    error_message = "public_url must be an origin such as https://ea.example.com (scheme and host only)."
  }
}

variable "deploy_mcp" {
  description = "Also run the MCP server at <public_url>/mcp."
  type        = bool
  default     = false
}

variable "allowed_origins" {
  description = "CORS allow-list. Empty = the origin of public_url."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for o in var.allowed_origins : can(regex("^https?://", o))])
    error_message = "Every allowed origin must start with http:// or https://."
  }
}

variable "embed_allowed_origins" {
  description = "Sites allowed to embed published diagrams in an iframe. Empty = embedding off."
  type        = list(string)
  default     = []
}

# ── Secrets ────────────────────────────────────────────────────────────

variable "existing_secret" {
  description = "Name of an existing Secret in the namespace carrying SECRET_KEY and POSTGRES_PASSWORD (External Secrets, Sealed Secrets…). Empty = this module creates one from secret_key and db_password."
  type        = string
  default     = ""
}

variable "existing_secret_keys" {
  description = "Key names inside the Secret."
  type = object({
    secret_key        = optional(string, "SECRET_KEY")
    postgres_password = optional(string, "POSTGRES_PASSWORD")
  })
  default = {}
}

variable "secret_key" {
  description = "HMAC + Fernet key (openssl rand -base64 48). Required unless existing_secret is set."
  type        = string
  sensitive   = true
  default     = null

  validation {
    condition     = var.existing_secret != "" || (var.secret_key != null && length(coalesce(var.secret_key, "")) >= 32)
    error_message = "secret_key (at least 32 characters) is required unless existing_secret is set."
  }
}

variable "db_password" {
  description = "PostgreSQL password. Required unless existing_secret is set."
  type        = string
  sensitive   = true
  default     = null

  validation {
    condition     = var.existing_secret != "" || (var.db_password != null && var.db_password != "")
    error_message = "db_password is required unless existing_secret is set."
  }
}

# ── Database (external) ────────────────────────────────────────────────

variable "db_host" {
  description = "Hostname of the PostgreSQL server (a managed instance's private endpoint)."
  type        = string
}

variable "db_port" {
  description = "PostgreSQL port."
  type        = number
  default     = 5432
}

variable "db_name" {
  description = "Database name."
  type        = string
  default     = "turboea"
}

variable "db_user" {
  description = "Database user."
  type        = string
  default     = "turboea"
}

variable "db_pool_size" {
  description = "Backend DB_POOL_SIZE (chart default)."
  type        = number
  default     = 20
}

variable "db_max_overflow" {
  description = "Backend DB_MAX_OVERFLOW (chart default)."
  type        = number
  default     = 10
}

# ── Storage and ingress ────────────────────────────────────────────────

variable "storage_class" {
  description = "StorageClass of the backend's data volume. Empty = the cluster default."
  type        = string
  default     = ""
}

variable "storage_size" {
  description = "Size of the backend's data volume."
  type        = string
  default     = "10Gi"
}

variable "existing_claim" {
  description = "Use an existing PersistentVolumeClaim for /app/data instead of creating one."
  type        = string
  default     = ""
}

variable "ingress" {
  description = "Ingress settings passed to the chart. Empty hosts = one rule for the host of public_url. See the chart's values.yaml for the per-controller annotations (body size, read timeout)."
  type = object({
    enabled     = optional(bool, false)
    class_name  = optional(string, "")
    annotations = optional(map(string), {})
    hosts = optional(list(object({
      host = string
      paths = optional(list(object({
        path      = string
        path_type = optional(string, "Prefix")
      })), [{ path = "/" }])
    })), [])
    tls = optional(list(object({
      secret_name = string
      hosts       = list(string)
    })), [])
  })
  default = {}
}
