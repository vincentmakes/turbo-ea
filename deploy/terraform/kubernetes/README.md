# Turbo EA on Kubernetes with Terraform (`helm_release`)

Installs the published chart — `oci://ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea`,
see [`charts/turbo-ea`](../../../charts/turbo-ea/) — through the Helm
provider, for teams whose clusters are managed by Terraform.
Guide: <https://docs.turbo-ea.org/admin/terraform/#kubernetes>.

## What you bring

- A cluster and a kubeconfig (`kubeconfig_path`, `kubeconfig_context`); any
  other provider configuration (EKS token, AKS credentials, GKE auth plugin)
  replaces the two `provider` blocks in `providers.tf`.
- A PostgreSQL server reachable from the cluster (`db_host`); the chart never
  runs a database.
- An Ingress controller or cloud load balancer for TLS — pass its class and
  annotations through `ingress`.

## What is created

The namespace (optional), a Secret carrying `SECRET_KEY` and
`POSTGRES_PASSWORD` (unless `existing_secret` names one produced by External
Secrets or Sealed Secrets), and the Helm release. The module renders the
chart's own values keys and passes the Secret by name — secrets never travel
through values or the release manifest.

`extra_values` takes further YAML documents (chart values) that are merged
after the generated one, so anything the module does not expose
(`backend.resources`, `nginx.replicaCount`, `seed.demo`…) stays reachable.

## Day two

- **Upgrade**: bump `chart_version` (and drop any `image_tag` override),
  `terraform apply`. Helm waits for the backend to come back; the first boot
  after an upgrade runs migrations, hence the 12-minute `helm_timeout`.
- **Without an Ingress** yet: `kubectl -n turbo-ea port-forward
  svc/<nginx_service_name> 8080:80`.
- **Destroy**: `terraform destroy` removes the release and the namespace; the
  PersistentVolumeClaim goes with the namespace unless `existing_claim` named
  one you manage.

## Inputs

| Name | Default | Notes |
|---|---|---|
| `kubeconfig_path`, `kubeconfig_context` | `~/.kube/config`, `null` | |
| `namespace`, `create_namespace` | `turbo-ea`, `true` | |
| `release_name` | `turbo-ea` | |
| `chart_repository` | `oci://ghcr.io/vincentmakes/turbo-ea/charts` | |
| `chart_version` | — | e.g. `2.141.0` |
| `image_tag` | `null` | Chart appVersion |
| `public_url` | — | `https://host`, no path |
| `secret_key`, `db_password` | `null` | Required unless `existing_secret` |
| `existing_secret`, `existing_secret_keys` | `""`, `SECRET_KEY` / `POSTGRES_PASSWORD` | |
| `db_host`, `db_port`, `db_name`, `db_user` | —, `5432`, `turboea`, `turboea` | |
| `db_pool_size` / `db_max_overflow` | `20` / `10` | Chart defaults |
| `deploy_mcp` | `false` | |
| `allowed_origins` / `embed_allowed_origins` | `[]` | |
| `storage_class`, `storage_size`, `existing_claim` | `""`, `10Gi`, `""` | Backend data volume |
| `ingress` | `{ enabled = false }` | `class_name`, `annotations`, `hosts`, `tls` |
| `extra_values` | `[]` | Extra values YAML documents |
| `helm_wait`, `helm_timeout`, `helm_atomic` | `true`, `720`, `false` | |

## Outputs

`release_name`, `namespace`, `chart_version`, `status`, `secret_name`,
`nginx_service_name`.
