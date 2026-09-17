# The module always owns the two Secret Manager secrets the service reads —
# whether the database was created here or brought along — so the service has
# one shape.

resource "random_password" "db" {
  count = var.create_database ? 1 : 0

  length           = 32
  override_special = "!#$%^&*()-_=+"
}

resource "google_secret_manager_secret" "secret_key" {
  secret_id = "${var.name}-secret-key"
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.this]
}

resource "google_secret_manager_secret_version" "secret_key" {
  secret      = google_secret_manager_secret.secret_key.id
  secret_data = var.secret_key
}

resource "google_secret_manager_secret" "db_password" {
  secret_id = "${var.name}-postgres-password"
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.this]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = local.db_password
}

resource "google_service_account" "run" {
  account_id   = local.service_account_id
  display_name = "Turbo EA (${var.name})"
}

resource "google_secret_manager_secret_iam_member" "secret_key" {
  secret_id = google_secret_manager_secret.secret_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

resource "google_secret_manager_secret_iam_member" "db_password" {
  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}
