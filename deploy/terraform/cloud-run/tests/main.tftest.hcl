# Offline tests: the google provider is mocked (real schema, invented values),
# so these prove the wiring the guide depends on — one instance with CPU
# always allocated, the edge on 8920, secrets by reference, the NFS volume —
# not that Google Cloud would accept the plan.

mock_provider "google" {
  # Nested computed lists come back empty from a mock; the module indexes
  # into these two.
  mock_resource "google_filestore_instance" {
    defaults = { networks = { ip_addresses = ["10.10.0.2"] } }
  }
  mock_resource "google_sql_database_instance" {
    defaults = { private_ip_address = "10.20.0.3" }
  }
  mock_resource "google_service_account" {
    defaults = { email = "turbo-ea-run@my-project.iam.gserviceaccount.com" }
  }
}

variables {
  project_id = "my-project"
  region     = "europe-west1"
  public_url = "https://ea.example.com"
  image_tag  = "2.141.0"
  secret_key = "0123456789abcdef0123456789abcdef0123456789abcdef"
  network    = "vpc"
  subnetwork = "subnet"
}

run "defaults" {
  assert {
    condition     = length(google_sql_database_instance.this) == 1 && length(google_service_networking_connection.psa) == 0
    error_message = "the database is created by default, private services access is not"
  }

  assert {
    condition     = google_sql_database_instance.this[0].settings[0].ip_configuration[0].ipv4_enabled == false
    error_message = "the instance has no public IP"
  }

  assert {
    condition     = google_cloud_run_v2_service.this.template[0].scaling[0].min_instance_count == 1 && google_cloud_run_v2_service.this.template[0].scaling[0].max_instance_count == 1
    error_message = "exactly one instance, never scaled to zero"
  }

  assert {
    condition     = alltrue([for c in google_cloud_run_v2_service.this.template[0].containers : c.resources[0].cpu_idle == false])
    error_message = "CPU stays allocated between requests"
  }

  assert {
    condition     = google_cloud_run_v2_service.this.template[0].timeout == "3600s" && google_cloud_run_v2_service.this.template[0].execution_environment == "EXECUTION_ENVIRONMENT_GEN2"
    error_message = "maximum request timeout on the gen2 environment"
  }

  assert {
    condition     = [for c in google_cloud_run_v2_service.this.template[0].containers : c.name if length(c.ports) > 0] == ["nginx"]
    error_message = "only the edge nginx declares a port"
  }

  assert {
    condition     = [for c in google_cloud_run_v2_service.this.template[0].containers : c.ports[0].container_port if c.name == "nginx"][0] == 8920
    error_message = "the edge nginx listens on 8920"
  }

  assert {
    condition     = [for c in google_cloud_run_v2_service.this.template[0].containers : c.depends_on if c.name == "nginx"][0] == tolist(["backend", "frontend"])
    error_message = "nginx starts only once the backend and the frontend are up"
  }

  assert {
    condition = {
      for e in [for c in google_cloud_run_v2_service.this.template[0].containers : c.env if c.name == "nginx"][0] : e.name => e.value
      } == {
      NGINX_HTTP_PORT                = "8920"
      NGINX_BACKEND_UPSTREAM         = "http://127.0.0.1:8000"
      NGINX_FRONTEND_UPSTREAM        = "http://127.0.0.1:8080"
      NGINX_MCP_UPSTREAM             = "http://127.0.0.1:8001"
      TURBO_EA_TLS_ENABLED           = "false"
      TURBO_EA_PUBLIC_URL            = "https://ea.example.com"
      TURBO_EA_EMBED_ALLOWED_ORIGINS = ""
    }
    error_message = "the edge nginx environment must match deploy/cloud-run/service.yaml"
  }

  assert {
    condition = {
      for e in [for c in google_cloud_run_v2_service.this.template[0].containers : c.env if c.name == "backend"][0] : e.name => e.value if length(e.value_source) == 0
    }["POSTGRES_HOST"] == "10.20.0.3"
    error_message = "the backend points at the created instance's private IP"
  }

  assert {
    condition = {
      for e in [for c in google_cloud_run_v2_service.this.template[0].containers : c.env if c.name == "backend"][0] : e.name => e.value_source[0].secret_key_ref[0].secret if length(e.value_source) > 0
    } == { POSTGRES_PASSWORD = google_secret_manager_secret.db_password.secret_id, SECRET_KEY = google_secret_manager_secret.secret_key.secret_id }
    error_message = "the backend reads both secrets from Secret Manager"
  }

  assert {
    condition     = [for c in google_cloud_run_v2_service.this.template[0].containers : c.volume_mounts[0].mount_path if c.name == "backend"][0] == "/app/data"
    error_message = "the backend mounts the data volume at /app/data"
  }

  assert {
    condition     = google_cloud_run_v2_service.this.template[0].volumes[0].nfs[0].server == "10.10.0.2" && google_cloud_run_v2_service.this.template[0].volumes[0].nfs[0].path == "/share"
    error_message = "the data volume is the Filestore share"
  }

  assert {
    condition     = [for c in google_cloud_run_v2_service.this.template[0].containers : c.startup_probe[0].period_seconds * c.startup_probe[0].failure_threshold if c.name == "backend"][0] == 240
    error_message = "the backend's startup budget is exactly the 240 s Cloud Run allows"
  }

  assert {
    condition     = google_cloud_run_v2_service.this.ingress == "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" && length(google_compute_global_forwarding_rule.https) == 1 && length(google_compute_global_forwarding_rule.http) == 1
    error_message = "ingress is restricted to the created load balancer"
  }

  assert {
    condition     = google_compute_managed_ssl_certificate.this[0].managed[0].domains == tolist(["ea.example.com"])
    error_message = "the managed certificate covers the host of public_url"
  }

  assert {
    condition     = google_cloud_run_v2_service_iam_member.public.member == "allUsers" && google_cloud_run_v2_service_iam_member.public.role == "roles/run.invoker"
    error_message = "the service accepts unauthenticated traffic (Turbo EA signs users in itself)"
  }

  assert {
    condition     = google_cloud_run_v2_job.chown[0].run_execution_token == "1" && google_cloud_run_v2_job.chown[0].template[0].template[0].containers[0].args == tolist(["-R", "1000:1000", "/data"])
    error_message = "the chown job makes the share owned by 1000:1000"
  }

  assert {
    condition     = google_artifact_registry_repository.ghcr[0].mode == "REMOTE_REPOSITORY" && google_artifact_registry_repository.ghcr[0].remote_repository_config[0].docker_repository[0].custom_repository[0].uri == "https://ghcr.io"
    error_message = "the remote repository proxies ghcr.io"
  }

  assert {
    condition     = [for c in google_cloud_run_v2_service.this.template[0].containers : c.image if c.name == "backend"][0] == "europe-west1-docker.pkg.dev/my-project/ghcr/vincentmakes/turbo-ea/backend:2.141.0"
    error_message = "images are pulled through the remote repository"
  }
}

run "no_load_balancer" {
  variables {
    create_load_balancer = false
    run_chown_job        = false
  }

  assert {
    condition     = google_cloud_run_v2_service.this.ingress == "INGRESS_TRAFFIC_ALL" && length(google_compute_global_forwarding_rule.https) == 0 && length(google_compute_managed_ssl_certificate.this) == 0
    error_message = "without a load balancer the run.app URL is public"
  }

  assert {
    condition     = length(google_cloud_run_v2_job.chown) == 0
    error_message = "the chown job can be skipped"
  }
}

run "mcp" {
  variables {
    deploy_mcp = true
  }

  assert {
    condition     = [for c in google_cloud_run_v2_service.this.template[0].containers : c.name] == ["nginx", "backend", "frontend", "mcp-server"]
    error_message = "the MCP server is a fourth sidecar"
  }

  assert {
    condition     = [for c in google_cloud_run_v2_service.this.template[0].containers : c.depends_on if c.name == "nginx"][0] == tolist(["backend", "frontend", "mcp-server"])
    error_message = "nginx also waits for the MCP server"
  }

  assert {
    condition = {
      for e in [for c in google_cloud_run_v2_service.this.template[0].containers : c.env if c.name == "mcp-server"][0] : e.name => e.value
    }["MCP_PUBLIC_URL"] == "https://ea.example.com/mcp"
    error_message = "the MCP server is published under /mcp"
  }
}

run "byo_database" {
  variables {
    create_database                   = false
    db_host                           = "10.30.0.4"
    db_password                       = "correct horse battery staple"
    create_private_service_connection = true
    image_repository                  = "europe-docker.pkg.dev/my-project/mirror/vincentmakes/turbo-ea"
    create_artifact_registry          = false
  }

  assert {
    condition     = length(google_sql_database_instance.this) == 0 && length(google_sql_user.this) == 0
    error_message = "no database resources when bringing your own"
  }

  assert {
    condition     = length(google_service_networking_connection.psa) == 1 && length(google_compute_global_address.psa) == 1
    error_message = "private services access can still be created"
  }

  assert {
    condition = {
      for e in [for c in google_cloud_run_v2_service.this.template[0].containers : c.env if c.name == "backend"][0] : e.name => e.value if length(e.value_source) == 0
    }["POSTGRES_HOST"] == "10.30.0.4"
    error_message = "the backend points at the given host"
  }

  assert {
    condition     = nonsensitive(google_secret_manager_secret_version.db_password.secret_data) == "correct horse battery staple"
    error_message = "the given password lands in the module-owned secret"
  }

  assert {
    condition     = length(google_artifact_registry_repository.ghcr) == 0 && [for c in google_cloud_run_v2_service.this.template[0].containers : c.image if c.name == "nginx"][0] == "europe-docker.pkg.dev/my-project/mirror/vincentmakes/turbo-ea/nginx:2.141.0"
    error_message = "an existing registry path is used as given"
  }
}
