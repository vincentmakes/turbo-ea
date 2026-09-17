resource "google_project_service" "this" {
  for_each = var.enable_apis ? toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "file.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "servicenetworking.googleapis.com",
    "compute.googleapis.com",
  ]) : toset([])

  service            = each.value
  disable_on_destroy = false
}
