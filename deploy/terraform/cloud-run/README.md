# Turbo EA on Google Cloud Run (Terraform)

Terraform counterpart of [`deploy/cloud-run/service.yaml`](../../cloud-run/service.yaml).
Guide: <https://docs.turbo-ea.org/admin/terraform/#google-cloud-run>.

One Cloud Run service runs the edge nginx (ingress container, 8920), the
frontend (8080), the backend (8000) and the optional MCP server (8001) as
sidecars, with **one** instance (`min = max = 1`) and CPU always allocated. A
new revision briefly overlaps the old one; the backend's PostgreSQL advisory
lock keeps the two from migrating at once.

## What you bring

- A project and a VPC network with a subnet in `region` (Direct VPC egress).
- **Private services access** on that VPC, which Cloud SQL's private IP
  needs. If the VPC does not have it yet, set
  `create_private_service_connection = true` once; a second peering on a VPC
  that already has one fails.
- DNS control for the host of `public_url` (an A record to
  `load_balancer_ip`).

## What is created

The required project APIs, an Artifact Registry **remote repository** that
proxies ghcr.io (Cloud Run cannot pull from ghcr.io directly), a service
account, Secret Manager secrets for `SECRET_KEY` and the database password, a
Filestore instance (the only fully POSIX persistent volume on Cloud Run; the
default `BASIC_HDD` tier starts at 1 TiB and is the dominant cost), a one-off
Cloud Run job that makes the share owned by uid/gid 1000, the service itself,
a global external HTTPS load balancer with a Google-managed certificate and
an HTTP→HTTPS redirect (service ingress restricted to it), and — by default —
a Cloud SQL for PostgreSQL instance with a private IP only.

## Bring your own database

```hcl
create_database = false
db_host         = "10.20.0.3"   # reachable from the subnet
```

and `export TF_VAR_db_password='…'`.

## Day two

- **Upgrade**: bump `image_tag`, `terraform apply`.
- **Certificate**: `google_compute_managed_ssl_certificate` stays
  `PROVISIONING` until the DNS A record resolves to `load_balancer_ip`; the
  site answers over HTTPS once it is `ACTIVE` (minutes to an hour).
- **Re-run the chown job** (e.g. after restoring the share): change
  `chown_job_token` and apply.
- **Uploads above 32 MiB** (a workspace import) fail on Cloud Run's HTTP/1
  path — a platform limit, see the managed-containers guide.
- **Destroy**: set `db_deletion_protection = false` and
  `deletion_protection = false`, apply, then `terraform destroy`. A deleted
  Cloud SQL instance name cannot be reused for a week.

## Inputs

| Name | Default | Notes |
|---|---|---|
| `project_id`, `region` | — | Where to deploy |
| `name` | `turbo-ea` | Resource name prefix |
| `public_url` | — | `https://host`, no path; host = certificate domain |
| `image_tag` | — | Release to run, e.g. `2.141.0` |
| `image_repository` | derived | Artifact Registry path; set to use another mirror |
| `secret_key` | — | Sensitive; `openssl rand -base64 48` |
| `deploy_mcp` | `false` | MCP server sidecar at `/mcp` |
| `allowed_origins` / `embed_allowed_origins` | `[]` | CORS / iframe allow-lists |
| `db_pool_size` / `db_max_overflow` | `10` / `5` | Backend connection budget |
| `enable_apis` | `true` | |
| `network`, `subnetwork`, `network_project_id` | — / — / `null` | Existing VPC (Shared VPC host optional) |
| `create_private_service_connection`, `psa_prefix_length` | `false`, `16` | |
| `create_artifact_registry`, `artifact_registry_repository_id` | `true`, `ghcr` | |
| `filestore_location`, `filestore_tier`, `filestore_capacity_gb` | `<region>-b`, `BASIC_HDD`, `1024` | |
| `filestore_share_name`, `filestore_connect_mode` | `share`, `DIRECT_PEERING` | |
| `run_chown_job`, `chown_job_token`, `chown_image` | `true`, `"1"`, `alpine:3.21` | |
| `create_load_balancer` | `true` | Global HTTPS LB + managed certificate |
| `launch_stage` | `null` | e.g. `BETA` if the API rejects a feature |
| `deletion_protection` | `true` | On the service |
| `service_account_id` | `<name>-run` | |
| `create_database` | `true` | Cloud SQL |
| `db_host`, `db_password` | `null` | Bring your own |
| `db_port`, `db_name`, `db_user` | `5432`, `turboea`, `turboea` | |
| `cloudsql_instance_name` | `<name>-db` | |
| `cloudsql_tier` | `db-custom-1-3840` | |
| `cloudsql_database_version` | `POSTGRES_17` | |
| `cloudsql_edition` | `ENTERPRISE` | `ENTERPRISE_PLUS` rejects small tiers |
| `cloudsql_availability_type` | `ZONAL` | |
| `cloudsql_disk_size_gb` | `20` | Auto-resize on |
| `db_backup_retention_days` | `7` | |
| `db_deletion_protection` | `true` | |
| `labels` | `{}` | |

## Outputs

`service_uri`, `load_balancer_ip`, `cloud_sql_private_ip`,
`cloud_sql_connection_name`, `filestore_ip`, `service_account_email`,
`image_repository`.
