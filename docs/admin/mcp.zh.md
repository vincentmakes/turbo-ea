# MCP 集成（AI 工具访问）

Turbo EA 内置了一个 **MCP 服务器**（Model Context Protocol），允许 AI 工具（如 Claude Desktop、GitHub Copilot、Cursor 和 VS Code）直接查询您的 EA 数据。用户通过现有的 SSO 提供商进行身份验证，每个查询都遵循其个人权限。

此功能是**可选的**，**不会自动启动**。它要求 SSO 已配置、MCP 配置文件在 Docker Compose 中已激活，并且管理员在设置界面中启用了它。

---

## 工作原理

```
AI 工具（Claude、Copilot 等）
    │
    │  MCP 协议（HTTP + SSE）
    ▼
Turbo EA MCP 服务器（:8001，内部）
    │
    │  OAuth 2.1 + PKCE
    │  委托给 SSO 提供商
    ▼
Turbo EA 后端（:8000）
    │
    │  按用户 RBAC
    ▼
PostgreSQL
```

1. 用户将 MCP 服务器 URL 添加到其 AI 工具中。
2. 首次连接时，AI 工具会打开浏览器窗口进行 SSO 身份验证。
3. 登录后，MCP 服务器颁发自己的访问令牌（由用户的 Turbo EA JWT 支持）。
4. AI 工具使用此令牌进行所有后续请求。令牌会自动刷新。
5. 每个查询都通过 Turbo EA 的正常权限系统——用户只能看到他们有权访问的数据。

---

## 前提条件

启用 MCP 之前，您必须具备：

- **已配置且正常运行的 SSO** —— MCP 将身份验证委托给您的 SSO 提供商（Microsoft Entra ID、Google Workspace、Okta 或通用 OIDC）。请参阅[认证与 SSO 指南](sso.md)。
- **具有公共域名的 HTTPS** —— OAuth 流程需要稳定的重定向 URI。请将 Turbo EA 部署在 TLS 终止反向代理（Caddy、Traefik、Cloudflare Tunnel 等）后面。

---

## 设置

### 步骤 1：启动 MCP 服务

MCP 服务器是一个可选的 Docker Compose 配置文件。在启动命令中添加 `--profile mcp`：

```bash
docker compose --profile mcp up --build -d
```

这将在后端和前端旁边启动一个轻量级 Python 容器（端口 8001，仅内部）。Nginx 会自动将 `/mcp/` 请求代理到该服务。

### 步骤 2：配置环境变量

将以下内容添加到 `.env` 文件中：

```dotenv
TURBO_EA_PUBLIC_URL=https://your-domain.example.com
MCP_PUBLIC_URL=https://your-domain.example.com/mcp
```

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | Turbo EA 实例的公共 URL |
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` | MCP 服务器的公共 URL（用于 OAuth 重定向 URI） |
| `MCP_PORT` | `8001` | MCP 容器的内部端口（很少需要更改） |

### 步骤 3：将 OAuth 重定向 URI 添加到 SSO 应用

在 SSO 提供商的应用注册中（与您为 Turbo EA 登录设置的相同），添加此重定向 URI：

```
https://your-domain.example.com/mcp/oauth/callback
```

这是用户从 AI 工具连接时 OAuth 认证流程所必需的。

### 步骤 4：在管理设置中启用 MCP

1. 前往管理区域的**设置**，并选择 **AI** 选项卡。
2. 滚动到 **MCP 集成（AI 工具访问）**部分。
3. 切换开关以**启用** MCP。
4. 界面将显示 MCP 服务器 URL 和设置说明，供您与团队共享。

!!! warning
    如果未配置 SSO，开关将被禁用。请先设置 SSO。

---

## 连接 AI 工具

启用 MCP 后，将 **MCP 服务器 URL** 分享给您的团队。每个用户将其添加到自己的 AI 工具中：

### Claude Desktop

1. 打开**设置 > 连接器 > 添加自定义连接器**。
2. 输入 MCP 服务器 URL：`https://your-domain.example.com/mcp`
3. 点击**连接** —— 浏览器窗口将打开进行 SSO 登录。
4. 认证后，Claude 即可查询您的 EA 数据。

### VS Code（GitHub Copilot / Cursor）

添加到工作区的 `.vscode/mcp.json`：

```json
{
  "servers": {
    "turbo-ea": {
      "type": "http",
      "url": "https://your-domain.example.com/mcp/mcp"
    }
  }
}
```

双重 `/mcp/mcp` 是有意的——第一个 `/mcp/` 是 Nginx 代理路径，第二个是 MCP 协议端点。

---

## 本地测试（stdio 模式）

对于不需要 SSO/HTTPS 的本地开发或测试，可以在 **stdio 模式**下运行 MCP 服务器——Claude Desktop 直接将其作为本地进程启动。

**1. 安装 MCP 服务器包：**

```bash
pip install ./mcp-server
```

**2. 添加到 Claude Desktop 配置**（`claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "turbo-ea": {
      "command": "python",
      "args": ["-m", "turbo_ea_mcp", "--stdio"],
      "env": {
        "TURBO_EA_URL": "http://localhost:8000",
        "TURBO_EA_EMAIL": "your@email.com",
        "TURBO_EA_PASSWORD": "your-password"
      }
    }
  }
}
```

在此模式下，服务器使用邮箱/密码进行身份验证，并在后台自动刷新令牌。

---

## 可用功能

MCP 服务器提供对 EA 数据的**只读**访问。它不能创建、修改或删除任何内容。

### 工具

| 工具 | 描述 |
|------|------|
| `search_cards` | 按类型、状态或自由文本搜索和筛选卡片 |
| `get_card` | 通过 UUID 获取卡片的完整详细信息 |
| `get_card_relations` | 获取连接到卡片的所有关系 |
| `get_card_hierarchy` | 获取卡片的祖先和子级 |
| `list_card_types` | 列出元模型中的所有卡片类型 |
| `get_relation_types` | 列出关系类型，可按卡片类型筛选 |
| `get_dashboard` | 获取 KPI 仪表盘数据（计数、数据质量、审批） |
| `get_landscape` | 获取按相关类型分组的卡片 |

### 资源

| URI | 描述 |
|-----|------|
| `turbo-ea://types` | 元模型中的所有卡片类型 |
| `turbo-ea://relation-types` | 所有关系类型 |
| `turbo-ea://dashboard` | 仪表盘 KPI 和汇总统计 |

### 引导提示

| 提示 | 描述 |
|------|------|
| `analyze_landscape` | 多步分析：仪表盘概览、类型、关系 |
| `find_card` | 按名称搜索卡片，获取详细信息和关系 |
| `explore_dependencies` | 映射卡片的依赖关系 |

---

## 权限

| 角色 | 访问权限 |
|------|----------|
| **管理员** | 配置 MCP 设置（`admin.mcp` 权限） |
| **所有已认证用户** | 通过 MCP 服务器查询 EA 数据（遵循其现有的卡片级和系统级权限） |

`admin.mcp` 权限控制谁可以管理 MCP 设置。默认情况下仅对管理员角色可用。可以通过角色管理页面向自定义角色授予此权限。

通过 MCP 访问数据遵循与 Web 界面相同的 RBAC 模型——没有单独的 MCP 特定数据权限。

---

## 安全性

- **SSO 委托认证**：用户通过企业 SSO 提供商进行身份验证。MCP 服务器从不接触或存储密码。
- **OAuth 2.1 + PKCE**：认证流程使用代码交换证明密钥（S256）来防止授权码拦截。
- **按用户 RBAC**：每个 MCP 查询都使用已认证用户的权限执行。没有共享服务账户。
- **只读访问**：MCP 服务器只能读取数据。不能创建、更新或删除卡片、关系或任何其他资源。
- **令牌轮换**：访问令牌在 1 小时后过期。刷新令牌有效期为 30 天。授权码为一次性使用，10 分钟后过期。
- **仅内部端口**：MCP 容器仅在 Docker 内部网络上暴露端口 8001。所有外部访问都通过 Nginx 反向代理。

---

## 故障排除

| 问题 | 解决方案 |
|------|----------|
| 设置中 MCP 开关被禁用 | 必须先配置 SSO。前往设置 > 认证选项卡并设置 SSO 提供商。 |
| Nginx 日志中出现「host not found」 | MCP 服务未运行。使用 `docker compose --profile mcp up -d` 启动它。Nginx 配置优雅地处理此情况（502 响应，无崩溃）。 |
| OAuth 回调失败 | 验证是否已将 `https://your-domain.example.com/mcp/oauth/callback` 添加为 SSO 应用注册中的重定向 URI。 |
| AI 工具无法连接 | 检查 `MCP_PUBLIC_URL` 是否与用户机器可访问的 URL 匹配。确保 HTTPS 正常工作。 |
| 用户获得空结果 | MCP 遵循 RBAC 权限。如果用户访问受限，他们只能看到其角色允许的卡片。 |
| 连接在 1 小时后断开 | AI 工具应自动处理令牌刷新。如果不行，请重新连接。 |
