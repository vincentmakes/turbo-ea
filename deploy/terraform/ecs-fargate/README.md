# Turbo EA on AWS ECS Fargate (Terraform)

Terraform counterpart of [`deploy/ecs-fargate/template.yaml`](../../ecs-fargate/template.yaml).
Guide: <https://docs.turbo-ea.org/admin/terraform/#aws-ecs-fargate>.

One Fargate task runs the edge nginx (8920, behind an Application Load
Balancer), the frontend (8080), the backend (8000) and the optional MCP
server (8001) as sidecars. The service keeps **one** task and replaces it
stop-then-start (`deployment_minimum_healthy_percent = 0`), so two backends
never run at once — at the price of one to two minutes of downtime per deploy.

## What you bring

- A VPC with at least two **public** subnets (load balancer) and two
  **private** subnets in different Availability Zones (task, EFS mount
  targets, RDS subnet group). The private subnets need a NAT gateway for
  image pulls from ghcr.io.
- An ACM certificate for the public hostname, in the same Region.
- Optionally a Route 53 hosted zone (`route53_zone_id`) for the alias
  record; otherwise create a CNAME to `alb_dns_name` yourself.

## What is created

Cluster (Container Insights), CloudWatch log group, execution + task IAM
roles, three security groups, EFS file system + two mount targets + access
point (uid/gid 1000, `/turbo-ea`), Secrets Manager secrets for `SECRET_KEY`
and the database password, ALB with HTTPS (TLS 1.3 policy) and an HTTP→HTTPS
redirect, target group on `/api/health`, task definition (2 vCPU / 4 GiB),
service (Fargate 1.4.0, ECS Exec enabled) and — by default — an RDS for
PostgreSQL instance (gp3, encrypted, private, deletion protection on).

## Bring your own database

```hcl
create_database      = false
db_host              = "turbo-ea.abcdefghij.eu-west-1.rds.amazonaws.com"
db_security_group_id = "sg-…"   # opens db_port from the task; or use the task_security_group_id output yourself
```

and `export TF_VAR_db_password='…'`.

## Day two

- **Upgrade**: bump `image_tag`, `terraform apply`. The service stops the old
  task, starts the new one; the backend runs migrations at boot.
- **Shell into the backend**: `aws ecs execute-command --cluster <name>
  --task <id> --container backend --interactive --command sh`.
- **Backups**: EFS has AWS Backup enabled; RDS keeps
  `db_backup_retention_days` of automated backups. Back up the
  `secret_key_secret_arn` secret with the database — one is useless without
  the other.
- **Destroy**: set `db_deletion_protection = false` (and
  `db_skip_final_snapshot = true` if you really want no snapshot), apply,
  then `terraform destroy`.

## Inputs

| Name | Default | Notes |
|---|---|---|
| `region` | — | AWS Region |
| `name` | `turbo-ea` | Resource name prefix |
| `public_url` | — | `https://host`, no path |
| `image_tag` | — | Release to run, e.g. `2.141.0` |
| `image_repository` | `ghcr.io/vincentmakes/turbo-ea` | |
| `secret_key` | — | Sensitive; `openssl rand -base64 48` |
| `deploy_mcp` | `false` | MCP server sidecar at `/mcp` |
| `allowed_origins` / `embed_allowed_origins` | `[]` | CORS / iframe allow-lists |
| `db_pool_size` / `db_max_overflow` | `10` / `5` | Backend connection budget |
| `vpc_id`, `public_subnet_ids`, `private_subnet_ids` | — | Existing network |
| `certificate_arn` | — | ACM certificate |
| `route53_zone_id` | `null` | Optional alias record |
| `create_database` | `true` | RDS instance |
| `db_host`, `db_password`, `db_security_group_id` | `null` | Bring your own |
| `db_port`, `db_name`, `db_user` | `5432`, `turboea`, `turboea` | |
| `db_instance_class` | `db.t4g.micro` | |
| `db_engine_version` | `17` | Major version |
| `db_allocated_storage` | `20` | GiB, grows to 5× |
| `db_multi_az` | `false` | |
| `db_backup_retention_days` | `7` | |
| `db_deletion_protection` | `true` | |
| `db_skip_final_snapshot` | `false` | |
| `log_retention_days` | `30` | |
| `container_insights` | `true` | |
| `tags` | `{}` | Provider default tags |

## Outputs

`alb_dns_name`, `alb_zone_id`, `task_security_group_id`, `cluster_name`,
`service_name`, `task_definition_arn`, `efs_file_system_id`, `db_endpoint`,
`db_password_secret_arn`, `secret_key_secret_arn`.
