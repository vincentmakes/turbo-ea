# Cloud SQL for PostgreSQL with a private IP on the network
# (create_database = true). Private services access must exist on the VPC:
# create it here with create_private_service_connection when it does not.

resource "google_compute_global_address" "psa" {
  count = var.create_private_service_connection ? 1 : 0

  name          = "${var.name}-psa"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = var.psa_prefix_length
  network       = local.network_self_link

  depends_on = [google_project_service.this]
}

resource "google_service_networking_connection" "psa" {
  count = var.create_private_service_connection ? 1 : 0

  network                 = local.network_self_link
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.psa[0].name]
}

resource "google_sql_database_instance" "this" {
  count = var.create_database ? 1 : 0

  name                = local.cloudsql_instance_name
  region              = var.region
  database_version    = var.cloudsql_database_version
  deletion_protection = var.db_deletion_protection

  settings {
    tier              = var.cloudsql_tier
    edition           = var.cloudsql_edition
    availability_type = var.cloudsql_availability_type
    disk_size         = var.cloudsql_disk_size_gb
    disk_autoresize   = true
    user_labels       = var.labels

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true

      backup_retention_settings {
        retained_backups = var.db_backup_retention_days
      }
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = local.network_self_link
    }
  }

  depends_on = [google_project_service.this, google_service_networking_connection.psa]
}

resource "google_sql_database" "this" {
  count = var.create_database ? 1 : 0

  name     = var.db_name
  instance = google_sql_database_instance.this[0].name
}

resource "google_sql_user" "this" {
  count = var.create_database ? 1 : 0

  name     = var.db_user
  instance = google_sql_database_instance.this[0].name
  password = random_password.db[0].result
}
