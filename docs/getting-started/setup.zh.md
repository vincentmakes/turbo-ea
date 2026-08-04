# 安装与配置

本指南将引导您使用 Docker 安装 Turbo EA、配置环境、加载演示数据，并启动可选服务，例如 AI 建议和 MCP 服务器。

## 前提条件

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

约 2 GB 的可用磁盘空间，首次拉取镜像需要几分钟带宽，主机上的端口 `8920`（HTTP）和可选的 `9443`（HTTPS）需空闲。

## 第 1 步：获取配置

您需要在工作目录中拥有 `docker-compose.yml` 和已配置的 `.env` 文件。最简单的方式是克隆仓库：

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

打开 `.env` 并设置两个必需的值：

```dotenv
# PostgreSQL 凭据（由内置数据库容器使用）。
# 选择一个强密码 — 它会持久保存在内置卷中。
POSTGRES_PASSWORD=choose-a-strong-password

# JWT 签名密钥。使用以下命令生成：
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=your-generated-secret
```

`.env.example` 中的其他所有内容都有合理的默认值。

!!! note
    后端在开发环境之外拒绝使用示例 `SECRET_KEY` 启动。请在继续之前生成一个真实的密钥。

## 第 2 步：拉取并启动

捆绑的栈（Postgres + 后端 + 前端 + 边缘 nginx）从 GHCR 上的预构建多架构镜像运行 — 无需本地构建：

```bash
docker compose pull
docker compose up -d
```

打开 **http://localhost:8920** 并注册第一个用户。第一个注册的用户会自动晋升为 **Admin**。

要更改主机端口，请在 `.env` 中设置 `HOST_PORT`（默认 `8920`）。直接 HTTPS 终止在 [第 5 步](#第-5-步直接-https可选) 中介绍。

## 第 3 步：加载演示数据（可选）

Turbo EA 可以以空状态启动（仅内置元模型）或加载 **NexaTech Industries** 演示数据集，非常适合评估、培训和探索功能。

在 `.env` 中**首次启动前**设置 seed 标志：

```dotenv
SEED_DEMO=true
```

然后 `docker compose up -d`（如果已经启动，请参阅下方的「重置并重新填充」）。

### 加载选项

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SEED_DEMO` | `false` | 加载完整的 NexaTech Industries 数据集，包括 BPM 和 PPM 数据 |
| `SEED_BPM` | `false` | 仅加载 BPM 演示流程（`SEED_DEMO` 的子集） |
| `SEED_PPM` | `false` | 仅加载 PPM 项目数据（`SEED_DEMO` 的子集） |
| `RESET_DB` | `false` | 启动时删除所有表并重新创建 |

`SEED_DEMO=true` 已经包含 BPM 和 PPM 数据 — 您不需要单独设置子集标志。

!!! note "演示数据只加载一次"
    每个加载器**每次安装只运行一次**并记录该状态。删除演示内容（示例图表、演示问卷）
    是永久性的：即使仍然设置了 `SEED_DEMO=true`，下次重启也不会恢复。若要重新获取
    演示数据集，请重置数据库（参见下文的「重置并重新加载」）。

### 演示管理员账户

加载演示数据时，会创建一个默认管理员账户：

| 字段 | 值 |
|------|-----|
| **邮箱** | `admin@turboea.demo` |
| **密码** | `TurboEA!2025` |
| **角色** | Admin |

!!! warning
    演示管理员账户使用已知的公开凭据。在本地评估之外的任何环境中，请更改密码 — 或创建您自己的管理员账户并禁用此账户。

### 演示数据包含的内容

约 150 张 cards 跨越所有四个架构层，外加关系、标签、评论、待办事项、BPM 图、PPM 数据、ADR 以及一份 Statement of Architecture Work：

- **核心 EA** — 组织、约 20 个业务能力、业务上下文、约 15 个应用、约 20 个 IT 组件、接口、数据对象、平台、目标、6 个倡议、5 个标签组、60+ 关系。
- **BPM** — 约 30 个业务流程，组织在 4 级层次结构中，包含 BPMN 2.0 图、元素到 card 的链接以及流程评估。
- **PPM** — 状态报告、Work Breakdown Structures、约 60 个任务、预算和成本明细，以及 6 个演示倡议的风险登记册。
- **EA Delivery** — Architecture Decision Records 和 Statements of Architecture Work。

### 重置并重新填充

要清除数据库并重新开始：

```dotenv
RESET_DB=true
SEED_DEMO=true
```

重启栈，然后**从 `.env` 中移除 `RESET_DB=true`** — 保持设置会在每次重启时重置数据库：

```bash
docker compose up -d
# 确认新数据存在后，编辑 .env 移除 RESET_DB
```

## 第 4 步：可选服务（Compose 配置文件）

两个附加组件都通过 Docker Compose 配置文件可选启用，与核心栈并行运行而不会干扰它。

### AI 描述建议

使用本地 LLM（捆绑的 Ollama）或商业提供商生成 card 描述。捆绑的 Ollama 容器是自托管设置最简单的方式。

添加到 `.env`：

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

使用 `ai` 配置文件启动：

```bash
docker compose --profile ai up -d
```

模型在首次启动时自动下载（几分钟，取决于您的连接）。请参阅 [AI 功能](../admin/ai.md) 获取完整的配置参考，包括如何使用 OpenAI / Gemini / Claude / DeepSeek 替代捆绑的 Ollama。

### MCP 服务器

MCP 服务器允许 AI 工具 — Claude Desktop、Cursor、GitHub Copilot 等 — 通过 [Model Context Protocol](https://modelcontextprotocol.io/) 查询您的 EA 数据，并按用户进行 RBAC 控制。只读。

```bash
docker compose --profile mcp up -d
```

请参阅 [MCP 集成](../admin/mcp.md) 获取 OAuth 设置和工具详细信息。

### 同时启用两者

```bash
docker compose --profile ai --profile mcp up -d
```

## 第 5 步：直接 HTTPS（可选）

捆绑的边缘 nginx 可以自行终止 TLS — 在没有外部反向代理时很有用。添加到 `.env`：

```dotenv
TURBO_EA_TLS_ENABLED=true
TLS_CERTS_DIR=./certs
TURBO_EA_TLS_CERT_FILE=cert.pem
TURBO_EA_TLS_KEY_FILE=key.pem
HOST_PORT=80
TLS_HOST_PORT=443
```

将 `cert.pem` 和 `key.pem` 放在 `./certs/` 中（该目录以只读方式挂载到 nginx 容器）。镜像从 `TURBO_EA_PUBLIC_URL` 派生 `server_name` 和转发的协议，同时提供 HTTP 和 HTTPS，并自动将 HTTP 重定向到 HTTPS。

对于位于现有反向代理（Caddy、Traefik、Cloudflare Tunnel）后的设置，保持 `TURBO_EA_TLS_ENABLED=false`，让代理处理 TLS。

## 允许嵌入图表（可选）

[已发布的图表](../guide/diagrams.md)可以嵌入到其他站点，例如 Confluence 页面或内网门户，但前提是你先指定该站点。默认情况下，任何外部站点都不能将 Turbo EA 放入框架中。

```dotenv
TURBO_EA_EMBED_ALLOWED_ORIGINS=https://yourcompany.atlassian.net
```

多个来源用逗号分隔。重启服务后更改才会生效。

该设置**仅**适用于已发布图表的页面。应用本身（包括图表编辑器）在任何情况下都不可被嵌入；即使不设置该项，已发布链接直接打开时依然可用。

## 锁定版本

`docker compose pull` 默认拉取 `:latest`。要在生产中锁定特定版本，请设置 `TURBO_EA_TAG`：

```bash
TURBO_EA_TAG=1.0.0 docker compose up -d
```

发布的版本被标记为 `:<full-version>`、`:<major>.<minor>`、`:<major>` 和 `:latest`。发布工作流将预发布版本（`-rc.N`）从 `:latest` 以及短标签 `:X.Y` / `:X` 中排除。请参阅 [版本发布](../reference/releases.md) 获取完整的标签树和预发布渠道策略。

## 使用现有 PostgreSQL

如果您已经运行托管或共享的 PostgreSQL 实例，请将后端指向它并跳过捆绑的 `db` 服务。

在现有服务器上创建数据库和用户：

```sql
CREATE USER turboea WITH PASSWORD 'your-password';
CREATE DATABASE turboea OWNER turboea;
```

在 `.env` 中覆盖连接变量：

```dotenv
POSTGRES_HOST=your-postgres-host
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=your-password
```

然后照常启动：`docker compose up -d`。捆绑的 `db` 服务仍在 `docker-compose.yml` 中定义；您可以让它空闲运行，也可以显式停止它。

### 连接预算

后端以单个进程运行，最多打开 **`DB_POOL_SIZE + DB_MAX_OVERFLOW` 个连接（默认为 30）**。捆绑的 `db` 服务允许 100 个连接，因此默认值在那里从不会造成问题。低价套餐的托管实例通常会将数据库限制在远低于 30，此时 PostgreSQL 会返回：

```
too many connections for database "turboea"
```

切换前请检查您的限制：

```sql
SELECT datname, datconnlimit FROM pg_database WHERE datname = 'turboea';
SELECT rolname, rolconnlimit FROM pg_roles    WHERE rolname = 'turboea';
SHOW max_connections;
```

`datconnlimit` 或 `rolconnlimit` 为 `-1` 表示「无特定限制」；任何低于 30 的值都需要提高上限或缩小连接池：

```dotenv
DB_POOL_SIZE=8
DB_MAX_OVERFLOW=2
DB_POOL_TIMEOUT=30
```

连接池变小意味着并发处理的请求变少，而不是请求丢失：连接池占满后，请求最多等待 `DB_POOL_TIMEOUT` 秒以获得空闲连接。请为备份和您自己的 `psql` 会话留出几个连接。

## 验证镜像

从 `1.0.0` 起，每个发布的镜像都使用 cosign 无密钥 OIDC 签名，并附带 buildkit 生成的 SPDX SBOM。请参阅 [供应链](../admin/supply-chain.md) 获取验证命令以及如何从注册表拉取 SBOM。

## 从源代码开发

如果您想从源代码构建栈（修改后端或前端代码），请使用开发 Compose 覆盖：

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d --build
```

或使用便捷目标：

```bash
make up-dev
```

完整的开发者指南 — 分支命名、lint 和测试命令、pre-commit 检查 — 在 [CONTRIBUTING.md](https://github.com/vincentmakes/turbo-ea/blob/main/CONTRIBUTING.md) 中。

## 快速参考

| 场景 | 命令 |
|------|------|
| 首次启动（空数据） | `docker compose pull && docker compose up -d` |
| 首次启动加载演示数据 | 在 `.env` 中设置 `SEED_DEMO=true`，然后执行同样的命令 |
| 添加 AI 建议 | 添加 AI 变量，然后 `docker compose --profile ai up -d` |
| 添加 MCP 服务器 | `docker compose --profile mcp up -d` |
| 锁定版本 | `TURBO_EA_TAG=1.0.0 docker compose up -d` |
| 重置并重新填充 | `RESET_DB=true` + `SEED_DEMO=true`，重启，然后移除 `RESET_DB` |
| 使用外部 Postgres | 在 `.env` 中覆盖 `POSTGRES_*` 变量，然后 `docker compose up -d` |
| 从源代码构建 | `make up-dev` |

## 后续步骤

- 打开 **http://localhost:8920**（或您配置的 `HOST_PORT`）并登录。如果加载了演示数据，使用 `admin@turboea.demo` / `TurboEA!2025`。否则，注册 — 第一个用户会自动晋升为 Admin。
- 浏览 [仪表盘](../guide/dashboard.md) 以概览您的 EA 全景。
- 自定义 [card 类型和字段](../admin/metamodel.md) — 元模型完全由数据驱动，无需代码更改。
- 对于生产部署，请查阅 [兼容性政策](../reference/compatibility.md) 和 [供应链](../admin/supply-chain.md)。
