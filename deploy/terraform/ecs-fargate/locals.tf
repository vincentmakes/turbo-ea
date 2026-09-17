locals {
  public_host = regex("^https?://([^/:]+)", var.public_url)[0]
  images = {
    for c in ["backend", "frontend", "nginx", "mcp-server"] :
    c => "${var.image_repository}/${c}:${var.image_tag}"
  }

  db_host     = var.create_database ? aws_db_instance.this[0].address : var.db_host
  db_password = var.create_database ? random_password.db[0].result : var.db_password

  # Environment of each sidecar, identical to deploy/ecs-fargate/template.yaml.
  backend_env = {
    POSTGRES_HOST           = local.db_host
    POSTGRES_PORT           = tostring(var.db_port)
    POSTGRES_DB             = var.db_name
    POSTGRES_USER           = var.db_user
    ENVIRONMENT             = "production"
    ALLOWED_ORIGINS         = join(",", coalescelist(var.allowed_origins, [var.public_url]))
    DB_POOL_SIZE            = tostring(var.db_pool_size)
    DB_MAX_OVERFLOW         = tostring(var.db_max_overflow)
    SEED_DEMO               = "false"
    HOME                    = "/tmp"
    PYTHONDONTWRITEBYTECODE = "1"
  }

  nginx_env = {
    TURBO_EA_PUBLIC_URL = var.public_url
    # TLS terminates on the load balancer; the https:// public URL is what
    # marks the session cookie secure.
    TURBO_EA_TLS_ENABLED           = "false"
    TURBO_EA_EMBED_ALLOWED_ORIGINS = join(",", var.embed_allowed_origins)
    # The frontend sidecar owns 8080 in this task, so the edge listens on 8920.
    NGINX_HTTP_PORT         = "8920"
    NGINX_BACKEND_UPSTREAM  = "http://127.0.0.1:8000"
    NGINX_FRONTEND_UPSTREAM = "http://127.0.0.1:8080"
    NGINX_MCP_UPSTREAM      = "http://127.0.0.1:8001"
  }

  mcp_env = {
    TURBO_EA_URL        = "http://127.0.0.1:8000"
    TURBO_EA_PUBLIC_URL = var.public_url
    MCP_PUBLIC_URL      = "${var.public_url}/mcp"
    MCP_PORT            = "8001"
    HOME                = "/tmp"
  }
}
