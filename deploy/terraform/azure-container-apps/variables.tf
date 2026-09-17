# ── Identity ───────────────────────────────────────────────────────────

variable "name" {
  description = "Name prefix for every resource (environment, container app, workspace, server…)."
  type        = string
  default     = "turbo-ea"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.name))
    error_message = "name must be 2-31 characters of lowercase letters, digits and dashes, starting with a letter."
  }
}

variable "subscription_id" {
  description = "Azure subscription to deploy into."
  type        = string
}

variable "resource_group_name" {
  description = "Existing resource group every resource is created in."
  type        = string
}

variable "location" {
  description = "Azure region, e.g. westeurope."
  type        = string
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}

# ── Application ────────────────────────────────────────────────────────

variable "public_url" {
  description = "Public origin users open, e.g. https://ea.example.com — no path, no trailing slash. Use https://<fqdn output> on the first deploy, then switch to the custom domain."
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
  description = "Registry path the four images are pulled from."
  type        = string
  default     = "ghcr.io/vincentmakes/turbo-ea"
}

variable "secret_key" {
  description = "HMAC + Fernet key (openssl rand -base64 48). Losing it invalidates every session and encrypted setting. Stored as a Container Apps secret."
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

variable "log_retention_days" {
  description = "Log Analytics retention for the container logs."
  type        = number
  default     = 30
}

# ── Network (existing) ─────────────────────────────────────────────────

variable "infrastructure_subnet_id" {
  description = "Resource ID of a /27 (or larger) subnet delegated to Microsoft.App/environments for VNet integration. null = no VNet integration; the database must then be reachable over its public endpoint."
  type        = string
  default     = null
}

variable "postgresql_delegated_subnet_id" {
  description = "Resource ID of a subnet delegated to Microsoft.DBforPostgreSQL/flexibleServers (private access). Must differ from infrastructure_subnet_id. Requires postgresql_private_dns_zone_id."
  type        = string
  default     = null

  validation {
    condition     = (var.postgresql_delegated_subnet_id == null) == (var.postgresql_private_dns_zone_id == null)
    error_message = "postgresql_delegated_subnet_id and postgresql_private_dns_zone_id must be set together (private access) or both left null (public endpoint)."
  }
}

variable "postgresql_private_dns_zone_id" {
  description = "Resource ID of a private DNS zone ending in .postgres.database.azure.com, linked to the VNet. Set together with postgresql_delegated_subnet_id."
  type        = string
  default     = null
}

# ── Storage (/app/data) ────────────────────────────────────────────────

variable "storage_account_name" {
  description = "Globally unique storage account name for the file share behind /app/data. null = derived from name."
  type        = string
  default     = null

  validation {
    condition     = var.storage_account_name == null || can(regex("^[a-z0-9]{3,24}$", coalesce(var.storage_account_name, "x")))
    error_message = "storage_account_name must be 3-24 lowercase letters and digits."
  }
}

variable "file_share_name" {
  description = "Azure Files share mounted at /app/data (installed extensions, uploads, transfer bundles)."
  type        = string
  default     = "turbo-ea-data"
}

variable "storage_deletion_protection" {
  description = "Put a CanNotDelete lock on the storage account holding /app/data."
  type        = bool
  default     = true
}

variable "file_share_quota_gb" {
  description = "Size of the file share, in GiB."
  type        = number
  default     = 50
}

# ── Database ───────────────────────────────────────────────────────────

variable "create_database" {
  description = "Create an Azure Database for PostgreSQL Flexible Server. false = bring your own (set db_host and db_password)."
  type        = bool
  default     = true
}

variable "db_host" {
  description = "FQDN of an existing PostgreSQL server. Required when create_database = false."
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
  description = "Database user (the administrator login of the created server)."
  type        = string
  default     = "turboea"
}

variable "postgresql_server_name" {
  description = "Globally unique name of the created Flexible Server. null = <name>-pg."
  type        = string
  default     = null
}

variable "postgresql_sku_name" {
  description = "SKU of the created Flexible Server (tier_size, e.g. B_Standard_B1ms, GP_Standard_D2s_v3)."
  type        = string
  default     = "B_Standard_B1ms"
}

variable "postgresql_version" {
  description = "PostgreSQL major version of the created Flexible Server."
  type        = string
  default     = "16"

  validation {
    condition     = contains(["13", "14", "15", "16", "17", "18"], var.postgresql_version)
    error_message = "postgresql_version must be one of 13, 14, 15, 16, 17, 18."
  }
}

variable "postgresql_storage_mb" {
  description = "Storage of the created Flexible Server, in MB (32768, 65536, 131072, 262144, 524288, …). Shrinking forces a replacement."
  type        = number
  default     = 32768
}

variable "postgresql_zone" {
  description = "Availability zone of the created Flexible Server (1, 2, 3). null = let Azure choose."
  type        = string
  default     = null
}

variable "db_deletion_protection" {
  description = "Put a CanNotDelete lock on the created Flexible Server so nothing but Terraform (which removes the lock first) can delete it."
  type        = bool
  default     = true
}

variable "db_backup_retention_days" {
  description = "Backup retention of the created Flexible Server, in days (7-35)."
  type        = number
  default     = 7

  validation {
    condition     = var.db_backup_retention_days >= 7 && var.db_backup_retention_days <= 35
    error_message = "db_backup_retention_days must be between 7 and 35."
  }
}
