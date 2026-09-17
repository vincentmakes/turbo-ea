# Terraform

使用 Terraform 管理云环境的团队可以用同样的方式部署 Turbo EA。仓库在 [`deploy/terraform/`](https://github.com/vincentmakes/turbo-ea/tree/main/deploy/terraform) 下提供四个根模块：[托管容器服务](managed-containers.md)页面涵盖的每个托管容器服务各一个，另加一个在已有集群上安装 [Kubernetes 与云](kubernetes.md)页面所述 Helm chart 的模块。本页只讲模块；每个平台能做什么、不能做什么，仍以上面两个链接页面为准。

## 模块构建的内容

| 模块 | 平台 | 创建 | 你需要准备 |
|---|---|---|---|
| `ecs-fargate` | AWS ECS Fargate | 集群、任务与服务、启用 HTTPS 的 Application Load Balancer、EFS、Secrets Manager 密钥、RDS for PostgreSQL（可选） | 带公有和私有子网（NAT）的 VPC、一张 ACM 证书 |
| `azure-container-apps` | Azure Container Apps | 环境、container app、Log Analytics、存储账户与文件共享、Flexible Server（可选） | 一个资源组；可选一个委派子网和一个私有 DNS 区域 |
| `cloud-run` | Google Cloud Run | 服务、Filestore、Secret Manager 密钥、Artifact Registry 远程仓库、带托管证书的全局 HTTPS 负载均衡器、Cloud SQL（可选） | 一个项目、带子网的 VPC、该 VPC 上的私有服务访问 |
| `kubernetes` | 任意 Kubernetes 集群 | 命名空间、凭据 Secret、Helm release | 集群和 kubeconfig、一台 PostgreSQL 服务器 |

三个云模块构建的**容器组与托管容器服务页面上的模板完全相同**：边缘 nginx 监听 8920 端口，位于前端、后端和可选 MCP 服务器之前，全部共享 `localhost`；只有一个后端，从不扩缩容也从不缩到零；`/app/data` 位于归用户 1000 所有的持久共享上；TLS 在平台边缘终止。形状相同，工具不同——平台页面关于探针、部署重叠和启动锁的一切说明同样适用。

四个模块共同遵守三条约定：

- **版本是显式输入。** `image_tag`（Kubernetes 模块为 `chart_version`）没有可能过期的默认值；每个模块旁的 `terraform.tfvars.example` 写着当前版本。
- **默认创建数据库，并提供自带数据库的开关。** `create_database = false` 加上 `db_host` 与 `db_password` 即可让后端指向你已运行的服务器。无论数据库来自何处，密钥存储对象（`SECRET_KEY` 与数据库密码）都由模块拥有，因此容器定义只有一种形状。
- **从不创建网络。** VPC、VNet 和子网标识均为输入；每个模块的 README 列出了它们必须事先具备的条件。

## 快速开始

```bash
cd deploy/terraform/<模块>
cp terraform.tfvars.example terraform.tfvars
# 编辑 terraform.tfvars，并让密钥远离任何文件：
export TF_VAR_secret_key="$(openssl rand -base64 48)"
terraform init
terraform plan
terraform apply
```

将 DNS 指向模块给出的输出——AWS 上是 `alb_dns_name`，Azure 上是 `fqdn`，Google Cloud 上是 `load_balancer_ip`——打开 `public_url` 并注册：第一个用户即成为管理员。

!!! warning "状态文件包含密钥"
    `secret_key`、生成的数据库密码和 Container Apps 的密钥值都会进入 Terraform 状态。请使用带访问控制的加密远程后端（启用 SSE 与锁定的 S3、Azure Storage 容器、GCS 存储桶、Terraform Cloud）——正式实例绝不能把 `terraform.tfstate` 放在笔记本电脑上。请将 `SECRET_KEY` 与数据库备份一起保存：丢失它会使所有会话和所有加密设置失效，仅凭数据库无法恢复。

## AWS ECS Fargate

**开始之前**：一个 VPC，至少有两个公有子网（负载均衡器）和位于不同可用区的两个私有子网（任务、EFS 挂载目标、数据库）；一个 NAT 网关，使私有子网能从 ghcr.io 拉取镜像；同一区域内为该主机名签发的 ACM 证书。

需要设置的输入：`region`、`vpc_id`、`public_subnet_ids`、`private_subnet_ids`、`certificate_arn`、`public_url`、`image_tag`。可选 `route53_zone_id`——设置后模块会自行创建别名记录。创建的 RDS 实例为私有、加密、启用删除保护并保留七天备份；要自带数据库，请使用 `create_database = false`、`db_host` 和 `db_security_group_id`（模块会从任务开放该端口）。

部署方式为先停后起（`deployment_minimum_healthy_percent = 0`），因此版本升级会有一到两分钟的停机，但绝不会同时运行两个后端。进入 shell：`aws ecs execute-command … --container backend --interactive --command sh`。

## Azure Container Apps

**开始之前**：一个已存在的资源组。若需 VNet 集成，准备一个委派给 `Microsoft.App/environments` 的 `/27` 子网。若数据库不应从互联网访问，再准备*第二个*委派给 `Microsoft.DBforPostgreSQL/flexibleServers` 的子网，以及一个以 `.postgres.database.azure.com` 结尾并链接到该 VNet 的私有 DNS 区域——`postgresql_delegated_subnet_id` 与 `postgresql_private_dns_zone_id` 必须同时设置。若不设置，创建的服务器保留一个仅限 Azure 服务访问的公共端点。

需要设置的输入：`subscription_id`、`resource_group_name`、`location`、`public_url`、`image_tag`，以及全局唯一的 `storage_account_name` 和 `postgresql_server_name`。首次部署在 `fqdn` 输出上响应；按托管容器服务页面所述，用 `az containerapp hostname add` / `bind` 绑定自定义域名，然后设置 `public_url` 并再次 apply。Azure 的 Flexible Server 没有删除保护标志，因此模块改为在服务器和存储账户上放置 `CanNotDelete` 锁（`db_deletion_protection`、`storage_deletion_protection`）。

## Google Cloud Run

**开始之前**：一个项目、一个在该区域拥有子网的 VPC 网络，以及该 VPC 上的**私有服务访问**——Cloud SQL 的私有 IP 需要它。若 VPC 尚未启用，请设置一次 `create_private_service_connection = true`；在已有对等连接的 VPC 上再建一个会失败。

需要设置的输入：`project_id`、`region`、`network`、`subnetwork`、`public_url`、`image_tag`。模块会启用所需 API，创建代理 ghcr.io 的 Artifact Registry 远程仓库（Cloud Run 无法直接从 ghcr.io 拉取），创建用于 `/app/data` 的 Filestore 实例（默认 `BASIC_HDD` 层级起步 1 TiB，是主要成本），运行一次性作业把共享归属给用户 1000，并在服务前放置带 Google 托管证书的全局 HTTPS 负载均衡器。为 `public_url` 的主机创建指向 `load_balancer_ip` 的 DNS A 记录；在该记录解析之前证书会一直处于 `PROVISIONING`。超过 32 MiB 的上传（大型工作区导入）在 Cloud Run 的 HTTP/1 路径上会失败；这是平台限制，不是模块设置。

## Kubernetes

`kubernetes` 模块用 `helm_release` 包装已发布的 chart，适合集群本身也由 Terraform 管理的团队。它创建命名空间和一个携带 `SECRET_KEY` 与 `POSTGRES_PASSWORD` 的 Secret（或通过 `existing_secret` 使用 External Secrets / Sealed Secrets 生成的 Secret），生成 chart 自身的 values 键，并按名称传递该 Secret——密钥从不经由 values 传递。需要设置的输入：`chart_version`、`public_url`、`db_host`，以及 `secret_key` + `db_password` 或 `existing_secret` 二选一。Ingress 类、注解和 TLS 通过 `ingress` 对象传入；模块未暴露的内容（`backend.resources`、`seed.demo`……）通过 `extra_values` 传入，这是一个在生成文档之后合并的 chart values 文档列表。

两个 `provider` 块读取 kubeconfig；当 Terraform 同时创建集群时，请替换为集群自身的认证方式（EKS 令牌、AKS 凭据、GKE 认证插件）。

## 升级与删除

版本升级就是修改 `image_tag`（或 `chart_version`）后执行 `terraform apply`；后端在启动时运行迁移，在新旧实例重叠的平台上受启动锁保护。请先阅读[发行说明](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md)，并像任何其他安装一样先备份数据库——[运维与升级](operations.md)同样适用。

删除保护开启时 `terraform destroy` 会被拒绝：关闭 `db_deletion_protection`（AWS、Google Cloud 以及 Azure 上的锁）、Cloud Run 服务上的 `deletion_protection`，在 AWS 上决定是否保留最终 RDS 快照（`db_skip_final_snapshot`），apply 后再 destroy。已删除的 Cloud SQL 实例名称一周内不能重用。

## 无需云环境的验证

每个模块都在 `tests/` 下附带针对**模拟 provider** 运行的测试：真实的 provider 架构、虚构的值、无需凭据、不创建任何资源。它们固定了平台页面所依赖的接线——一个后端、8920 端口上的边缘、按引用传递的密钥、数据卷、自带资源的开关——CI 在每次变更时连同 `terraform validate` 和 `tflint` 一起运行。它们无法证明云会接受该计划；对真实账户的第一次 `terraform plan` 才是那项检查。OpenTofu 未经测试，但模块避免了所有 Terraform 独有的特性。

## 故障排除

| 现象 | 原因与处理 |
|---|---|
| `Error creating Service Networking Connection … already exists`（Google Cloud） | 该 VPC 已有私有服务访问。设置 `create_private_service_connection = false`。 |
| Google 托管证书一直处于 `PROVISIONING` | `public_url` 主机的 DNS A 记录尚未解析到 `load_balancer_ip`。修正 DNS 并等待；无需 apply。 |
| Cloud Run 上 `/app/data` 下出现 `Permission denied` | 共享不归用户 1000 所有——例如恢复之后。修改 `chown_job_token` 并 apply 以再次运行作业。 |
| `postgresql_delegated_subnet_id and postgresql_private_dns_zone_id must be set together`（Azure） | 私有访问需要二者同时设置；区域必须链接到 VNet，子网必须与环境所用子网不同。 |
| `db_host is required when create_database is false` | 自带数据库需要 `db_host` 和 `db_password`（`TF_VAR_db_password`）。 |
| `terraform destroy` 被拒绝 | 删除保护或 `CanNotDelete` 锁处于开启状态；参见*升级与删除*。 |
| 应用在平台 URL 上响应，但在 `public_url` 上不响应 | DNS 指向别处，或 `public_url` 仍写着平台 FQDN——改为最终源并 apply；会话 Cookie 绑定于它。 |
