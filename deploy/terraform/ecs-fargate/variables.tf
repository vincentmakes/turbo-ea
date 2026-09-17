# ── Identity ───────────────────────────────────────────────────────────

variable "name" {
  description = "Name prefix for every resource (cluster, service, load balancer, secrets…)."
  type        = string
  default     = "turbo-ea"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.name))
    error_message = "name must be 2-31 characters of lowercase letters, digits and dashes, starting with a letter."
  }
}

variable "region" {
  description = "AWS Region to deploy into (also used for the CloudWatch log driver)."
  type        = string
}

variable "tags" {
  description = "Extra tags applied to every resource through the provider's default_tags."
  type        = map(string)
  default     = {}
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
  description = "HMAC + Fernet key (openssl rand -base64 48). Losing it invalidates every session and encrypted setting. Stored in Secrets Manager."
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
  description = "CloudWatch Logs retention for the container logs."
  type        = number
  default     = 30
}

variable "container_insights" {
  description = "Enable CloudWatch Container Insights on the cluster."
  type        = bool
  default     = true
}

# ── Network (existing) ─────────────────────────────────────────────────

variable "vpc_id" {
  description = "VPC the load balancer, the task, the EFS mount targets and the database live in."
  type        = string

  validation {
    condition     = can(regex("^vpc-", var.vpc_id))
    error_message = "vpc_id must be a VPC id (vpc-…)."
  }
}

variable "public_subnet_ids" {
  description = "Two or more public subnets for the load balancer."
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_ids) >= 2
    error_message = "An Application Load Balancer needs at least two public subnets in different Availability Zones."
  }
}

variable "private_subnet_ids" {
  description = "Two or more private subnets (with a NAT gateway for image pulls) for the task, the EFS mount targets and the database."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "Two private subnets in different Availability Zones are required (EFS mount targets, RDS subnet group)."
  }
}

variable "certificate_arn" {
  description = "ACM certificate for the public hostname, in the same Region as the load balancer."
  type        = string

  validation {
    condition     = can(regex("^arn:aws[a-z-]*:acm:", var.certificate_arn))
    error_message = "certificate_arn must be an ACM certificate ARN."
  }
}

variable "route53_zone_id" {
  description = "Optional Route 53 hosted zone: when set, an alias record for the host of public_url points at the load balancer."
  type        = string
  default     = null
}

# ── Database ───────────────────────────────────────────────────────────

variable "create_database" {
  description = "Create an RDS for PostgreSQL instance in the private subnets. false = bring your own (set db_host and db_password)."
  type        = bool
  default     = true
}

variable "db_host" {
  description = "Hostname of an existing PostgreSQL server. Required when create_database = false."
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

variable "db_security_group_id" {
  description = "Security group of an existing database. When set, its port is opened from the task security group. Empty = manage that rule yourself with the task_security_group_id output."
  type        = string
  default     = null
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

variable "db_instance_class" {
  description = "RDS instance class when create_database is true."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_engine_version" {
  description = "PostgreSQL major version for the created RDS instance (minor upgrades are automatic)."
  type        = string
  default     = "17"
}

variable "db_allocated_storage" {
  description = "Storage of the created RDS instance, in GiB."
  type        = number
  default     = 20
}

variable "db_multi_az" {
  description = "Multi-AZ standby for the created RDS instance."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "Automated backup retention of the created RDS instance, in days."
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "Refuse to destroy the created RDS instance until this is switched off."
  type        = bool
  default     = true
}

variable "db_skip_final_snapshot" {
  description = "Skip the final snapshot when the created RDS instance is destroyed."
  type        = bool
  default     = false
}
