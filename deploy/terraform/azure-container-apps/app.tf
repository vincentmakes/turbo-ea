# One container app runs the whole stack as sidecars sharing localhost: the
# edge nginx (ingress, port 8920) in front of the frontend (8080), the backend
# (8000) and the optional MCP server (8001). The backend is ONE replica, never
# scaled and never scaled to zero: it holds in-process state and runs
# migrations at boot. During an update Container Apps briefly runs the old and
# the new replica side by side; the backend's PostgreSQL advisory lock keeps
# the two from migrating at once.

resource "azurerm_container_app" "this" {
  name                         = var.name
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.this.id
  workload_profile_name        = "Consumption"
  tags                         = var.tags

  # Single = zero-downtime updates, which means the old and new replica
  # overlap for a moment. For strict stop-then-start semantics switch to
  # Multiple and deactivate the old revision before updating (see the guide).
  revision_mode = "Single"

  ingress {
    external_enabled           = true
    target_port                = 8920
    transport                  = "auto"
    allow_insecure_connections = false

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  secret {
    name  = "secret-key"
    value = var.secret_key
  }

  secret {
    name  = "postgres-password"
    value = local.db_password
  }
  # Key Vault alternative: replace `value` with `key_vault_secret_id` +
  # `identity = "System"` and add an identity block with "Key Vault Secrets
  # User" on the vault.

  template {
    min_replicas = 1
    max_replicas = 1

    container {
      name   = "backend"
      image  = local.images["backend"]
      cpu    = 1.0
      memory = "2Gi"

      dynamic "env" {
        for_each = local.backend_env
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name        = "POSTGRES_PASSWORD"
        secret_name = "postgres-password"
      }

      env {
        name        = "SECRET_KEY"
        secret_name = "secret-key"
      }

      volume_mounts {
        name = "data"
        path = "/app/data"
      }

      # Migrations and seeding run before /api/health answers. Container Apps
      # caps the startup failure threshold at 10, so a 30 s period gives a
      # 5-minute budget.
      startup_probe {
        transport               = "HTTP"
        port                    = 8000
        path                    = "/api/health"
        interval_seconds        = 30
        failure_count_threshold = 10
        timeout                 = 5
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = 8000
        path                    = "/api/health"
        interval_seconds        = 10
        failure_count_threshold = 3
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = 8000
        path                    = "/api/health"
        interval_seconds        = 30
        failure_count_threshold = 3
      }
    }

    container {
      name   = "frontend"
      image  = local.images["frontend"]
      cpu    = 0.25
      memory = "0.5Gi"

      startup_probe {
        transport               = "TCP"
        port                    = 8080
        interval_seconds        = 5
        failure_count_threshold = 10
      }

      liveness_probe {
        transport               = "TCP"
        port                    = 8080
        interval_seconds        = 30
        failure_count_threshold = 3
      }
    }

    container {
      name   = "nginx"
      image  = local.images["nginx"]
      cpu    = 0.25
      memory = "0.5Gi"

      dynamic "env" {
        for_each = local.nginx_env
        content {
          name  = env.key
          value = env.value
        }
      }

      # Through the proxy to the backend, so "ready" means the app answers.
      startup_probe {
        transport               = "HTTP"
        port                    = 8920
        path                    = "/api/health"
        interval_seconds        = 30
        failure_count_threshold = 10
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = 8920
        path                    = "/api/health"
        interval_seconds        = 10
        failure_count_threshold = 3
      }

      liveness_probe {
        transport               = "TCP"
        port                    = 8920
        interval_seconds        = 30
        failure_count_threshold = 3
      }
    }

    dynamic "container" {
      for_each = var.deploy_mcp ? [1] : []
      content {
        name   = "mcp-server"
        image  = local.images["mcp-server"]
        cpu    = 0.5
        memory = "1Gi"

        dynamic "env" {
          for_each = local.mcp_env
          content {
            name  = env.key
            value = env.value
          }
        }

        startup_probe {
          transport               = "HTTP"
          port                    = 8001
          path                    = "/health"
          interval_seconds        = 5
          failure_count_threshold = 10
        }

        liveness_probe {
          transport               = "HTTP"
          port                    = 8001
          path                    = "/health"
          interval_seconds        = 30
          failure_count_threshold = 3
        }
      }
    }

    volume {
      name          = "data"
      storage_type  = "AzureFile"
      storage_name  = azurerm_container_app_environment_storage.data.name
      mount_options = "dir_mode=0777,file_mode=0777,uid=1000,gid=1000,mfsymlinks,nobrl,cache=none"
    }
  }
}
