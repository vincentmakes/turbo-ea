# Turbo EA on Azure Container Apps (Terraform)

Terraform counterpart of [`deploy/azure-container-apps/main.bicep`](../../azure-container-apps/main.bicep).
Guide: <https://docs.turbo-ea.org/admin/terraform/#azure-container-apps>.

One container app runs the edge nginx (ingress, 8920), the frontend (8080),
the backend (8000) and the optional MCP server (8001) as sidecars. The app is
pinned to **one** replica (`min_replicas = max_replicas = 1`). In `Single`
revision mode an update briefly runs the old and the new replica side by side;
the backend's PostgreSQL advisory lock keeps the two from migrating at once.

## What you bring

- An existing resource group.
- Optionally, for VNet integration: a `/27` (or larger) subnet delegated to
  `Microsoft.App/environments` (`infrastructure_subnet_id`).
- Optionally, for a privately reachable database: a **different** subnet
  delegated to `Microsoft.DBforPostgreSQL/flexibleServers`
  (`postgresql_delegated_subnet_id`) and a private DNS zone ending in
  `.postgres.database.azure.com` linked to the VNet
  (`postgresql_private_dns_zone_id`). Without them the created server keeps a
  public endpoint restricted to Azure services.
- Globally unique names for the storage account and the server
  (`storage_account_name`, `postgresql_server_name`).

## What is created

Log Analytics workspace, Container Apps environment (Consumption profile),
storage account + Azure Files share linked to the environment (mounted at
`/app/data` with `uid=1000,gid=1000`), the container app with its secrets and
probes, and — by default — an Azure Database for PostgreSQL Flexible Server
with the `turboea` database. `CanNotDelete` locks protect the server and the
storage account (`db_deletion_protection`, `storage_deletion_protection`).

## Bring your own database

```hcl
create_database = false
db_host         = "turbo-ea.postgres.database.azure.com"
```

and `export TF_VAR_db_password='…'`. The server must be reachable from the
environment (private access in the same VNet, a private endpoint, or a public
endpoint allowing Azure services).

## Custom domain

The first deploy answers on the `fqdn` output. To use your own hostname, add
the DNS records (`CNAME` to the FQDN and `TXT asuid.<host>` =
`custom_domain_verification_id`), then bind a managed certificate with the
CLI — the two-phase bind is deliberately left out of Terraform:

```bash
az containerapp hostname add  -g <rg> -n <app> --hostname ea.example.com
az containerapp hostname bind -g <rg> -n <app> --hostname ea.example.com --environment <env> --validation-method CNAME
```

then set `public_url = "https://ea.example.com"` and apply again.

## Day two

- **Upgrade**: bump `image_tag`, `terraform apply`. For strict
  stop-then-start semantics switch to `Multiple` revision mode and deactivate
  the old revision first (see the guide).
- **Logs**: the workspace, `ContainerAppConsoleLogs_CL`.
- **Destroy**: set `db_deletion_protection = false` and
  `storage_deletion_protection = false`, apply, then `terraform destroy`.

## Inputs

| Name | Default | Notes |
|---|---|---|
| `subscription_id`, `resource_group_name`, `location` | — | Where to deploy |
| `name` | `turbo-ea` | Resource name prefix |
| `public_url` | — | `https://host`, no path |
| `image_tag` | — | Release to run, e.g. `2.141.0` |
| `image_repository` | `ghcr.io/vincentmakes/turbo-ea` | |
| `secret_key` | — | Sensitive; `openssl rand -base64 48` |
| `deploy_mcp` | `false` | MCP server sidecar at `/mcp` |
| `allowed_origins` / `embed_allowed_origins` | `[]` | CORS / iframe allow-lists |
| `db_pool_size` / `db_max_overflow` | `10` / `5` | Backend connection budget |
| `infrastructure_subnet_id` | `null` | VNet integration |
| `postgresql_delegated_subnet_id`, `postgresql_private_dns_zone_id` | `null` | Private database access (both or neither) |
| `storage_account_name` | derived | 3–24 lowercase alphanumerics, globally unique |
| `file_share_name` / `file_share_quota_gb` | `turbo-ea-data` / `50` | |
| `storage_deletion_protection` | `true` | Lock on the storage account |
| `create_database` | `true` | Flexible Server |
| `db_host`, `db_password` | `null` | Bring your own |
| `db_port`, `db_name`, `db_user` | `5432`, `turboea`, `turboea` | |
| `postgresql_server_name` | `<name>-pg` | Globally unique |
| `postgresql_sku_name` | `B_Standard_B1ms` | |
| `postgresql_version` | `16` | 13–18 |
| `postgresql_storage_mb` | `32768` | Shrinking replaces the server |
| `postgresql_zone` | `null` | |
| `db_backup_retention_days` | `7` | 7–35 |
| `db_deletion_protection` | `true` | Lock on the server |
| `log_retention_days` | `30` | |
| `tags` | `{}` | |

## Outputs

`fqdn`, `container_app_name`, `environment_name`, `environment_id`,
`custom_domain_verification_id`, `postgres_fqdn`, `storage_account_name`.
