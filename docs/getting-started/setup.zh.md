# 安装与配置

本指南将引导您使用 Docker 安装 Turbo EA、配置环境、加载演示数据以及启动 AI 和 MCP 服务器等可选服务。

## 前提条件

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

## 第 1 步：克隆和配置

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

在文本编辑器中打开 `.env` 并设置所需的值：

```dotenv
# PostgreSQL 凭据（由内置数据库容器使用）
POSTGRES_PASSWORD=选择一个强密码

# JWT 签名密钥 — 使用以下命令生成：
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=您生成的密钥

# 应用程序可用的端口
HOST_PORT=8920
```

## 第 2 步：选择数据库方案

### 方案 A：内置数据库（推荐入门使用）

`docker-compose.db.yml` 文件会启动一个 PostgreSQL 容器以及后端和前端。无需外部数据库 — 数据持久化在 Docker 卷中。

```bash
docker compose -f docker-compose.db.yml up --build -d
```

### 方案 B：外部 PostgreSQL

如果您已经有 PostgreSQL 服务器（托管数据库、独立容器或本地安装），请使用基础 `docker-compose.yml` 文件，该文件仅启动后端和前端。

首先，创建数据库和用户：

```sql
CREATE USER turboea WITH PASSWORD '您的密码';
CREATE DATABASE turboea OWNER turboea;
```

然后配置您的 `.env`：

```dotenv
POSTGRES_HOST=您的postgresql主机
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=您的密码
```

启动应用程序：

```bash
docker compose up --build -d
```

!!! note
    基础 `docker-compose.yml` 文件需要一个名为 `guac-net` 的 Docker 网络。如果不存在，请使用 `docker network create guac-net` 创建。

## 第 3 步：加载演示数据（可选）

Turbo EA 可以使用空元模型（仅包含 14 个内置卡片类型和关系类型）或完整的演示数据集启动。演示数据非常适合评估平台、开展培训或探索功能。

### 加载选项

在**首次启动之前**将这些变量添加到您的 `.env`：

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `SEED_DEMO` | `false` | 加载完整的 NexaTech Industries 演示数据集，包括 BPM 和 PPM |
| `SEED_BPM` | `false` | 仅加载 BPM 演示流程（需要基础演示数据已存在） |
| `SEED_PPM` | `false` | 仅加载 PPM 项目数据（需要基础演示数据已存在） |
| `RESET_DB` | `false` | 启动时删除所有表并从头重建 |

### 完整演示（推荐用于评估）

```dotenv
SEED_DEMO=true
```

这将通过一个设置加载整个 NexaTech Industries 数据集。您**不需要**单独设置 `SEED_BPM` 或 `SEED_PPM` — 它们会自动包含。

### 演示管理员账户

加载演示数据时，会自动创建一个默认管理员账户：

| 字段 | 值 |
|------|-----|
| **电子邮件** | `admin@turboea.demo` |
| **密码** | `TurboEA!2025` |
| **角色** | 管理员 |

!!! warning
    演示管理员账户使用已知凭据。在本地评估之外的任何环境中，请更改密码或创建自己的管理员账户。

### 演示数据包含的内容

NexaTech Industries 演示数据集包含约 150 张跨所有架构层的卡片：

**核心 EA 数据**（`SEED_DEMO=true` 时始终包含）：

- **组织** — 企业层级：NexaTech Industries 及其业务部门（工程、制造、销售与营销）、区域、团队和客户
- **业务能力** — 20 多个多层级能力
- **业务上下文** — 流程、价值流、客户旅程、业务产品
- **应用** — 15 个以上应用（NexaCore ERP、IoT 平台、Salesforce CRM 等），包含完整的生命周期和成本数据
- **IT 组件** — 20 多个基础设施项目（数据库、服务器、中间件、SaaS、AI 模型）
- **接口和数据对象** — API 定义和系统间数据流
- **平台** — 云和 IoT 平台及子类型
- **目标和举措** — 6 个不同审批状态的战略举措
- **标签** — 5 个标签组：业务价值、技术栈、生命周期状态、风险级别、监管范围
- **关系** — 60 多个跨所有层连接卡片的关系
- **EA 交付** — 架构决策记录和架构工作说明书

**BPM 数据**（`SEED_DEMO=true` 或 `SEED_BPM=true` 时包含）：

- 约 30 个业务流程，按 4 级层次结构组织（类别、组、流程、变体）
- BPMN 2.0 图表，包含提取的流程元素（任务、事件、网关、泳道）
- 元素到卡片的链接，将 BPMN 任务连接到应用、IT 组件和数据对象
- 流程评估，包含成熟度、有效性和合规性评分

**PPM 数据**（`SEED_DEMO=true` 或 `SEED_PPM=true` 时包含）：

- 6 个举措的状态报告，展示项目健康状况的时间变化
- 工作分解结构（WBS），包含层级分解和里程碑
- 约 60 个跨举措任务，包含状态、优先级、负责人和标签
- 预算行（按财年划分的资本支出/运营支出）和成本行（实际支出）
- 风险登记册，包含概率/影响评分和缓解计划

### 重置数据库

要清除所有内容并重新开始：

```dotenv
RESET_DB=true
SEED_DEMO=true
```

重启容器，然后**从 `.env` 中移除 `RESET_DB`** 以避免每次重启都重置：

```bash
docker compose -f docker-compose.db.yml up --build -d
# 确认运行正常后，从 .env 中移除 RESET_DB=true
```

## 第 4 步：可选服务

### AI 描述建议

Turbo EA 可以使用本地 LLM（Ollama）或商业提供商生成卡片描述。内置 Ollama 容器是最简单的入门方式。

添加到 `.env`：

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

使用 `ai` 配置启动：

```bash
docker compose -f docker-compose.db.yml --profile ai up --build -d
```

模型会在首次启动时自动下载（根据网络连接情况可能需要几分钟）。有关配置详情，请参阅 [AI 功能](../admin/ai.md)。

### MCP 服务器（AI 工具集成）

MCP 服务器允许 Claude Desktop、Cursor 和 GitHub Copilot 等 AI 工具查询您的 EA 数据。

```bash
docker compose -f docker-compose.db.yml --profile mcp up --build -d
```

有关配置和认证详情，请参阅 [MCP 集成](../admin/mcp.md)。

### 组合配置

您可以同时启用多个配置：

```bash
docker compose -f docker-compose.db.yml --profile ai --profile mcp up --build -d
```

## 快速参考：常用启动命令

| 场景 | 命令 |
|------|------|
| **最小启动**（内置数据库，空） | `docker compose -f docker-compose.db.yml up --build -d` |
| **完整演示**（内置数据库，全部数据） | 在 `.env` 中设置 `SEED_DEMO=true`，然后 `docker compose -f docker-compose.db.yml up --build -d` |
| **完整演示 + AI** | 在 `.env` 中设置 `SEED_DEMO=true` + AI 变量，然后 `docker compose -f docker-compose.db.yml --profile ai up --build -d` |
| **外部数据库** | 在 `.env` 中配置数据库变量，然后 `docker compose up --build -d` |
| **重置并重新加载** | 在 `.env` 中设置 `RESET_DB=true` + `SEED_DEMO=true`，重启，然后移除 `RESET_DB` |

## 后续步骤

- 在浏览器中打开 **http://localhost:8920**（或您配置的 `HOST_PORT`）
- 如果加载了演示数据，使用 `admin@turboea.demo` / `TurboEA!2025` 登录
- 否则，注册一个新账户 — 第一个用户自动获得**管理员**角色
- 浏览[仪表盘](../guide/dashboard.md)以获取 EA 全景概览
- 配置[元模型](../admin/metamodel.md)以自定义卡片类型和字段
