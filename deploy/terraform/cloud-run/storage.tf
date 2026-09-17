# Persistent /app/data: Filestore over NFS is the only fully POSIX, persistent
# option on Cloud Run. The share must be owned by 1000:1000 (the user every
# Turbo EA image runs as), which the one-off job below takes care of.

resource "google_filestore_instance" "data" {
  name     = "${var.name}-data"
  location = local.filestore_location
  tier     = var.filestore_tier
  labels   = var.labels

  file_shares {
    name        = var.filestore_share_name
    capacity_gb = var.filestore_capacity_gb
  }

  networks {
    network      = var.network
    modes        = ["MODE_IPV4"]
    connect_mode = var.filestore_connect_mode
  }

  depends_on = [google_project_service.this]
}

# Executed on every apply whose chown_job_token changed; the resource is only
# ready once the execution completed, so the service waits for it.
resource "google_cloud_run_v2_job" "chown" {
  count = var.run_chown_job ? 1 : 0

  name                = "${var.name}-chown"
  location            = var.region
  deletion_protection = false
  run_execution_token = var.chown_job_token
  labels              = var.labels

  template {
    template {
      service_account       = google_service_account.run.email
      execution_environment = "EXECUTION_ENVIRONMENT_GEN2"
      max_retries           = 1

      containers {
        image   = var.chown_image
        command = ["chown"]
        args    = ["-R", "1000:1000", "/data"]

        volume_mounts {
          name       = "data"
          mount_path = "/data"
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

      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"

        network_interfaces {
          network    = var.network
          subnetwork = var.subnetwork
        }
      }
    }
  }

  depends_on = [google_project_service.this]
}
