# One Cloud Run service runs the whole stack as sidecars sharing localhost:
# the edge nginx (ingress container, port 8920) in front of the frontend
# (8080), the backend (8000) and the optional MCP server (8001). The backend
# is ONE instance, never scaled and never scaled to zero (min = max = 1, CPU
# always allocated): it holds in-process state and runs migrations at boot. A
# new revision briefly overlaps the old one; the backend's PostgreSQL advisory
# lock keeps the two from migrating at once.

resource "google_cloud_run_v2_service" "this" {
  name                = var.name
  location            = var.region
  ingress             = var.create_load_balancer ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"
  launch_stage        = var.launch_stage
  deletion_protection = var.deletion_protection
  labels              = var.labels

  template {
    service_account       = google_service_account.run.email
    execution_environment = "EXECUTION_ENVIRONMENT_GEN2"
    # Maximum Cloud Run allows; the event stream reconnects when it expires.
    timeout                          = "3600s"
    max_instance_request_concurrency = 200

    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    # Direct VPC egress: reach Cloud SQL (private IP) and Filestore.
    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"

      network_interfaces {
        network    = var.network
        subnetwork = var.subnetwork
      }
    }

    # The only container with a port: Cloud Run routes ingress to it, and it
    # starts only once the backend and frontend pass their startup probes.
    containers {
      name       = "nginx"
      image      = local.images["nginx"]
      depends_on = concat(["backend", "frontend"], var.deploy_mcp ? ["mcp-server"] : [])

      ports {
        name           = "http1"
        container_port = 8920
      }

      dynamic "env" {
        for_each = local.nginx_env
        content {
          name  = env.key
          value = env.value
        }
      }

      resources {
        limits            = { cpu = "0.5", memory = "512Mi" }
        cpu_idle          = false
        startup_cpu_boost = true
      }

      # Through the proxy to the backend, so "started" means the app answers.
      startup_probe {
        period_seconds    = 5
        failure_threshold = 30
        timeout_seconds   = 5

        http_get {
          path = "/api/health"
          port = 8920
        }
      }
    }

    containers {
      name  = "backend"
      image = local.images["backend"]

      dynamic "env" {
        for_each = local.backend_env
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name = "POSTGRES_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_password.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secret_key.secret_id
            version = "latest"
          }
        }
      }

      resources {
        limits            = { cpu = "1", memory = "2Gi" }
        cpu_idle          = false
        startup_cpu_boost = true
      }

      volume_mounts {
        name       = "data"
        mount_path = "/app/data"
      }

      # Migrations and seeding run before /api/health answers: 5 × 48 = 240 s,
      # exactly the Cloud Run maximum.
      startup_probe {
        period_seconds    = 5
        failure_threshold = 48
        timeout_seconds   = 5

        http_get {
          path = "/api/health"
          port = 8000
        }
      }

      liveness_probe {
        period_seconds    = 30
        failure_threshold = 3

        http_get {
          path = "/api/health"
          port = 8000
        }
      }
    }

    containers {
      name  = "frontend"
      image = local.images["frontend"]

      resources {
        limits            = { cpu = "0.5", memory = "512Mi" }
        cpu_idle          = false
        startup_cpu_boost = true
      }

      startup_probe {
        period_seconds    = 5
        failure_threshold = 12

        tcp_socket {
          port = 8080
        }
      }
    }

    dynamic "containers" {
      for_each = var.deploy_mcp ? [1] : []
      content {
        name       = "mcp-server"
        image      = local.images["mcp-server"]
        depends_on = ["backend"]

        dynamic "env" {
          for_each = local.mcp_env
          content {
            name  = env.key
            value = env.value
          }
        }

        resources {
          limits            = { cpu = "0.5", memory = "1Gi" }
          cpu_idle          = false
          startup_cpu_boost = true
        }

        startup_probe {
          period_seconds    = 5
          failure_threshold = 12

          http_get {
            path = "/health"
            port = 8001
          }
        }
      }
    }

    volumes {
      name = "data"

      nfs {
        server    = local.filestore_ip
        path      = local.filestore_path
        read_only = false
      }
    }
  }

  depends_on = [
    google_project_service.this,
    google_cloud_run_v2_job.chown,
    google_secret_manager_secret_version.secret_key,
    google_secret_manager_secret_version.db_password,
    google_secret_manager_secret_iam_member.secret_key,
    google_secret_manager_secret_iam_member.db_password,
    google_artifact_registry_repository.ghcr,
  ]
}

# The load balancer (or the run.app URL) forwards unauthenticated traffic;
# Turbo EA does its own sign-in.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.this.name
  location = google_cloud_run_v2_service.this.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
