# MCP 集成（AI 工具访问）

Turbo EA 内置了一个 **MCP 服务器**（Model Context Protocol），允许 AI 工具（如 Claude Desktop、GitHub Copilot、Cursor 和 VS Code）直接查询并更新您的 EA 数据。AI 工具还可以上传工件（电子表格、BPMN 图、DrawIO 图、自由文档），并将其转化为符合现有元模型的卡片、关系和图表。用户通过现有的 SSO 提供商进行身份验证，每个操作都遵循其个人权限。

此功能是**可选的**，**不会自动启动**。它要求 SSO 已配置、MCP 配置文件在 Docker Compose 中已激活，并且管理员在设置界面中启用了它。

---

## 工作原理

```
AI 工具（Claude、Copilot 等）
    │
    │  MCP 协议（streamable HTTP）
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
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp`（docker compose） | MCP 服务器的公共 URL（用于 OAuth 重定向 URI）。单独运行容器时，代码默认值为 `http://localhost:8001` |
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
      "url": "https://your-domain.example.com/mcp"
    }
  }
}
```

请使用 `https://your-domain.example.com/mcp` 作为端点。旧的双重形式 `https://your-domain.example.com/mcp/mcp` 仍然有效，因此现有连接器无需更改即可继续正常工作。

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

MCP 服务器提供 **47 个工具**，分为两组：**30 个读取工具** 用于查询 EA 数据，**17 个写入工具**（13 个增量型、4 个破坏型）用于创建和维护卡片、关系、图表、风险、ADR 等——包括将 AI 工具上下文中的工件（电子表格、BPMN XML、DrawIO XML、文档、图像）转换为结构化的 EA 数据。每个工具都带有 MCP `ToolAnnotations`（只读 / 破坏性 / 幂等提示），以便连接器在其界面中呈现破坏性程度。

### 写入操作的演练安全机制

每个写入工具默认使用 **`dry_run=true`**。在此模式下，后端会运行每一个校验器和解析器，构建完整计划，然后**回滚事务**，因此不会持久化任何内容。AI 工具会将预览返回给用户；只有在用户明确确认后，才应再次以 `dry_run=false` 调用该工具进行提交。这可以防止过于热心的代理在解读错误的电子表格基础上悄悄创建数百张卡片。

### 读取工具

服务器以八个集群提供 30 个读取工具。

**卡片与元模型**

| 工具 | 描述 |
|------|------|
| `search_cards` | 按类型、状态或自由文本搜索和筛选卡片 |
| `get_card` | 通过 UUID 获取卡片的完整详细信息 |
| `get_card_relations` | 获取连接到卡片的所有关系 |
| `get_card_hierarchy` | 获取卡片的祖先和子级 |
| `list_card_types` | 列出元模型中的所有卡片类型 |
| `get_relation_types` | 列出关系类型，可按卡片类型筛选 |
| `resolve_card_refs` | 在批量导入之前预校验基于名称的卡片引用（名称 → UUID）——仅解析，从不写入 |
| `analyze_impact` | 针对卡片的一项拟议变更进行依赖影响范围分析 |

**仪表盘**

| 工具 | 描述 |
|------|------|
| `get_dashboard` | KPI 仪表盘（计数、数据质量、审批、活动） |
| `get_landscape` | 某一类型的卡片按相关类型分组 |

**GRC — 风险登记册**

| 工具 | 描述 |
|------|------|
| `list_risks` | 分页可筛选的 EA 风险列表（TOGAF G 阶段） |
| `get_risk` | 单条风险详情，含关联卡片与审计轨迹 |
| `get_risk_metrics` | KPI + 初始与残余 4×4 矩阵 |
| `get_card_risks` | 当前与某卡片关联的所有风险 |

**GRC — 合规**

| 工具 | 描述 |
|------|------|
| `list_compliance_findings` | 按法规分组的合规发现 |
| `get_compliance_overview` | 合规评分 + 各法规状态矩阵 + 最近扫描元数据 |

**治理与交付**

| 工具 | 描述 |
|------|------|
| `list_principles` | 已发布的 EA 原则（声明、依据、影响） |
| `list_adrs` | 架构决策记录，可按举措 / 状态筛选 |
| `get_adr` | 单条 ADR，含章节、关联卡片与签署记录 |
| `list_soaws` | 某项举措的架构工作说明书 |

**报告**

| 工具 | 描述 |
|------|------|
| `get_portfolio_report` | 某卡片类型的气泡图数据（默认：功能契合 × 技术契合） |
| `get_cost_treemap` | 成本树形图，可选按相关类型分组 |
| `get_capability_heatmap` | 业务能力的层次热图 |
| `get_data_quality_report` | 按卡片类型的完整度分布 |

**卡片上下文**

| 工具 | 描述 |
|------|------|
| `get_card_stakeholders` | 卡片上分配的用户与角色 |
| `get_card_comments` | 卡片的评论线程 |
| `get_card_documents` | 附加到卡片的文档链接（URL，非文件） |

**图表**

| 工具 | 描述 |
|------|------|
| `list_diagrams` | 列出自由绘制的（DrawIO）图表，可选按某一卡片筛选 |
| `get_diagram` | 按 id 获取单个图表，包含其 DrawIO XML |

**审计与变更历史**

| 工具 | 描述 |
|------|------|
| `get_change_history` | 查询变更批次台账（按批次 id、操作者、工具或来源），以精确重建先前某次 MCP 提交所做的更改 |

所有工具都尊重已登录用户的 RBAC——查看者对其无权访问的范围只会得到空列表（或 403）；MCP 层无需任何按工具的配置。

### 写入工具

服务器提供 17 个写入工具，每个都标注为**增量型**（创建或扩展数据）或**破坏型**（修改或删除现有数据），以便连接器给出相应的警示。

**增量型（13 个）**

| 工具 | 描述 |
|------|------|
| `create_cards_bulk` | 在一次调用中创建多张卡片（例如电子表格的多行）。支持同一批次内按名称引用父卡片，服务端执行拓扑排序。 |
| `transition_card_lifecycle` | 推动卡片经过审批或生命周期各阶段。 |
| `create_risks` | 在 EA 风险登记册中创建条目。 |
| `update_risks` | 更新风险登记册条目（字段、关联卡片）。 |
| `add_card_comment` | 在卡片上发表评论——一种非破坏性、可审阅的备注，而不是直接修改字段。 |
| `create_soaw` | 为某项举措创建架构工作说明书。 |
| `assign_stakeholders` | 在卡片上分配或移除干系人角色。 |
| `update_cards_bulk` | 在一次调用中对多张卡片进行字段级修补。 |
| `create_adr` | 创建架构决策记录。 |
| `update_adr` | 更新 ADR（标题、章节、状态、关联卡片）。 |
| `sign_adr` | 签署 ADR（需要 `adr.sign` 权限；否则返回一个界面深层链接，供在浏览器中签署）。 |
| `create_diagram` | 创建一个自由形式的 DrawIO 图，可选链接到已有卡片。 |
| `import_bpmn` | 将 BPMN 2.0 XML 图保存到**已存在**的业务流程卡片上。如果没有匹配指定名称的卡片，工具会返回 `card_not_found` 错误，引导代理使用 `create_cards_bulk` — 这迫使先以完整的描述、子类型和属性显式创建卡片，而不是走捷径生成一张内容稀薄的卡片。 |

**破坏型（4 个）**

| 工具 | 描述 |
|------|------|
| `upsert_relations_bulk` | 创建或删除卡片之间的关系。源 / 目标 / 类型会与元模型进行校验。除非运营者显式启用，否则删除操作会被拒绝（见防护栏）。 |
| `archive_cards` | 归档卡片（软删除）。可恢复——归档的卡片在自动清除前可在 30 天内还原。 |
| `update_diagram` | 替换图表的 DrawIO XML、名称或卡片链接。 |
| `rollback_batch` | 撤销先前某个变更批次下执行的写入。 |

### 工件上传

写入工具的一个子集（`create_cards_bulk`、`upsert_relations_bulk`、`create_diagram`、`import_bpmn`）让 AI 代理将工件转化为结构化的 EA 数据。代理在其自身上下文中读取源文件（多模态视觉、附件），提取结构化的行，然后调用这些工具。MCP 服务器本身从不解析文件——它期望已经结构化的输入。

当用户与 AI 代理共享电子表格时的典型流程：

1. 代理调用 `list_card_types` 和 `get_relation_types` 来理解元模型。
2. 代理解析电子表格（在它自己的上下文中，而不是在 MCP 中），并构建行字典。
3. 代理调用 `create_cards_bulk(cards=…, dry_run=True)`，并向用户展示预览。
4. 用户确认后，代理再以 `dry_run=False` 调用一次以提交。
5. 如果存在关系列，代理随后以相同的 演练 / 确认 循环调用 `upsert_relations_bulk`。

### 写入工具防护栏

在演练之上的纵深防御，以确保 LLM 失误不会造成大规模损害：

- **每次调用的大小上限。** MCP 写入工具强制施加比底层 Excel 导入端点小得多的上限：`create_cards_bulk` 为 200 行，`upsert_relations_bulk` 为 500 次操作。足以应对任何实际的单一工件上传，又小到可以快速扫描演练预览。
- **默认不允许删除关系。** `upsert_relations_bulk` 拒绝 `action: "delete"` 操作——若要删除关系，请使用 Web 界面，那里的操作会以用户身份被记录。运营者可通过设置 `MCP_ALLOW_RELATION_DELETE=true` 启用此功能。
- **紧急开关。** `MCP_WRITES_ENABLED=false` 可在无需重新部署代码的情况下关闭全部 17 个写入工具。30 个读取工具继续工作。
- **审计来源标记。** 来自 MCP 服务器的每个后端请求都携带 `X-Turbo-EA-Origin: mcp` 头。从这些请求发出的事件在审计日志载荷中被标记为 `origin: "mcp"`，以便管理员可以将 MCP 驱动的写入与 Web 界面操作分别从时间线中筛选出来。
- **变更批次。** 每次 MCP 写入调用都会在任何写入发生之前打开一个变更批次；调用期间发出的每个事件都会被标记上批次 id。管理员（或 `get_change_history` 工具）可以凭一个 id 重建某次提交的完整逐事件差异，而 `rollback_batch` 可以将其撤销。超过 `MCP_BATCH_CONFIRMATION_THRESHOLD` 行的提交必须回传由先前演练签发的一次性 `confirm_token`（15 分钟有效期），因此大型提交总是先经过一次经审阅的预览。
- **没有硬删除。** 工具集刻意省略了卡片的永久删除。`archive_cards` 和 `update_cards_bulk` *确实*已暴露，但归档是可恢复的软删除（30 天还原窗口），且两者都带有破坏性标注并受演练机制约束。添加任何执行不可逆变更的工具（硬删除、强制清除）都需要进行明确的设计评审。

MCP 容器上的六个防护栏环境变量：

| 变量 | 默认 | 作用 |
|------|------|------|
| `MCP_WRITES_ENABLED` | `true` | 写入工具的总开关。`false` → 只读 MCP。 |
| `MCP_MAX_CARDS_PER_CALL` | `200` | 每次请求 `create_cards_bulk` / `update_cards_bulk` 行数的硬性上限。 |
| `MCP_MAX_RELATIONS_PER_CALL` | `500` | 每次请求 `upsert_relations_bulk` 操作数的硬性上限。 |
| `MCP_ALLOW_RELATION_DELETE` | `false` | 当为 `true` 时，`upsert_relations_bulk` 接受 `action: "delete"` 操作。 |
| `MCP_BATCH_CONFIRMATION_THRESHOLD` | `20` | 涉及行数超过此值的提交需要出示先前演练签发的 `confirm_token`。 |
| `MCP_REQUIRE_DRYRUN_FIRST` | `true` | 启用上述确认令牌门槛。仅在受信任的、明确跳过预览环节的自动化流水线中设置为 `false`。 |

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
| **管理员** | 配置 MCP 设置（`admin.mcp` 权限）。通过 MCP 拥有完整的读取 + 写入访问。 |
| **所有已认证用户** | 读取访问由其现有 RBAC 控制。写入工具需要相应的后端权限——`inventory.create` / `inventory.edit` / `inventory.archive`（卡片）、`relations.manage`（关系）、`diagrams.manage`（图表）、`bpm.edit`（BPMN）、`risks.manage`（风险登记册）、`comments.create`（评论）、`stakeholders.manage`（干系人）、`soaw.create`（SoAW）、`adr.create` / `adr.sign`（ADR）。 |

`admin.mcp` 权限控制谁可以管理 MCP 设置。默认情况下仅对管理员角色可用。可以通过角色管理页面向自定义角色授予此权限。

通过 MCP 访问数据——无论是读取还是写入——都遵循与 Web 界面相同的 RBAC 模型。如果用户无法在库存界面中创建卡片，那么也无法通过 MCP 创建；没有单独的 MCP 特定数据权限。

---

## 安全性

- **SSO 委托认证**：用户通过企业 SSO 提供商进行身份验证。MCP 服务器从不接触或存储密码。
- **OAuth 2.1 + PKCE**：认证流程使用代码交换证明密钥（S256）来防止授权码拦截。
- **按用户 RBAC**：每次 MCP 操作——无论是读取还是写入——都使用已认证用户的权限执行。没有共享服务账户。
- **写入默认演练**：写入工具默认采用 校验后回滚 的预览模式。AI 工具必须再次显式以 `dry_run=false` 调用，数据才会被持久化，且每次更改都在该用户身份下进行审计。
- **MCP 中不解析文件**：MCP 服务器本身不接收 PDF、Excel 文件、图像或其他二进制工件。调用方 AI 工具在其自身上下文中解析它们，并发送结构化的行。这样可以保持较小的攻击面，避免服务器暴露于格式不规范的二进制输入。
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
