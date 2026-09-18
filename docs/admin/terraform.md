# Terraform

Teams that manage their cloud with Terraform can deploy Turbo EA the same way. The repository ships four root modules under [`deploy/terraform/`](https://github.com/vincentmakes/turbo-ea/tree/main/deploy/terraform) — one for each managed-container service covered on the [Managed Container Services](managed-containers.md) page, plus one that installs the Helm chart from the [Kubernetes & Cloud](kubernetes.md) page on a cluster you already run. This page is about the modules; the two pages linked above stay the reference for what each platform can and cannot do.

## What the modules build

| Module | Platform | Creates | You bring |
|---|---|---|---|
| `ecs-fargate` | AWS ECS Fargate | Cluster, task and service, Application Load Balancer with HTTPS, EFS, Secrets Manager secrets, RDS for PostgreSQL (optional) | A VPC with public and private subnets (NAT), an ACM certificate |
| `azure-container-apps` | Azure Container Apps | Environment, container app, Log Analytics, storage account and file share, Flexible Server (optional) | A resource group; optionally a delegated subnet and a private DNS zone |
| `cloud-run` | Google Cloud Run | Service, Filestore, Secret Manager secrets, Artifact Registry remote repository, global HTTPS load balancer with a managed certificate, Cloud SQL (optional) | A project, a VPC with a subnet, private services access on that VPC |
| `kubernetes` | Any Kubernetes cluster | Namespace, credentials Secret, the Helm release | A cluster and a kubeconfig, a PostgreSQL server |

The three cloud modules build the **same container group** as the templates on the Managed Container Services page: the edge nginx on port 8920 in front of the frontend, the backend and the optional MCP server, all sharing `localhost`; exactly one backend, never scaled and never scaled to zero; `/app/data` on a persistent share owned by user 1000; TLS terminated at the platform edge. Same shape, different tool — anything the platform page says about probes, deploy overlap and the startup lock applies unchanged.

Three conventions hold across all four:

- **The release is an explicit input.** `image_tag` (or `chart_version` for the Kubernetes module) has no default that could go stale; the `terraform.tfvars.example` next to each module carries the current release.
- **The database is created by default, with a bring-your-own switch.** `create_database = false` together with `db_host` and `db_password` points the backend at a server you already run. Whichever way the database was obtained, the module owns the secret-store objects (`SECRET_KEY` and the database password), so the container definition has one shape.
- **The network is never created.** VPC, VNet and subnet identifiers are inputs; each module's README lists what they must already provide.

## Quick start

```bash
cd deploy/terraform/<module>
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars, then keep the secret out of any file:
export TF_VAR_secret_key="$(openssl rand -base64 48)"
terraform init
terraform plan
terraform apply
```

Point DNS at the output the module names — `alb_dns_name` on AWS, `fqdn` on Azure, `load_balancer_ip` on Google Cloud — open `public_url` and register: the first user becomes the administrator.

!!! warning "State holds secrets"
    `secret_key`, generated database passwords and Container Apps secret values all land in the Terraform state. Use an encrypted remote backend with access control (S3 with SSE and locking, an Azure Storage container, a GCS bucket, Terraform Cloud) — never a `terraform.tfstate` on a laptop for a real instance. Keep `SECRET_KEY` with your database backups: losing it invalidates every session and every encrypted setting, and the database alone cannot bring them back.

## AWS ECS Fargate

**Before you start**: a VPC with at least two public subnets (load balancer) and two private subnets in different Availability Zones (task, EFS mount targets, database); a NAT gateway so the private subnets can pull images from ghcr.io; an ACM certificate for the hostname in the same Region.

Inputs to set: `region`, `vpc_id`, `public_subnet_ids`, `private_subnet_ids`, `certificate_arn`, `public_url`, `image_tag`. Optionally `route53_zone_id` — the module then creates the alias record itself. The created RDS instance is private, encrypted, has deletion protection on and keeps seven days of backups; bring your own with `create_database = false`, `db_host` and `db_security_group_id` (the module opens the port from the task).

Deploys are stop-then-start (`deployment_minimum_healthy_percent = 0`), so a release upgrade costs one to two minutes of downtime and never runs two backends. To open a shell: `aws ecs execute-command … --container backend --interactive --command sh`. To use Amazon Bedrock as the AI provider, add the IAM policy from [AI Features](ai.md) to the module's task role.

## Azure Container Apps

**Before you start**: an existing resource group. For VNet integration, a `/27` subnet delegated to `Microsoft.App/environments`. For a database that is not reachable from the internet, a *second* subnet delegated to `Microsoft.DBforPostgreSQL/flexibleServers` and a private DNS zone ending in `.postgres.database.azure.com` linked to the VNet — set `postgresql_delegated_subnet_id` and `postgresql_private_dns_zone_id` together. Without them the created server keeps a public endpoint restricted to Azure services.

Inputs to set: `subscription_id`, `resource_group_name`, `location`, `public_url`, `image_tag`, and globally unique `storage_account_name` and `postgresql_server_name`. The first deploy answers on the `fqdn` output; bind a custom domain with `az containerapp hostname add` / `bind` as described on the Managed Container Services page, then set `public_url` and apply again. Azure has no deletion-protection flag on a Flexible Server, so the module places `CanNotDelete` locks on the server and the storage account instead (`db_deletion_protection`, `storage_deletion_protection`).

## Google Cloud Run

**Before you start**: a project, a VPC network with a subnet in the region, and **private services access** on that VPC — Cloud SQL's private IP needs it. If the VPC does not have it yet, set `create_private_service_connection = true` once; a second peering on a VPC that already has one fails.

Inputs to set: `project_id`, `region`, `network`, `subnetwork`, `public_url`, `image_tag`. The module enables the APIs, creates an Artifact Registry remote repository that proxies ghcr.io (Cloud Run cannot pull from ghcr.io directly), a Filestore instance for `/app/data` (the default `BASIC_HDD` tier starts at 1 TiB and is the dominant cost), runs a one-off job that makes the share owned by user 1000, and puts a global HTTPS load balancer with a Google-managed certificate in front of the service. Create the DNS A record for the host of `public_url` pointing at `load_balancer_ip`; the certificate stays `PROVISIONING` until that record resolves. Uploads above 32 MiB — a large workspace import — fail on Cloud Run's HTTP/1 path; that is a platform limit, not a module setting.

## Kubernetes

The `kubernetes` module wraps the published chart in a `helm_release`, for teams whose clusters are themselves managed by Terraform. It creates the namespace and a Secret carrying `SECRET_KEY` and `POSTGRES_PASSWORD` (or uses one produced by External Secrets or Sealed Secrets through `existing_secret`), renders the chart's own values keys and passes the Secret by name — secrets never travel through values. Inputs to set: `chart_version`, `public_url`, `db_host`, and either `secret_key` + `db_password` or `existing_secret`. Ingress class, annotations and TLS go through the `ingress` object; anything the module does not expose (`backend.resources`, `seed.demo`…) goes through `extra_values`, a list of chart-values documents merged after the generated one.

The two `provider` blocks read a kubeconfig; replace them with your cluster's own authentication (EKS token, AKS credentials, GKE auth plugin) when Terraform also creates the cluster.

## Upgrades and removal

A release upgrade is a change of `image_tag` (or `chart_version`) followed by `terraform apply`; the backend runs migrations at boot, under the startup lock on platforms that overlap old and new instances. Read the [release notes](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md) first, and take a database backup as on any other install — [Operations & Upgrades](operations.md) applies.

`terraform destroy` is refused while deletion protection is on: switch off `db_deletion_protection` (AWS, Google Cloud, and the locks on Azure), `deletion_protection` on the Cloud Run service and, on AWS, decide about the final RDS snapshot (`db_skip_final_snapshot`), apply, and destroy. A deleted Cloud SQL instance name cannot be reused for a week.

## Validation without a cloud

Every module ships tests under `tests/` that run against **mock providers**: real provider schemas, invented values, no credentials, nothing created. They pin the wiring the platform pages depend on — one backend, the edge on port 8920, secrets by reference, the data volume, the bring-your-own switches — and CI runs them together with `terraform validate` and `tflint` on every change. What they cannot prove is that a cloud accepts the plan; the first `terraform plan` against a real account is that check. OpenTofu is not exercised, but the modules avoid every Terraform-only feature.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Error creating Service Networking Connection … already exists` (Google Cloud) | The VPC already has private services access. Set `create_private_service_connection = false`. |
| The Google-managed certificate stays `PROVISIONING` | The DNS A record for `public_url`'s host does not yet resolve to `load_balancer_ip`. Fix DNS and wait; nothing to apply. |
| `Permission denied` under `/app/data` on Cloud Run | The share is not owned by user 1000 — for example after restoring it. Change `chown_job_token` and apply to run the job again. |
| `postgresql_delegated_subnet_id and postgresql_private_dns_zone_id must be set together` (Azure) | Private access needs both; the zone must be linked to the VNet and the subnet must differ from the environment's. |
| `db_host is required when create_database is false` | Bring-your-own needs `db_host` and `db_password` (`TF_VAR_db_password`). |
| `terraform destroy` refuses | Deletion protection or a `CanNotDelete` lock is on; see *Upgrades and removal*. |
| The application answers on the platform URL but not on `public_url` | DNS points elsewhere, or `public_url` still names the platform FQDN — set it to the final origin and apply; the session cookie is scoped to it. |
