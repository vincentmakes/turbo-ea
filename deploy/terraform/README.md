# Terraform modules for Turbo EA

Four root modules, one per way of running Turbo EA on a cloud you already
have. Guide: <https://docs.turbo-ea.org/admin/terraform/>.

| Module | Runs on | Creates | You bring |
|---|---|---|---|
| [`ecs-fargate/`](ecs-fargate/) | AWS ECS Fargate | Cluster, task + service, ALB (HTTPS), EFS, Secrets Manager secrets, RDS for PostgreSQL (optional) | VPC with public + private subnets (NAT), ACM certificate |
| [`azure-container-apps/`](azure-container-apps/) | Azure Container Apps | Environment, container app, Log Analytics, storage account + file share, Flexible Server (optional) | Resource group; optionally a delegated subnet + private DNS zone |
| [`cloud-run/`](cloud-run/) | Google Cloud Run | Service, Filestore, Secret Manager secrets, Artifact Registry remote repo, global HTTPS load balancer, Cloud SQL (optional) | Project, VPC + subnet; private services access on the VPC |
| [`kubernetes/`](kubernetes/) | Any Kubernetes cluster | Namespace, credentials Secret, `helm_release` of the published chart | Cluster + kubeconfig, PostgreSQL server |

The three cloud modules build the **same container group** as the templates
next door (`deploy/azure-container-apps`, `deploy/cloud-run`,
`deploy/ecs-fargate`): the edge nginx on port 8920 in front of the frontend
(8080), the backend (8000) and the optional MCP server (8001), sharing
`localhost`; one backend, never scaled, CPU always allocated; `/app/data` on a
persistent share owned by uid/gid 1000; TLS at the platform edge. Same shape,
different tool.

## Conventions

- **Terraform ≥ 1.9**, providers pinned with `~>` and a committed
  `.terraform.lock.hcl` (five platforms). No write-only arguments or
  provider functions, so OpenTofu should work too — untested.
- **`image_tag` / `chart_version` are required.** There is no default that
  could go stale; the `terraform.tfvars.example` files carry the current
  release.
- **The module owns the secret-store objects** (SECRET_KEY and the database
  password) whichever way the database was obtained. `create_database =
  false` plus `db_host` / `db_password` brings your own server.
- **The network is never created.** VPC / VNet / subnet ids are inputs; each
  module's README lists what they must already provide.
- **State holds secrets** (`secret_key`, generated passwords, Container Apps
  secret values). Use an encrypted remote backend with access control —
  never a local `terraform.tfstate` on a laptop for a real instance.

## Quick start

```bash
cd deploy/terraform/<module>
cp terraform.tfvars.example terraform.tfvars   # edit
export TF_VAR_secret_key="$(openssl rand -base64 48)"   # keep it: losing it invalidates every session and encrypted setting
terraform init
terraform plan
terraform apply
```

Point DNS at the output the module names (`alb_dns_name`, `fqdn`,
`load_balancer_ip`), open `public_url`, register — the first user becomes the
admin.

## Tests

Every module ships `tests/*.tftest.hcl` that run against **mock providers**:
real provider schemas, invented values, no cloud credentials, nothing created.
They pin the wiring the guide depends on (one backend, `NGINX_HTTP_PORT=8920`,
secrets by reference, the data volume, the bring-your-own toggles), not
whether a cloud would accept the plan — the first `terraform plan` against a
real account is that check.

```bash
cd deploy/terraform/<module>
terraform init -backend=false
terraform validate
terraform test
tflint --init && tflint
```

CI runs the same four steps on every change under `deploy/terraform/`.
