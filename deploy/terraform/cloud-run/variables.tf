# ── Identity ───────────────────────────────────────────────────────────

variable "name" {
  description = "Name prefix for every resource (service, job, instance, secrets…)."
  type        = string
  default     = "turbo-ea"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.name))
    error_message = "name must be 2-31 characters of lowercase letters, digits and dashes, starting with a letter."
  }
}

variable "project_id" {
  description = "Google Cloud project to deploy into."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Cloud SQL, Filestore and Artifact Registry, e.g. europe-west1."
  type        = string
}

variable "labels" {
  description = "Labels applied to the labelled resources."
  type        = map(string)
  default     = {}
}

variable "enable_apis" {
  description = "Enable the required APIs (run, sqladmin, file, secretmanager, artifactregistry, servicenetworking, compute) on the project."
  type        = bool
  default     = true
}

# ── Application ────────────────────────────────────────────────────────

variable "public_url" {
  description = "Public origin users open, e.g. https://ea.example.com — no path, no trailing slash. Its host is the managed certificate's domain when the load balancer is created."
  type        = string

  validation {
    condition     = can(regex("^https?://[^/?#]+$", var.public_url))
    error_message = "public_url must be an origin such as https://ea.example.com (scheme and host only)."
  }
}

variable "image_tag" {
  description = "Turbo EA release to run (images, chart and docs share one version number). Required on purpose: never `latest`."
  type        = string

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$", var.image_tag))
    error_message = "image_tag must be a release version such as 2.141.0."
  }
}

variable "image_repository" {
  description = "Registry path the four images are pulled from. null = the Artifact Registry remote repository this module creates for ghcr.io (Cloud Run cannot pull from ghcr.io directly)."
  type        = string
  default     = null
}

variable "secret_key" {
  description = "HMAC + Fernet key (openssl rand -base64 48). Losing it invalidates every session and encrypted setting. Stored in Secret Manager."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.secret_key) >= 32
    error_message = "secret_key must be at least 32 characters (openssl rand -base64 48)."
  }
}

variable "deploy_mcp" {
  description = "Also run the MCP server sidecar at <public_url>/mcp."
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

variable "db_pool_size" {
  description = "Backend DB_POOL_SIZE. With db_max_overflow this is the backend's whole connection budget."
  type        = number
  default     = 10

  validation {
    condition     = var.db_pool_size > 0
    error_message = "db_pool_size must be positive."
  }
}

variable "db_max_overflow" {
  description = "Backend DB_MAX_OVERFLOW."
  type        = number
  default     = 5

  validation {
    condition     = var.db_max_overflow >= 0
    error_message = "db_max_overflow must be zero or positive."
  }
}

variable "launch_stage" {
  description = "Cloud Run launch stage override (e.g. BETA) should the API reject a feature at GA. null = default."
  type        = string
  default     = null
}

variable "deletion_protection" {
  description = "Refuse to destroy the Cloud Run service until this is switched off."
  type        = bool
  default     = true
}

variable "service_account_id" {
  description = "Account id of the service account the service runs as. null = <name>-run."
  type        = string
  default     = null
}

# ── Network (existing) ─────────────────────────────────────────────────

variable "network" {
  description = "Name of the VPC network for Direct VPC egress, Cloud SQL private IP and Filestore."
  type        = string
}

variable "subnetwork" {
  description = "Name of the subnet (in `region`) the service's network interface uses."
  type        = string
}

variable "network_project_id" {
  description = "Host project of a Shared VPC. null = the deployment project."
  type        = string
  default     = null
}

variable "create_private_service_connection" {
  description = "Reserve an internal range and create the private services access peering Cloud SQL needs. Leave false when the VPC already has one (a second peering fails)."
  type        = bool
  default     = false
}

variable "psa_prefix_length" {
  description = "Prefix length of the range reserved for private services access."
  type        = number
  default     = 16
}

# ── Registry ───────────────────────────────────────────────────────────

variable "create_artifact_registry" {
  description = "Create an Artifact Registry remote repository that proxies ghcr.io."
  type        = bool
  default     = true
}

variable "artifact_registry_repository_id" {
  description = "Repository id of the remote repository."
  type        = string
  default     = "ghcr"
}

# ── Storage (/app/data) ────────────────────────────────────────────────

variable "filestore_location" {
  description = "Zone (basic tiers) or region (zonal/regional tiers) of the Filestore instance. null = <region>-b."
  type        = string
  default     = null
}

variable "filestore_tier" {
  description = "Filestore service tier. BASIC_HDD is the cheapest tier with a 1 TiB minimum."
  type        = string
  default     = "BASIC_HDD"
}

variable "filestore_capacity_gb" {
  description = "Capacity of the file share, in GiB (tier minimums apply: 1024 for BASIC_HDD)."
  type        = number
  default     = 1024
}

variable "filestore_share_name" {
  description = "Name of the NFS export mounted at /app/data."
  type        = string
  default     = "share"
}

variable "filestore_connect_mode" {
  description = "DIRECT_PEERING, or PRIVATE_SERVICE_ACCESS on a Shared VPC."
  type        = string
  default     = "DIRECT_PEERING"

  validation {
    condition     = contains(["DIRECT_PEERING", "PRIVATE_SERVICE_ACCESS"], var.filestore_connect_mode)
    error_message = "filestore_connect_mode must be DIRECT_PEERING or PRIVATE_SERVICE_ACCESS."
  }
}

variable "run_chown_job" {
  description = "Run a one-off Cloud Run job that makes the share owned by uid/gid 1000 before the service starts."
  type        = bool
  default     = true
}

variable "chown_job_token" {
  description = "Change this value to run the chown job again (e.g. after restoring the share from a backup)."
  type        = string
  default     = "1"
}

variable "chown_image" {
  description = "Image the chown job runs (needs chown). Override when Docker Hub pulls are blocked by policy."
  type        = string
  default     = "docker.io/library/alpine:3.21"
}

# ── Load balancer ──────────────────────────────────────────────────────

variable "create_load_balancer" {
  description = "Create a global external HTTPS load balancer with a Google-managed certificate for the host of public_url, and restrict the service's ingress to it."
  type        = bool
  default     = true
}

# ── Database ───────────────────────────────────────────────────────────

variable "create_database" {
  description = "Create a Cloud SQL for PostgreSQL instance with a private IP on the network. false = bring your own (set db_host and db_password)."
  type        = bool
  default     = true
}

variable "db_host" {
  description = "Address of an existing PostgreSQL server reachable from the network. Required when create_database = false."
  type        = string
  default     = null

  validation {
    condition     = var.create_database || (var.db_host != null && var.db_host != "")
    error_message = "db_host is required when create_database is false."
  }
}

variable "db_password" {
  description = "Password of the existing PostgreSQL user. Required when create_database = false; generated otherwise."
  type        = string
  sensitive   = true
  default     = null

  validation {
    condition     = var.create_database || (var.db_password != null && var.db_password != "")
    error_message = "db_password is required when create_database is false."
  }
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

variable "cloudsql_instance_name" {
  description = "Name of the created Cloud SQL instance (a deleted name cannot be reused for a week). null = <name>-db."
  type        = string
  default     = null
}

variable "cloudsql_tier" {
  description = "Machine tier of the created Cloud SQL instance."
  type        = string
  default     = "db-custom-1-3840"
}

variable "cloudsql_database_version" {
  description = "PostgreSQL version of the created Cloud SQL instance."
  type        = string
  default     = "POSTGRES_17"
}

variable "cloudsql_edition" {
  description = "ENTERPRISE or ENTERPRISE_PLUS (the latter refuses shared-core and small custom tiers)."
  type        = string
  default     = "ENTERPRISE"
}

variable "cloudsql_availability_type" {
  description = "ZONAL or REGIONAL (high availability)."
  type        = string
  default     = "ZONAL"
}

variable "cloudsql_disk_size_gb" {
  description = "Initial disk size of the created Cloud SQL instance, in GiB (auto-resize is on)."
  type        = number
  default     = 20
}

variable "db_backup_retention_days" {
  description = "Number of automated backups kept for the created Cloud SQL instance."
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "Refuse to destroy the created Cloud SQL instance until this is switched off."
  type        = bool
  default     = true
}
