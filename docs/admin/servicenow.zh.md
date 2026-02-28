# ServiceNow 集成

ServiceNow 集成（**管理 > 设置 > ServiceNow**）实现 Turbo EA 与 ServiceNow CMDB 之间的双向同步。本指南涵盖从初始设置到高级方案和运维最佳实践的所有内容。

## 为什么要将 ServiceNow 与 Turbo EA 集成？

ServiceNow CMDB 和企业架构工具服务于不同但互补的目的：

| | ServiceNow CMDB | Turbo EA |
|--|-----------------|----------|
| **关注点** | IT 运维 —— 正在运行什么、谁负责、发生了什么事件 | 战略规划 —— 未来 3 年的架构应该是什么样子？ |
| **维护者** | IT 运维、资产管理 | EA 团队、业务架构师 |
| **优势** | 自动发现、ITSM 工作流、运维准确性 | 业务上下文、能力映射、生命周期规划、评估 |
| **典型数据** | 主机名、IP、安装状态、分配组、合同 | 业务关键性、功能适用性、技术债务、战略路线图 |

**Turbo EA 是架构的权威记录系统** —— 名称、描述、生命周期计划、评估和业务上下文都在这里管理。ServiceNow 用运维和技术元数据（主机名、IP、SLA 数据、安装状态）补充 Turbo EA，这些数据来自自动发现和 ITSM 工作流。集成保持两个系统的连接，同时尊重 Turbo EA 的主导地位。

### 您可以做什么

- **拉取同步** —— 从 ServiceNow 向 Turbo EA 导入 CI，然后接管所有权。后续拉取仅更新 SNOW 自动发现的运维字段（IP、状态、SLA）
- **推送同步** —— 将 EA 维护的数据推回 ServiceNow（名称、描述、评估、生命周期计划），以便 ITSM 团队看到 EA 上下文
- **双向同步** —— Turbo EA 主导大多数字段；SNOW 主导一小部分运维/技术字段。两个系统保持同步
- **身份映射** —— 持久的交叉引用跟踪（sys_id <-> card UUID）确保记录在同步之间保持链接

---

## 集成架构

```
+------------------+         HTTPS / Table API          +------------------+
|   Turbo EA       | <--------------------------------> |  ServiceNow      |
|                  |                                     |                  |
|  Cards           |  Pull: SNOW CIs -> Turbo Cards      |  CMDB CIs        |
|  (Application,   |  Push: Turbo Cards -> SNOW CIs      |  (cmdb_ci_appl,  |
|   ITComponent,   |                                     |   cmdb_ci_server, |
|   Provider, ...) |  Identity Map tracks sys_id <-> UUID |   core_company)  |
+------------------+                                     +------------------+
```

集成使用 ServiceNow 的 Table API 通过 HTTPS 通信。凭据使用从 `SECRET_KEY` 派生的 Fernet（AES-128-CBC）加密存储。所有同步操作作为带有 `source: "servicenow_sync"` 的事件记录，提供完整的审计轨迹。

---

## 规划您的集成

在配置任何内容之前，回答以下问题：

### 1. 哪些卡片类型需要 ServiceNow 的数据？

从小规模开始。最常见的集成点是：

| 优先级 | Turbo EA 类型 | ServiceNow 来源 | 原因 |
|--------|---------------|-----------------|------|
| **高** | 应用程序 | `cmdb_ci_business_app` | 应用程序是 EA 的核心 —— CMDB 有权威的名称、所有者和状态 |
| **高** | IT 组件（软件） | `cmdb_ci_spkg` | 软件产品馈入 EOL 跟踪和技术雷达 |
| **中** | IT 组件（硬件） | `cmdb_ci_server` | 基础设施映射的服务器架构 |
| **中** | 供应商 | `core_company` | 成本和关系管理的供应商注册表 |
| **低** | 接口 | `cmdb_ci_endpoint` | 集成端点（通常在 EA 中手动维护） |
| **低** | 数据对象 | `cmdb_ci_database` | 数据库实例 |

### 2. 每个字段的权威来源是哪个系统？

这是最重要的决策。默认应该是 **Turbo EA 主导** —— EA 工具是架构的权威记录系统。ServiceNow 应该仅对来自自动发现或 ITSM 工作流的少量运维和技术字段拥有主导权。其他所有内容 —— 名称、描述、评估、生命周期规划、成本 —— 由 EA 团队在 Turbo EA 中拥有和维护。

**推荐模型 —— 「Turbo EA 主导，SNOW 补充」：**

| 字段类型 | 权威来源 | 原因 |
|----------|----------|------|
| **名称和描述** | **Turbo 主导** | EA 团队维护权威名称并编写战略描述；CMDB 名称可能混乱或自动生成 |
| **业务关键性** | **Turbo 主导** | EA 团队的战略评估 —— 不是运维数据 |
| **功能/技术适用性** | **Turbo 主导** | TIME 模型评分是 EA 关注的事项 |
| **生命周期（所有阶段）** | **Turbo 主导** | 规划、引入、活跃、淘汰、生命周期结束 —— 都是 EA 规划数据 |
| **成本数据** | **Turbo 主导** | EA 跟踪总拥有成本；CMDB 可能有合同行项目，但 EA 拥有整合视图 |
| **托管类型、分类** | **Turbo 主导** | EA 按托管模型分类应用程序用于战略分析 |
| **技术元数据** | SNOW 主导 | IP、操作系统版本、主机名、序列号 —— EA 不维护的自动发现数据 |
| **SLA/运维状态** | SNOW 主导 | 安装状态、SLA 目标、可用性指标 —— ITSM 运维数据 |
| **分配组/支持** | SNOW 主导 | ServiceNow 工作流中跟踪的运维所有权 |
| **发现日期** | SNOW 主导 | 首次/最后发现、最后扫描 —— CMDB 自动化元数据 |

### 3. 应该多久同步一次？

| 场景 | 频率 | 说明 |
|------|------|------|
| 初始导入 | 一次 | 追加模式，仔细审查 |
| 活跃架构管理 | 每天 | 非工作时间通过 cron 自动化 |
| 合规报告 | 每周 | 生成报告前 |
| 临时 | 按需 | 重大 EA 评审或演示前 |

---

## 步骤 1：ServiceNow 先决条件

### 创建服务账户

在 ServiceNow 中，创建专用的服务账户（不要使用个人账户）：

| 角色 | 目的 | 是否必需？ |
|------|------|-----------|
| `itil` | CMDB 表的读取权限 | 是 |
| `cmdb_read` | 读取配置项 | 是 |
| `rest_api_explorer` | 有助于测试查询 | 推荐 |
| `import_admin` | 目标表的写入权限 | 仅推送同步需要 |

**最佳实践**：创建自定义角色，仅对您计划同步的特定表具有只读访问权限。`itil` 角色范围较广 —— 自定义范围角色限制影响范围。

### 网络要求

- Turbo EA 后端必须能通过 HTTPS（端口 443）访问您的 SNOW 实例
- 配置防火墙规则和 IP 白名单
- 实例 URL 格式：`https://company.service-now.com` 或 `https://company.servicenowservices.com`

### 选择认证方式

| 方式 | 优点 | 缺点 | 推荐 |
|------|------|------|------|
| **Basic Auth** | 设置简单 | 每次请求发送凭据 | 仅用于开发/测试 |
| **OAuth 2.0** | 基于令牌、有范围限制、审计友好 | 设置步骤更多 | **推荐用于生产环境** |

对于 OAuth 2.0：
1. 在 ServiceNow 中：**System OAuth > Application Registry**
2. 为外部客户端创建新的 OAuth API 端点
3. 记下客户端 ID 和客户端密钥
4. 每 90 天轮换密钥

---

## 步骤 2：创建连接

导航到**管理 > ServiceNow > 连接**标签页。

### 创建和测试

1. 点击**添加连接**
2. 填写：

| 字段 | 示例值 | 说明 |
|------|--------|------|
| 名称 | `生产 CMDB` | 团队的描述性标签 |
| 实例 URL | `https://company.service-now.com` | 必须使用 HTTPS |
| 认证类型 | Basic Auth 或 OAuth 2.0 | 生产推荐 OAuth |
| 凭据 | （按认证类型） | 通过 Fernet 加密存储 |

3. 点击**创建**，然后点击**测试图标**（wifi 符号）验证连接

- **绿色「已连接」芯片** —— 准备就绪
- **红色「失败」芯片** —— 检查凭据、网络和 URL

### 多个连接

您可以为以下情况创建多个连接：
- **生产**与**开发**实例
- **区域** SNOW 实例（例如 EMEA、APAC）
- 具有独立服务账户的**不同团队**

每个映射引用一个特定的连接。

---

## 步骤 3：设计映射

切换到**映射**标签页。映射将一个 Turbo EA 卡片类型连接到一个 ServiceNow 表。

### 创建映射

点击**添加映射**并配置：

| 字段 | 描述 | 示例 |
|------|------|------|
| **连接** | 使用哪个 ServiceNow 实例 | 生产 CMDB |
| **卡片类型** | 要同步的 Turbo EA 卡片类型 | 应用程序 |
| **SNOW 表** | ServiceNow 表 API 名称 | `cmdb_ci_business_app` |
| **同步方向** | 可用的同步操作（见下方） | ServiceNow -> Turbo EA |
| **同步模式** | 如何处理删除 | 保守 |
| **最大删除比率** | 批量删除的安全阈值 | 50% |
| **筛选查询** | ServiceNow 编码查询以限制范围 | `active=true^install_status=1` |
| **跳过暂存** | 不经审查直接应用更改 | 关闭（推荐用于初始同步） |

### 常见 SNOW 表映射

| Turbo EA 类型 | ServiceNow 表 | 描述 |
|---------------|---------------|------|
| 应用程序 | `cmdb_ci_business_app` | 业务应用程序（最常见） |
| 应用程序 | `cmdb_ci_appl` | 通用应用程序 CI |
| IT 组件（软件） | `cmdb_ci_spkg` | 软件包 |
| IT 组件（硬件） | `cmdb_ci_server` | 物理/虚拟服务器 |
| IT 组件（SaaS） | `cmdb_ci_cloud_service_account` | 云服务账户 |
| 供应商 | `core_company` | 供应商/公司 |
| 接口 | `cmdb_ci_endpoint` | 集成端点 |
| 数据对象 | `cmdb_ci_database` | 数据库实例 |
| 系统 | `cmdb_ci_computer` | 计算机 CI |
| 组织 | `cmn_department` | 部门 |

### 筛选查询示例

始终进行筛选以避免导入过时或已退役的记录：

```
# 仅活跃 CI（最低推荐筛选）
active=true

# 安装状态为「已安装」的活跃 CI
active=true^install_status=1

# 生产使用中的应用程序
active=true^used_for=Production

# 最近 30 天更新的 CI
active=true^sys_updated_on>=javascript:gs.daysAgoStart(30)

# 特定分配组
active=true^assignment_group.name=IT Operations

# 排除已退役 CI
active=true^install_statusNOT IN7,8
```

**最佳实践**：最少包含 `active=true`。CMDB 表通常包含数千条不应导入到 EA 架构中的已退役或停用记录。

---

## 步骤 4：配置字段映射

每个映射包含**字段映射**，定义单个字段如何在两个系统之间转换。Turbo EA 字段输入根据选定的卡片类型提供自动补全建议 —— 包括核心字段、生命周期日期和类型架构中的所有自定义属性。

### 添加字段

对于每个字段映射，您配置：

| 设置 | 描述 |
|------|------|
| **Turbo EA 字段** | Turbo EA 中的字段路径（自动补全根据卡片类型建议选项） |
| **SNOW 字段** | ServiceNow 列 API 名称（例如 `name`、`short_description`） |
| **方向** | 每个字段的权威来源：SNOW 主导或 Turbo 主导 |
| **转换** | 如何转换值：直接、值映射、日期、布尔 |
| **标识**（ID 复选框） | 用于初始同步期间匹配记录 |

### Turbo EA 字段路径

自动补全按分区分组字段。完整路径参考：

| 路径 | 目标 | 示例值 |
|------|------|--------|
| `name` | 卡片显示名称 | `"SAP S/4HANA"` |
| `description` | 卡片描述 | `"核心财务 ERP 系统"` |
| `lifecycle.plan` | 生命周期：规划日期 | `"2024-01-15"` |
| `lifecycle.phaseIn` | 生命周期：引入日期 | `"2024-03-01"` |
| `lifecycle.active` | 生命周期：活跃日期 | `"2024-06-01"` |
| `lifecycle.phaseOut` | 生命周期：淘汰日期 | `"2028-12-31"` |
| `lifecycle.endOfLife` | 生命周期：结束日期 | `"2029-06-30"` |
| `attributes.<key>` | 卡片类型字段架构中的任何自定义属性 | 因字段类型而异 |

例如，如果您的应用程序类型有一个键为 `businessCriticality` 的字段，从下拉菜单中选择 `attributes.businessCriticality`。

### 标识字段 —— 匹配工作原理

将一个或多个字段标记为**标识**（钥匙图标）。这些用于首次同步期间将 ServiceNow 记录匹配到现有 Turbo EA 卡片：

1. **身份映射查找** —— 如果 sys_id <-> card UUID 链接已存在，使用它
2. **精确名称匹配** —— 按标识字段值匹配（例如按应用程序名称匹配）
3. **模糊匹配** —— 如果没有精确匹配，使用 SequenceMatcher 以 85% 相似度阈值

**最佳实践**：始终将 `name` 字段标记为标识字段。如果两个系统之间的名称不同（例如 SNOW 包含版本号如「SAP S/4HANA v2.1」但 Turbo EA 是「SAP S/4HANA」），在首次同步前清理它们以获得更好的匹配质量。

首次同步建立身份映射链接后，后续同步使用持久的身份映射，不依赖名称匹配。

---

## 步骤 5：运行首次同步

切换到**同步仪表盘**标签页。

### 触发同步

对于每个活跃映射，根据配置的同步方向，您会看到拉取和/或推送按钮：

- **拉取**（云下载图标）—— 从 SNOW 获取数据到 Turbo EA
- **推送**（云上传图标）—— 将 Turbo EA 数据发送到 ServiceNow

### 拉取同步期间发生什么

```
1. 获取     从 SNOW 检索所有匹配记录（每批 500 条）
2. 匹配     将每条记录匹配到现有卡片：
             a) 身份映射（持久的 sys_id <-> card UUID 查找）
             b) 标识字段精确名称匹配
             c) 模糊名称匹配（85% 相似度阈值）
3. 转换     应用字段映射将 SNOW -> Turbo EA 格式
4. 差异     将转换后的数据与现有卡片字段比较
5. 暂存     为每条记录分配操作：
             - create: 新记录，未找到匹配卡片
             - update: 找到匹配，字段有差异
             - skip:   找到匹配，无差异
             - delete: 在身份映射中但 SNOW 中不存在
6. 应用     执行暂存操作（创建/更新/归档卡片）
```

启用**跳过暂存**时，步骤 5 和 6 合并 —— 操作直接应用，不写入暂存记录。

### 查看同步结果

**同步历史**表格在每次运行后显示：

| 列 | 描述 |
|----|------|
| 开始时间 | 同步开始的时间 |
| 方向 | 拉取或推送 |
| 状态 | `completed`、`failed` 或 `running` |
| 已获取 | 从 ServiceNow 检索的总记录数 |
| 已创建 | 在 Turbo EA 中创建的新卡片数 |
| 已更新 | 更新的现有卡片数 |
| 已删除 | 归档（软删除）的卡片数 |
| 错误 | 处理失败的记录数 |
| 时长 | 实际时间 |

点击任何运行的**列表图标**可检查单个暂存记录，包括每次更新的字段级差异。

### 推荐的首次同步流程

```
1. 将映射设置为追加模式，暂存开启
2. 运行拉取同步
3. 审查暂存记录 —— 检查创建是否正确
4. 前往清单，验证导入的卡片
5. 如需要调整字段映射或筛选查询
6. 重复运行直到满意
7. 切换到保守模式用于日常使用
8. 经过几次成功运行后，启用跳过暂存
```

---

## 理解同步方向与字段方向

这是最常被误解的概念。有**两个级别的方向**协同工作：

### 表级别：同步方向

在映射本身上设置。控制同步仪表盘上**可用的同步操作**：

| 同步方向 | 拉取按钮？ | 推送按钮？ | 使用场景... |
|----------|-----------|-----------|------------|
| **ServiceNow -> Turbo EA** | 是 | 否 | CMDB 是主来源，仅导入 |
| **Turbo EA -> ServiceNow** | 否 | 是 | EA 工具用评估丰富 CMDB |
| **双向** | 是 | 是 | 两个系统贡献不同字段 |

### 字段级别：方向

**按字段映射**设置。控制同步运行期间**哪个系统的值优先**：

| 字段方向 | 拉取期间（SNOW -> Turbo） | 推送期间（Turbo -> SNOW） |
|----------|--------------------------|---------------------------|
| **SNOW 主导** | 从 ServiceNow 导入值 | 值被**跳过**（不推送） |
| **Turbo 主导** | 值被**跳过**（不覆盖） | 导出值到 ServiceNow |

### 协同工作方式 —— 示例

映射：应用程序 <-> `cmdb_ci_business_app`，**双向**

| 字段 | 方向 | 拉取执行... | 推送执行... |
|------|------|------------|------------|
| `name` | **Turbo 主导** | 跳过（EA 维护名称） | 推送 EA 名称 -> SNOW |
| `description` | **Turbo 主导** | 跳过（EA 编写描述） | 推送描述 -> SNOW |
| `lifecycle.active` | **Turbo 主导** | 跳过（EA 管理生命周期） | 推送上线日期 -> SNOW |
| `attributes.businessCriticality` | **Turbo 主导** | 跳过（EA 评估） | 推送评估 -> SNOW 自定义字段 |
| `attributes.ipAddress` | SNOW 主导 | 从发现导入 IP | 跳过（运维数据） |
| `attributes.installStatus` | SNOW 主导 | 导入运维状态 | 跳过（ITSM 数据） |

**关键洞察**：表级别方向决定*显示哪些按钮*。字段级别方向决定每次操作期间*实际传输哪些字段*。Turbo EA 主导大多数字段、SNOW 仅主导运维/技术字段的双向映射是最强大的配置。

### 最佳实践：按数据类型设置字段方向

默认应该是绝大多数字段 **Turbo 主导**。仅对来自自动发现或 ITSM 工作流的运维和技术元数据设置 SNOW 主导。

| 数据类别 | 推荐方向 | 理由 |
|----------|----------|------|
| **名称、显示标签** | **Turbo 主导** | EA 团队维护权威、清晰的名称 —— CMDB 名称通常是自动生成或不一致的 |
| **描述** | **Turbo 主导** | EA 描述捕获战略上下文、业务价值和架构意义 |
| **业务关键性（TIME 模型）** | **Turbo 主导** | 核心 EA 评估 —— 不是运维数据 |
| **功能/技术适用性** | **Turbo 主导** | EA 特定的评分和路线图分类 |
| **生命周期（所有阶段）** | **Turbo 主导** | 规划、引入、活跃、淘汰、结束都是 EA 规划决策 |
| **成本数据** | **Turbo 主导** | EA 跟踪总拥有成本和预算分配 |
| **托管类型、分类** | **Turbo 主导** | 架构师维护的战略分类 |
| 技术元数据（OS、IP、主机名） | SNOW 主导 | 自动发现数据 —— EA 不维护 |
| SLA 目标、可用性指标 | SNOW 主导 | ITSM 工作流的运维数据 |
| 安装状态、运行状态 | SNOW 主导 | CMDB 跟踪 CI 是否已安装、已退役等 |
| 分配组、支持团队 | SNOW 主导 | ServiceNow 工作流中管理的运维所有权 |
| 发现元数据（首次/最后发现） | SNOW 主导 | CMDB 自动化时间戳 |

---

## 跳过暂存 —— 何时使用

默认情况下，拉取同步遵循**暂存然后应用**工作流：

```
获取 -> 匹配 -> 转换 -> 差异 -> 暂存 -> 审查 -> 应用
```

记录写入暂存表，允许您在应用前审查将要更改的内容。这在同步仪表盘的「查看暂存记录」中可见。

### 跳过暂存模式

在映射上启用**跳过暂存**时，记录直接应用：

```
获取 -> 匹配 -> 转换 -> 差异 -> 直接应用
```

不创建暂存记录 —— 更改立即生效。

| | 暂存（默认） | 跳过暂存 |
|--|-------------|----------|
| **审查步骤** | 是 —— 应用前检查差异 | 否 —— 更改立即应用 |
| **暂存记录表** | 填充创建/更新/删除条目 | 不填充 |
| **审计轨迹** | 暂存记录 + 事件历史 | 仅事件历史 |
| **性能** | 稍慢（写入暂存行） | 稍快 |
| **撤销** | 可以在应用前中止 | 必须手动恢复 |

### 何时使用各种模式

| 场景 | 推荐 |
|------|------|
| 首次导入 | **使用暂存** —— 审查应用前将创建什么 |
| 新建或更改的映射 | **使用暂存** —— 验证字段转换产生正确输出 |
| 稳定、经过测试的映射 | **跳过暂存** —— 无需每次运行都审查 |
| 自动化每日同步（cron） | **跳过暂存** —— 无人值守运行无法等待审查 |
| 大型 CMDB（10,000+ CI） | **跳过暂存** —— 避免创建数千条暂存行 |
| 合规敏感环境 | **使用暂存** —— 在暂存表中维护完整审计轨迹 |

**最佳实践**：在首次几次同步中启用暂存。确信映射产生正确结果后，为自动化运行启用跳过暂存。

---

## 同步模式和删除安全

### 同步模式

| 模式 | 创建 | 更新 | 删除 | 最适合 |
|------|------|------|------|--------|
| **追加** | 是 | 是 | **从不** | 初始导入，低风险环境 |
| **保守** | 是 | 是 | 仅**同步创建的**卡片 | 日常同步的默认模式 |
| **严格** | 是 | 是 | 所有已链接的卡片 | CMDB 的完全镜像 |

**追加**永远不会从 Turbo EA 删除卡片，使其成为首次导入和 Turbo EA 包含 ServiceNow 中不存在的卡片（手动创建的卡片、来自其他来源的卡片）的环境中最安全的选项。

**保守**（默认）跟踪每张卡片是否最初由同步引擎创建。只有这些卡片在从 ServiceNow 消失时才能被自动归档。手动在 Turbo EA 中创建或从其他来源导入的卡片永远不会被触及。

**严格**归档对应 ServiceNow CI 不再出现在查询结果中的任何已链接卡片，无论是谁创建的。仅在 ServiceNow 是绝对权威来源且您希望 Turbo EA 完全镜像它时使用此模式。

### 最大删除比率 —— 安全网

作为安全网，如果计数超过配置的比率，引擎会**跳过所有删除**：

```
deletions / total_linked > max_deletion_ratio  ->  跳过所有删除
```

示例：10 条已链接记录，50% 阈值：

| 场景 | 删除数 | 比率 | 结果 |
|------|--------|------|------|
| 3 个 CI 正常移除 | 3 / 10 = 30% | 低于阈值 | 删除继续 |
| 6 个 CI 一次移除 | 6 / 10 = 60% | **超过阈值** | 跳过所有删除 |
| SNOW 返回空值（故障） | 10 / 10 = 100% | **超过阈值** | 跳过所有删除 |

这防止了因筛选查询更改、临时 ServiceNow 故障或错误配置的表名导致的灾难性数据丢失。

**最佳实践**：对于少于 100 条记录的表，将删除比率保持在 **50% 或更低**。对于大表（1,000+），可以安全地设置为 25%。

### 推荐进展

```
第 1 周：追加模式，暂存开启，手动运行，审查每条记录
第 2-4 周：保守模式，暂存开启，每天运行，抽查结果
第 2 个月+：保守模式，暂存关闭（跳过），自动化每日 cron
```

---

## 按类型推荐方案

### 方案 1：从 CMDB 导入应用程序（最常见）

**目标**：从 ServiceNow 导入应用程序架构，然后在 Turbo EA 中接管名称、描述、评估和生命周期的所有权。SNOW 仅主导运维字段。

**映射：**

| 设置 | 值 |
|------|-----|
| 卡片类型 | 应用程序 |
| SNOW 表 | `cmdb_ci_business_app` |
| 方向 | 双向 |
| 模式 | 保守 |
| 筛选 | `active=true^install_status=1` |

**字段映射：**

| Turbo EA 字段 | SNOW 字段 | 方向 | 转换 | ID？ |
|---------------|-----------|------|------|------|
| `name` | `name` | **Turbo 主导** | 直接 | 是 |
| `description` | `short_description` | **Turbo 主导** | 直接 | |
| `lifecycle.active` | `go_live_date` | **Turbo 主导** | 日期 | |
| `lifecycle.endOfLife` | `retirement_date` | **Turbo 主导** | 日期 | |
| `attributes.businessCriticality` | `busines_criticality` | **Turbo 主导** | 值映射 | |
| `attributes.hostingType` | `hosting_type` | **Turbo 主导** | 直接 | |
| `attributes.installStatus` | `install_status` | SNOW 主导 | 直接 | |
| `attributes.ipAddress` | `ip_address` | SNOW 主导 | 直接 | |

`businessCriticality` 的值映射配置：

```json
{
  "mapping": {
    "1 - most critical": "missionCritical",
    "2 - somewhat critical": "businessCritical",
    "3 - less critical": "businessOperational",
    "4 - not critical": "administrativeService"
  }
}
```

**首次同步提示**：在第一次拉取时，SNOW 值填充所有字段（因为卡片尚不存在）。之后，Turbo 主导字段由 EA 团队拥有 —— 后续拉取仅更新运维 SNOW 主导字段（安装状态、IP），而 EA 团队直接在 Turbo EA 中管理其他所有内容。

**导入后**：优化应用程序名称、编写战略描述、映射到业务能力、添加功能/技术适用性评估和设置生命周期阶段 —— 所有这些现在由 Turbo EA 拥有，将在推送同步时推回 ServiceNow。

---

### 方案 2：IT 组件（服务器）

**目标**：导入服务器基础设施用于基础设施映射和依赖分析。服务器比应用程序更偏运维，因此更多字段来自 SNOW —— 但 Turbo EA 仍然主导名称和描述。

**映射：**

| 设置 | 值 |
|------|-----|
| 卡片类型 | IT 组件 |
| SNOW 表 | `cmdb_ci_server` |
| 方向 | 双向 |
| 模式 | 保守 |
| 筛选 | `active=true^hardware_statusNOT IN6,7` |

**字段映射：**

| Turbo EA 字段 | SNOW 字段 | 方向 | 转换 | ID？ |
|---------------|-----------|------|------|------|
| `name` | `name` | **Turbo 主导** | 直接 | 是 |
| `description` | `short_description` | **Turbo 主导** | 直接 | |
| `attributes.manufacturer` | `manufacturer.name` | **Turbo 主导** | 直接 | |
| `attributes.operatingSystem` | `os` | SNOW 主导 | 直接 | |
| `attributes.ipAddress` | `ip_address` | SNOW 主导 | 直接 | |
| `attributes.serialNumber` | `serial_number` | SNOW 主导 | 直接 | |
| `attributes.hostname` | `host_name` | SNOW 主导 | 直接 | |

**说明**：对于服务器，运维/发现字段如操作系统、IP、序列号和主机名自然来自 SNOW 的自动发现。但 EA 团队仍然拥有显示名称（可能与主机名不同）和描述用于战略上下文。

**导入后**：使用关系将 IT 组件链接到应用程序，这馈入依赖图和基础设施报告。

---

### 方案 3：带 EOL 跟踪的软件产品

**目标**：导入软件产品并与 Turbo EA 的 endoflife.date 集成结合。Turbo EA 主导名称、描述和供应商 —— 版本是事实字段，SNOW 可以主导。

**映射：**

| 设置 | 值 |
|------|-----|
| 卡片类型 | IT 组件 |
| SNOW 表 | `cmdb_ci_spkg` |
| 方向 | 双向 |
| 模式 | 保守 |
| 筛选 | `active=true` |

**字段映射：**

| Turbo EA 字段 | SNOW 字段 | 方向 | 转换 | ID？ |
|---------------|-----------|------|------|------|
| `name` | `name` | **Turbo 主导** | 直接 | 是 |
| `description` | `short_description` | **Turbo 主导** | 直接 | |
| `attributes.version` | `version` | SNOW 主导 | 直接 | |
| `attributes.vendor` | `manufacturer.name` | **Turbo 主导** | 直接 | |

**导入后**：前往**管理 > EOL** 使用批量搜索自动将导入的 IT 组件与 endoflife.date 产品匹配。这为您提供了结合 CMDB 库存和公共生命周期数据的自动化 EOL 风险跟踪。

---

### 方案 4：供应商（双向）

**目标**：保持供应商注册表同步。Turbo EA 拥有供应商名称、描述和战略上下文。SNOW 用运维联系数据补充。

**映射：**

| 设置 | 值 |
|------|-----|
| 卡片类型 | 供应商 |
| SNOW 表 | `core_company` |
| 方向 | 双向 |
| 模式 | 追加 |
| 筛选 | `vendor=true` |

**字段映射：**

| Turbo EA 字段 | SNOW 字段 | 方向 | 转换 | ID？ |
|---------------|-----------|------|------|------|
| `name` | `name` | **Turbo 主导** | 直接 | 是 |
| `description` | `notes` | **Turbo 主导** | 直接 | |
| `attributes.website` | `website` | **Turbo 主导** | 直接 | |
| `attributes.contactEmail` | `email` | SNOW 主导 | 直接 | |

**为什么大多数字段 Turbo 主导**：EA 团队制定供应商战略、管理关系和跟踪风险 —— 这包括供应商的显示名称、描述和网站。SNOW 仅对可能由采购或资产管理团队更新的运维联系数据主导。

---

### 方案 5：将 EA 评估推回 ServiceNow

**目标**：将 EA 特定的评估导出到 ServiceNow 自定义字段，以便 ITSM 团队看到 EA 上下文。

**映射：**

| 设置 | 值 |
|------|-----|
| 卡片类型 | 应用程序 |
| SNOW 表 | `cmdb_ci_business_app` |
| 方向 | Turbo EA -> ServiceNow |
| 模式 | 追加 |

**字段映射：**

| Turbo EA 字段 | SNOW 字段 | 方向 | 转换 | ID？ |
|---------------|-----------|------|------|------|
| `name` | `name` | SNOW 主导 | 直接 | 是 |
| `attributes.businessCriticality` | `u_ea_business_criticality` | Turbo 主导 | 值映射 | |
| `attributes.functionalSuitability` | `u_ea_functional_fit` | Turbo 主导 | 值映射 | |
| `attributes.technicalSuitability` | `u_ea_technical_fit` | Turbo 主导 | 值映射 | |

> **重要**：推送同步到自定义字段（前缀为 `u_`）需要这些列已在 ServiceNow 中存在。在配置推送映射之前，与您的 ServiceNow 管理员合作创建它们。服务账户需要 `import_admin` 角色才能获得写入权限。

**为什么这很重要**：ITSM 团队直接在 ServiceNow 事件/变更工作流中看到 EA 评估。当「任务关键」应用程序发生事件时，优先级升级规则可以使用 EA 提供的关键性评分。

---

## 转换类型参考

### 直接（默认）

不做更改地传递值。用于两个系统中格式相同的文本字段。

### 值映射

在系统之间转换枚举值。使用 JSON 映射配置：

```json
{
  "mapping": {
    "1": "missionCritical",
    "2": "businessCritical",
    "3": "businessOperational",
    "4": "administrativeService"
  }
}
```

从 Turbo EA 推送到 ServiceNow 时，映射自动反转。例如，推送期间 `"missionCritical"` 变为 `"1"`。

### 日期格式

将 ServiceNow 日期时间值（`2024-06-15 14:30:00`）截断为仅日期（`2024-06-15`）。用于时间不相关的生命周期阶段日期。

### 布尔

在 ServiceNow 字符串布尔值（`"true"`、`"1"`、`"yes"`）和原生布尔之间转换。适用于「is_virtual」、「active」等字段。

---

## 安全最佳实践

### 凭据管理

| 实践 | 详情 |
|------|------|
| **静态加密** | 所有凭据通过从 `SECRET_KEY` 派生的 Fernet（AES-128-CBC）加密。如果轮换 `SECRET_KEY`，需重新输入所有 ServiceNow 凭据。 |
| **最小权限** | 创建专用 SNOW 服务账户，仅对特定表具有只读访问权限。仅在使用推送同步时才授予写入权限。 |
| **首选 OAuth 2.0** | Basic Auth 每次 API 调用都发送凭据。OAuth 使用有范围限制的短期令牌。 |
| **凭据轮换** | 每 90 天轮换密码或客户端密钥。 |

### 网络安全

| 实践 | 详情 |
|------|------|
| **强制 HTTPS** | HTTP URL 在验证时被拒绝。所有连接必须使用 HTTPS。 |
| **表名验证** | 表名按 `^[a-zA-Z0-9_]+$` 验证以防止注入。 |
| **sys_id 验证** | sys_id 值验证为 32 字符十六进制字符串。 |
| **IP 白名单** | 配置 ServiceNow IP 访问控制，仅允许 Turbo EA 服务器的 IP。 |

### 访问控制

| 实践 | 详情 |
|------|------|
| **RBAC 网关** | 所有 ServiceNow 端点需要 `servicenow.manage` 权限。 |
| **审计轨迹** | 所有同步创建的更改发布带有 `source: "servicenow_sync"` 的事件，在卡片历史中可见。 |
| **不暴露凭据** | API 响应中永远不返回密码和密钥。 |

### 生产清单

- [ ] 专用 ServiceNow 服务账户（不是个人账户）
- [ ] OAuth 2.0 客户端凭据授权
- [ ] 凭据轮换计划（每 90 天）
- [ ] 服务账户仅限于映射的表
- [ ] 为 Turbo EA 服务器 IP 配置 ServiceNow IP 白名单
- [ ] 最大删除比率设置为 50% 或更低
- [ ] 监控同步运行的异常错误或删除计数
- [ ] 筛选查询至少包含 `active=true`

---

## 运维手册

### 初始设置序列

```
1. 创建具有最低所需角色的 ServiceNow 服务账户
2. 验证网络连接（Turbo EA 能否通过 HTTPS 访问 SNOW？）
3. 在 Turbo EA 中创建连接并测试
4. 验证元模型类型有您要同步的所有字段
5. 使用追加模式创建第一个映射，暂存开启
6. 使用预览按钮（通过 API）验证映射产生正确输出
7. 运行首次拉取同步 —— 在同步仪表盘中审查暂存记录
8. 应用暂存记录
9. 在清单中验证导入的卡片
10. 如需要调整字段映射，重新运行
11. 切换映射到保守模式用于日常使用
12. 经过几次成功运行后，启用跳过暂存用于自动化
```

### 日常运维

| 任务 | 频率 | 方式 |
|------|------|------|
| 运行拉取同步 | 每天或每周 | 同步仪表盘 > 拉取按钮（或 cron） |
| 审查同步统计 | 每次运行后 | 检查错误/删除计数 |
| 测试连接 | 每月 | 点击每个连接的测试按钮 |
| 轮换凭据 | 每季度 | 在 SNOW 和 Turbo EA 中都更新 |
| 审查身份映射 | 每季度 | 通过同步统计检查孤立条目 |
| 审计卡片历史 | 按需 | 按 `servicenow_sync` 来源筛选事件 |

### 设置自动化同步

可以通过 API 触发同步以实现自动化：

```bash
# 每天凌晨 2:00 拉取同步
0 2 * * * curl -s -X POST \
  -H "Authorization: Bearer $TURBOEA_TOKEN" \
  "https://turboea.company.com/api/v1/servicenow/sync/pull/$MAPPING_ID" \
  >> /var/log/turboea-sync.log 2>&1
```

**最佳实践**：在非高峰时段运行同步。对于大型 CMDB 表（10,000+ CI），预计 2-5 分钟，取决于网络延迟和记录数量。

### 容量规划

| CMDB 规模 | 预期时长 | 推荐 |
|-----------|----------|------|
| < 500 CI | < 30 秒 | 每天同步，暂存可选 |
| 500-5,000 CI | 30 秒 - 2 分钟 | 每天同步，跳过暂存 |
| 5,000-20,000 CI | 2-5 分钟 | 每晚同步，跳过暂存 |
| 20,000+ CI | 5-15 分钟 | 每周同步，使用筛选查询拆分 |

---

## 故障排除

### 连接问题

| 症状 | 原因 | 修复 |
|------|------|------|
| `Connection failed: [SSL]` | 自签名或过期证书 | 确保 SNOW 使用有效的公共 CA 证书 |
| `HTTP 401: Unauthorized` | 凭据错误 | 重新输入用户名/密码；检查账户是否被锁定 |
| `HTTP 403: Forbidden` | 角色不足 | 授予服务账户 `itil` 和 `cmdb_read` |
| `Connection failed: timed out` | 防火墙阻止 | 检查规则；在 SNOW 中白名单 Turbo EA 的 IP |
| 测试正常但同步失败 | 表级权限 | 授予特定 CMDB 表的读取权限 |

### 同步问题

| 症状 | 原因 | 修复 |
|------|------|------|
| 获取 0 条记录 | 错误的表或筛选 | 验证表名；简化筛选查询 |
| 所有记录都是「创建」 | 标识不匹配 | 将 `name` 标记为标识；验证系统之间的名称匹配 |
| 高错误数 | 转换失败 | 检查暂存记录中的错误消息 |
| 删除被跳过 | 比率超出 | 提高阈值或调查 CI 为何消失 |
| 更改不可见 | 浏览器缓存 | 强制刷新；检查卡片历史中的事件 |
| 重复卡片 | 同一类型的多个映射 | 每个连接的每种卡片类型使用一个映射 |
| 推送更改被拒绝 | 缺少 SNOW 权限 | 授予服务账户 `import_admin` 角色 |

### 诊断工具

```bash
# 预览记录将如何映射（5 个样本，无副作用）
POST /api/v1/servicenow/mappings/{mapping_id}/preview

# 浏览 SNOW 实例上的表
GET /api/v1/servicenow/connections/{conn_id}/tables?search=cmdb

# 检查表的列
GET /api/v1/servicenow/connections/{conn_id}/tables/cmdb_ci_business_app/fields

# 按操作或状态筛选暂存记录
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=create
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=update
GET /api/v1/servicenow/sync/runs/{run_id}/staged?status=error
```

---

## API 参考（快速）

所有端点需要 `Authorization: Bearer <token>` 和 `servicenow.manage` 权限。基础路径：`/api/v1`。

### 连接

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/servicenow/connections` | 列出连接 |
| POST | `/servicenow/connections` | 创建连接 |
| GET | `/servicenow/connections/{id}` | 获取连接 |
| PATCH | `/servicenow/connections/{id}` | 更新连接 |
| DELETE | `/servicenow/connections/{id}` | 删除连接 + 所有映射 |
| POST | `/servicenow/connections/{id}/test` | 测试连接 |
| GET | `/servicenow/connections/{id}/tables` | 浏览 SNOW 表 |
| GET | `/servicenow/connections/{id}/tables/{table}/fields` | 列出表列 |

### 映射

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/servicenow/mappings` | 列出映射和字段映射 |
| POST | `/servicenow/mappings` | 创建映射和字段映射 |
| GET | `/servicenow/mappings/{id}` | 获取映射和字段映射 |
| PATCH | `/servicenow/mappings/{id}` | 更新映射（如提供则替换字段） |
| DELETE | `/servicenow/mappings/{id}` | 删除映射 |
| POST | `/servicenow/mappings/{id}/preview` | 试运行预览（5 条样本记录） |

### 同步操作

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/servicenow/sync/pull/{mapping_id}` | 拉取同步（`?auto_apply=true` 默认） |
| POST | `/servicenow/sync/push/{mapping_id}` | 推送同步 |
| GET | `/servicenow/sync/runs` | 列出同步历史（`?limit=20`） |
| GET | `/servicenow/sync/runs/{id}` | 获取运行详情 + 统计 |
| GET | `/servicenow/sync/runs/{id}/staged` | 列出运行的暂存记录 |
| POST | `/servicenow/sync/runs/{id}/apply` | 应用待处理的暂存记录 |
