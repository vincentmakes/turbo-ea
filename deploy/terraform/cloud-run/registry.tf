# Cloud Run cannot pull from ghcr.io directly; a remote repository proxies it.
resource "google_artifact_registry_repository" "ghcr" {
  count = var.create_artifact_registry ? 1 : 0

  location      = var.region
  repository_id = var.artifact_registry_repository_id
  description   = "Proxy for ghcr.io (Turbo EA images)"
  format        = "DOCKER"
  mode          = "REMOTE_REPOSITORY"
  labels        = var.labels

  remote_repository_config {
    description                 = "ghcr.io"
    disable_upstream_validation = true

    docker_repository {
      custom_repository {
        uri = "https://ghcr.io"
      }
    }
  }

  depends_on = [google_project_service.this]
}
