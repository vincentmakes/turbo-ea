# 审计日志

**审计日志**位于**管理 → 设置 → 审计日志**（`/admin/settings?tab=audit-log`），用于回答安全评审对一个保存着整个 IT 全景图的实例提出的两个问题：*其中发生了哪些变更*，以及*谁以何种方式登录过*。它分为两个子标签页：

| 子标签页 | URL | 记录内容 |
|----------|-----|----------|
| **变更** | `/admin/settings?tab=audit-log` | 对全景的每一次写入——卡片、关系、风险、标签、干系人角色、决策草稿、图表——按变更批次分组，附带逐事件差异和**回滚** |
| **安全与管理** | `/admin/settings?tab=audit-log&view=security` | 登录和退出、失败的尝试、锁定、SSO 和代理会话、密码事件、角色模拟以及每一项管理操作 |

两者有意分开。**变更**是一个工作工具——用来查看并撤销错误的写入——只保留较短的历史。**安全与管理**是一条证据链：其中的条目既不能编辑也不能删除，默认保留一年。

## 谁可以查看

两个子标签页都需要 **`admin.events`** 权限（「查看审计跟踪和事件流」），默认只有 **Admin** 角色拥有该权限。若想让安全或合规负责人只读访问而不必成为管理员，可在[用户与角色](users.md)中创建一个带 `admin.events` 的角色并分配给他。

## 变更

**变更**子标签页是变更批次台账。每一次改变数据的写入都会以批次形式出现在这里，并附带执行者和来源：

| 来源 | 含义 |
|------|------|
| **Web** | Turbo EA 的 Web 界面 |
| **API** | 对 REST API 的直接调用（脚本、集成） |
| **AI 工具** | 通过 [MCP 服务器](mcp.md)连接的 AI 助手 |
| **扩展** | 已安装的[扩展](extensions.md)，记录为 `ext:<key>` 批次 |

点击某个批次即可打开其侧栏：逐事件差异显示每个字段的旧值和新值，**回滚**会撤销该批次对卡片、关系、风险、干系人角色、标签和决策草稿所做的写入，并删除它所创建的图表（除非该图表此后已发布）。图表的编辑和删除同样会被列出，但无法回滚：之前的画布不会被保留。图表事件记录哪些卡片链接发生了变化以及画布的大小，绝不记录图纸本身。

AI 工具通过 MCP 服务器发出的每一次调用在这里都是一个批次，包括其**演练**：预览会显示为*演练*批次，因此既能看到代理提议了什么，也能看到它提交了什么。

批次被清除后，渠道仍保留在记录本身上。卡片、图表、风险、架构决策、SoAW、评论和 BPM 流程版本会记住它们**创建**和最后**修改**所经由的渠道，并显示在执行操作的人员旁边。凡不是在网页界面中完成的操作都会显示一个徽章——**MCP**、**API**、**扩展**或**系统**——出现在卡片头部、历史标签页、清单（**创建渠道** / **修改渠道**列和**来源**筛选）、图表库、风险登记册以及各模块的「创建者」显示中。在记录该信息之前创建的记录不显示徽章。

批次保留 **`MUTATION_BATCH_RETENTION_DAYS`** 天（一个环境变量，默认 **15**），之后自动清除。批次清除后，事件本身仍保留在每张卡片的「历史」标签页中。

## 安全与管理

![安全与管理日志](../assets/img/zh/62_admin_audit_log_security.png)

**安全与管理**子标签页为每一个与安全相关的操作列出一条条目，最新的在前：

- 通过密码、SSO 或受信任的反向代理进行的登录和退出；
- 失败的登录尝试，每条都带有一个说明失败原因的**原因代码**；
- 多次失败后的账户锁定；
- 注册，以及密码的设置、重置和修改；
- 角色模拟——管理员开始和结束「以角色查看…」；
- 管理操作——对用户、角色、设置、元模型、标签、计算、扩展、导入、集成、公开门户和已发布图表、调查以及运维访问的更改（参见[管理操作](#administrative-actions)）；
- 数据导出——卡片的 CSV 和 JSON 导出、工作区导出以及面向其他 EA 平台的导出（参见[数据导出](#data-exports)）——以及对本日志本身的导出。

### 列

| 列 | 说明 |
|----|------|
| **时间** | 操作发生的日期和时间 |
| **类别** | `auth`（身份验证）、`admin`（管理操作）或 `access`（导出及其他数据访问） |
| **操作** | 发生了什么，例如 `auth.login.failed`——参见[操作目录](#action-catalogue) |
| **结果** | **成功**或**失败** |
| **执行者** | 执行该操作的已登录用户。没有人登录时为空——例如登录失败时 |
| **对象账户** | 该操作所涉及的账户——登录失败时输入的电子邮件地址，或被重置密码的用户 |
| **目标** | 被操作的对象（如有）——例如开始角色模拟时所选的角色 |
| **IP** | 客户端的 IP 地址（参见[客户端 IP 地址](#client-ip-address)） |
| **来源** | 请求的来源：Web、API、AI 工具、扩展、运维（ops）或系统 |
| **模拟的角色** | 管理员以另一个角色查看应用时的那个角色。执行者仍是真实的管理员 |

列可以像其他数据表一样显示、隐藏、重新排序和冻结；**时间**和**操作**始终显示。

### 筛选

左侧的筛选侧栏可按**类别**、**结果**、**操作**、**执行者**、**IP 地址**和**日期范围**缩小列表。每个分区标题显示已选值的数量，折叠后的侧栏显示生效的筛选数量。同一侧栏的**列**标签页用于显示、隐藏和冻结列。您的筛选和列布局会保存在此浏览器中。

按电子邮件地址搜索会同时匹配执行者、对象账户和目标，因此输入一个地址即可同时找到此人做过的事情以及针对其账户的尝试。

### 阅读条目

点击某一行即可打开条目抽屉。它会显示条目的每个字段——时间、操作者、来源 IP 地址和浏览器——并在**详情**下以通俗语言而非存储的键名写出该条目记录的内容：

- **变更**——每项变更一句话。例如，编辑卡片类型会显示为 *字段「业务关键性」（单选）已添加到分区「治理」* 或 *字段「业务关键性」的选项「高」已重命名为「关键」*。字段、分区、选项、角色和门户以其标签命名，权限以其描述命名，语言以其名称命名。
- **之前 / 之后**——列出已更改的值的表格，每个字段一行，字段以其标签命名。值会被格式化：是或否、按工作区日期格式显示的日期、以色块显示的颜色、以 KB 或 MB 显示的文件大小。机密信息从不存储：密码、令牌或客户端密钥在条目写入前即被替换，并显示为**机密值**。
- **上下文**——为变更提供背景但不属于变更本身的事实：门户的当前地址及其是否已发布、连接的凭据是否已更换、一次导入涉及了多少行。

登录失败的条目会在详情上方显示其**原因**——密码错误、账户未知、账户被临时锁定。

2.161.0 版本之前写入的条目按记录时的样子显示详情：旧值和新值仍显示在表格中，抽屉无法解读的内容以原始 JSON 显示。

抽屉中没有任何操作。条目无法编辑或删除。

### 导出 CSV

工具栏中的**导出 CSV**会把符合当前筛选的条目下载为 CSV 文件，最多 50 000 行。导出本身也会被记录为 `access.audit_log.exported`，因此导出安全日志总会在其中留下痕迹。

## 操作目录 { #action-catalogue }

| 操作 | 记录时机 |
|------|----------|
| `auth.login.succeeded` | 用户使用电子邮件和密码登录 |
| `auth.login.failed` | 密码登录被拒绝。**原因代码**说明原因（见下文） |
| `auth.login.locked` | 连续第五次失败将账户锁定 15 分钟。详情中包含锁定结束的时间 |
| `auth.logout` | 已登录用户退出。没有有效会话的退出不会记录任何内容 |
| `auth.sso.succeeded` | 用户通过 SSO 提供方登录。详情中包含提供方、身份提供方的主体标识，以及该账户是否由此次登录创建 |
| `auth.sso.failed` | SSO 登录被拒绝——域名不被允许、缺少电子邮件地址、存在使用相同电子邮件的本地账户、账户未激活。详情中包含提供方和原因 |
| `auth.proxy_session.succeeded` | 用户通过受信任的[反向代理](sso.md)登录 |
| `auth.proxy_session.failed` | 通过反向代理的登录被拒绝 |
| `auth.register` | 用户通过自助注册创建账户 |
| `auth.password.set` | 受邀用户设置其第一个密码 |
| `auth.password.reset_requested` | 有人请求密码重置邮件。始终以输入的地址记录为成功，因此响应不会泄露任何信息；详情中注明是否匹配到账户以及是否已发送邮件 |
| `auth.password.reset` | 通过重置链接修改了密码 |
| `auth.password.changed` | 已登录用户修改自己的密码 |
| `auth.impersonation.started` | 管理员开始「以角色查看…」。目标是所选的角色 |
| `auth.impersonation.stopped` | 管理员返回自己的角色 |

`auth.login.failed` 的**原因代码**：

| 原因 | 含义 |
|------|------|
| `unknown_user` | 没有账户使用该电子邮件地址 |
| `sso_account` | 该账户通过 SSO 登录，没有密码 |
| `no_password` | 该账户尚未设置密码——一份从未被接受的邀请 |
| `locked` | 该账户因多次失败而被锁定 |
| `bad_password` | 密码错误 |
| `inactive` | 该账户已被停用 |

`auth.sso.failed`, `auth.proxy_session.failed`, `auth.password.set` 和 `auth.password.reset` 的**原因代码**：

| 原因 | 含义 |
|------|------|
| `expired` | 该账户的限时访问已结束 |
| `hd_mismatch` | 该 Google 账户属于不允许的域名 |
| `no_email` | 身份提供商未返回邮箱地址 |
| `no_subject` | 身份提供商未返回主体标识符 |
| `local_account` | 已有一个本地密码账户使用该邮箱 |
| `no_account` | 账户不存在，且不会自动创建账户 |
| `exchange_failed` | 身份提供商未完成登录 |
| `unauthenticated` | 反向代理未对请求进行身份验证 |
| `identity_rejected` | 转发的身份被拒绝（域名或邮箱未验证） |
| `invalid_token` | 邀请或重置链接无效或已过期 |

来自同一 IP 地址的一连串 `unknown_user` 失败就是「密码喷洒」（password spraying）的样子；针对同一账户的一系列 `bad_password`，随后出现 `auth.login.locked`，则是针对该账户的猜测尝试。

### 管理操作 { #administrative-actions }

管理员对实例配置所做的每一项更改都会以 `admin` 类别记录。**操作者**是该管理员，**目标**是被更改的对象——用户、角色、设置、卡片类型——并附带其在当时的名称，**详情**以旧值和新值的形式列出更改内容，仅限实际发生更改的字段。每条记录都遵循两条规则：

- **机密信息会被遮蔽。** SMTP 密码、SSO 客户端密钥、AI 提供商密钥、ServiceNow 凭据或任何其他机密值都写作 `***`：记录只表明它已更改，绝不显示其原值或新值。
- **绝不存储许可证文本或凭据。** 扩展许可证只做标识而不复制；管理员为用户设置的密码只记录为「已更改」，绝不记录其值。

没有任何更改的保存不会被记录，用户在个人资料中修改自己的姓名或语言也不会被记录。体量较大的配置——卡片类型的字段、翻译或布局，门户的筛选条件——按其大小汇总而不是整段复制；当大小没有变化时，会附加一段简短的内容指纹，使条目仍能显示发生了更改。卡片类型按角色的权限覆盖是例外：每个发生更改的单元格都会连同旧值和新值一起列出，空值表示适用该角色自身的权限。

| 领域 | 操作 | 记录内容 |
|------|---------|------------------|
| **用户与角色** | `admin.user.created`, `.updated`, `.deleted`, `.bulk_updated`, `.bulk_deleted`, `.unlocked`; `admin.user.invitation.resent`, `.deleted`; `admin.role.created`, `.updated`, `.archived`, `.restored`; `admin.stakeholder_role.created`, `.updated`, `.deleted`, `.archived`, `.restored` | 账户的创建、编辑、启用或停用、删除（逐个或批量）和解锁，并附带更改的字段——角色、电子邮件、名称、启用状态；重新发送或撤销的邀请；应用角色和按类型定义的利益相关者角色，以及授予或撤销的权限 |
| **设置** | `admin.settings.updated` | 每保存一项设置记录一条——电子邮件、身份验证与 SSO、注册、AI、MCP、语言、模块开关、品牌、徽标与网站图标、保留期限。目标是该设置；详情是其旧值和新值，机密信息已遮蔽 |
| **元模型** | `admin.metamodel.type.*` (including `.references_generated`), `admin.metamodel.relation_type.*`, `admin.metamodel.resource_type.*`, `admin.metamodel.category.*` (including `.reordered`), `admin.principle.*` (including `.imported`), `admin.regulation.*` | 卡片类型、关系类型和资源类型的创建、更改、删除或恢复，并附带更改的属性；为某一类型生成的卡片编号；EA 原则，包括从目录导入的原则；合规法规；卡片类型分类（架构层）的创建、重命名、改色、重新排序或删除 |
| **标签与计算** | `admin.tag_group.*`, `admin.tag.*`, `admin.calculation.*` | 标签组和标签；计算字段的创建、更改、删除、启用或停用，附带旧公式和新公式，以及对所有卡片运行一次计算（`.recalculated`） |
| **扩展** | `admin.extension.install.uploaded`, `.applied`, `.discarded`; `admin.extension.store.claimed`, `.refreshed`, `.installed`; `admin.extension.enabled`, `.disabled`, `.uninstalled`; `admin.extension.license.updated`, `.removed` | 上传、安装或丢弃的扩展包；来自扩展商店的许可证和下载；扩展的启用、停用和卸载；许可证的替换或移除——记录扩展及其版本，绝不记录许可证文本 |
| **工作区迁移与平台迁移** | `admin.workspace.import.uploaded`, `.applied`, `.completed`, `.discarded`; `admin.migration.uploaded`, `.field_mappings.updated`, `.applied`, `.deleted` | 上传的[工作区包](workspace-transfer.md)及其导入的开始、完成或丢弃；上传的[平台迁移](migration.md)及其字段映射的编辑、应用或删除 |
| **集成** | `admin.servicenow.connection.*`, `admin.servicenow.mapping.*`, `admin.servicenow.sync.pulled`, `.pushed`, `.applied` | ServiceNow 连接（凭据已遮蔽）和映射；每一次拉取、推送以及暂存记录的应用 |
| **公开暴露** | `admin.web_portal.created`, `.updated`, `.deleted`; `admin.diagram.published`, `.unpublished` | [Web 门户](web-portals.md)和已发布的图表——所有让数据无需账户即可访问的内容 |
| **调查** | `admin.survey.sent`, `admin.survey.closed` | 发送给收件人或已关闭的调查 |
| **运维访问** | `admin.ops.rescue_access.granted`, `.revoked` | 通过[运维 API](ops-api.md) 授予或撤销的救援访问，与现有的 `ops.*` 事件一同记录 |

### 数据导出 { #data-exports }

每当数据被批量带出实例时，都会有一条 `access` 条目记录是谁带走的、带走了多少以及以何种形式。条目在发送文件之前写入，因此即使某次导出的下载从未完成，它也会留在记录中。

| 操作 | 记录时机 | 详情 |
|------|----------|------|
| `access.export.cards` | 通过 API 的 CSV 或 JSON 导出（`/cards/export/csv`、`/cards/export/json`）导出卡片时，脚本、集成和 AI 助手都是这样做的 | `format`（`csv` 或 `json`）、`type`（一个或多个卡片类型）和 `rows`（卡片数量）。当导出恰好只涵盖一个卡片类型时，目标即为该类型 |
| `access.export.workspace` | 下载完整的[工作区包](workspace-transfer.md)时——来自「工作区迁移」，或由控制平面通过[运维 API](ops-api.md) 下载，后者不记录执行者，并记录 `requested_by: ops` | `include_archived` 和 `size_bytes` |
| `access.export.migration` | 在 **管理 → 设置 → 迁移** 中为其他 EA 平台导出工作区时（参见[平台迁移](migration.md)） | 目标平台、`include_archived` 和 `size_bytes` |
| `access.audit_log.exported` | 有人将安全日志导出为 CSV 时 | `rows` |

## 不记录的内容

- **令牌刷新。** Web 应用按计时器续期会话，因此每个打开的标签页都会产生条目，而这些条目没有任何意义。
- **因会话令牌过期或无效而被拒绝的请求。** 每当会话正常结束时都会出现。
- **OData 数据源的读取。** Excel 和 Power BI 会按计划轮询已保存视图的 OData 数据源，每次刷新都会产生一条条目。
- **在浏览器中生成的电子表格和演示文稿。** 清单和报表的 Excel 与 PowerPoint 下载由页面已经加载的数据生成，因此属于读取，而不是从服务器导出。
- **单纯的读取访问**——打开卡片、运行报表、搜索清单。

## 保留期限 { #retention }

条目默认保留 **365 天**。可在**管理 → 设置 → 常规 → 数据管理 → 安全日志保留期限**中修改：最多 3650 天的任意天数，或设为 **0** 以永久保留。一个任务每晚删除一次超出期限的条目，并在每次运行时重新读取该设置，因此更改无需重启即可生效。

这个保留任务是唯一会删除条目的机制。无论在界面还是 API 中，任何角色都没有编辑或删除操作。

该日志有意**不**包含在[工作区迁移](workspace-transfer.md)中：它是本实例的安全历史，而非工作区内容，克隆实例时不会复制它。

## JSON 审计流

后端还会在存储每条条目的同一时刻，通过日志记录器 **`turbo_ea.audit`** 将其写为**一行 JSON**。后端日志输出到标准输出，因此该数据流会到达任何已在收集您容器日志的地方——`docker compose logs backend`、Kubernetes 日志收集或任何 SIEM 采集代理——无需在 Turbo EA 中做任何配置：

```bash
docker compose logs -f backend | grep turbo_ea.audit
```

该行在条目被记录的那一刻写入。如果请求的事务随后失败，这一行会存在而没有对应的数据行：表是正式记录，数据流是实时信息。

每一行都带有与条目相同的字段：

| 字段 | 内容 |
|------|------|
| `audit_id`、`created_at` | 条目的标识符及其写入时间 |
| `category`、`action`、`outcome` | 发生了什么，以及是否成功 |
| `actor_user_id`、`actor_email` | 谁执行的 |
| `subject_email` | 所涉及的账户 |
| `target_type`、`target_id`、`target_label` | 作用于什么对象 |
| `ip`、`user_agent` | 客户端 |
| `origin` | web、api、mcp、ext、ops 或 system |
| `impersonator_user_id`、`impersonated_role` | 管理员以另一个角色查看应用期间填写 |
| `details` | 最多四个键，机密信息已被屏蔽：`reason`（失败代码）、`changes`（`{field: {old, new}}`）、`items`（语义变更，`{kind, …}`——例如 `field.added`）和 `context`（简单事实） |

将该数据流发送到集中式日志存储，可在实例之外保留一份副本，任何能够管理该实例的人都无法触及——这正是内部威胁评审所需要的。收集方法参见[日志与审计流](operations.md#logging-and-the-audit-stream)。

## 客户端 IP 地址 { #client-ip-address }

**IP** 列记录的是客户端的地址，而不是后端前面那个代理的地址。自带的边缘 nginx 会把 `X-Real-IP` 请求头设为它接收连接的来源地址，后端之所以读取该请求头，是因为已发布的后端镜像设置了 **`TRUST_PROXY_HEADERS=true`**。不是有效 IP 地址的值会被丢弃，而不会被记录。

- **保持 `TRUST_PROXY_HEADERS` 开启**，只要每个请求都经由自带的 nginx 到达后端——默认堆栈、[Helm chart](kubernetes.md) 和[托管容器模板](managed-containers.md)都是如此。
- **将其关闭**（`TRUST_PROXY_HEADERS=false`），如果您直接暴露后端容器而前面没有自带的 nginx：此时客户端可以发送自己的 `X-Real-IP`，自行决定被记录的地址。
- **位于负载均衡器、Ingress 控制器或 CDN 之后**时，自带的 nginx 收到的每个连接都来自这一中间环节，因此仅凭它自身，会为每个用户记录负载均衡器的地址。请按下文所述，在 nginx 容器上设置 **`NGINX_TRUSTED_PROXIES`**。

### 位于负载均衡器之后 { #behind-a-load-balancer }

`NGINX_TRUSTED_PROXIES` 列出位于自带 nginx 之前的中间环节的地址，可以是 IP 地址或 CIDR 范围，用逗号或空格分隔。随后 nginx 会从这些中间环节添加的 `X-Forwarded-For` 请求头中读取客户端地址——但仅限来自所列地址之一的连接——并跳过该请求头中每一个所列地址，因此一串代理最终解析为第一个不属于您的地址。该地址会替换连接的地址，后端读取的 `X-Real-IP` 请求头会原样携带它。留空（默认值）表示不信任任何人。

要确定取值，请查看边缘 nginx 的访问日志（`docker compose logs nginx`、`kubectl logs deployment/turbo-ea-nginx` 或平台的日志查看器）：每行开头的地址就是需要信任的中间环节，最后一个带引号的字段是它发送的 `X-Forwarded-For` 请求头。

| 部署方式 | 设置位置 | 典型取值 |
|----------|----------|----------|
| Docker Compose，浏览器直接访问 nginx | — | 留空 |
| Docker Compose，位于您自己的反向代理之后 | `.env` 中的 `NGINX_TRUSTED_PROXIES` | nginx 所看到的反向代理地址 |
| 位于 Ingress 控制器之后的 [Kubernetes](kubernetes.md) | chart 值 `nginx.trustedProxies` | 集群的 Pod CIDR，例如 `10.244.0.0/16` |
| [AWS ECS Fargate](managed-containers.md#aws-ecs-fargate) | `NginxTrustedProxies` / Terraform `nginx_trusted_proxies` | 负载均衡器所在子网的 CIDR 范围 |
| [Azure Container Apps](managed-containers.md#azure-container-apps) | `nginxTrustedProxies` / Terraform `nginx_trusted_proxies` | 环境的基础结构子网 |
| [Google Cloud Run](managed-containers.md#google-cloud-run) | 清单中的 `NGINX_TRUSTED_PROXIES` / Terraform `nginx_trusted_proxies` | 访问日志中显示的地址 |

列表应当与中间环节本身一样窄。每个所列地址在指明客户端时都会被采信，因此如果列入您的用户所连接的地址范围——例如在内部部署中列入整个 `10.0.0.0/8`——他们中的任何人都可以向日志写入另一个地址。不做设置时，该列显示的是负载均衡器：用处不大，但绝不会被伪造。

登录速率限制按同一请求头中的客户端地址统计尝试次数，因此在负载均衡器之后，这一设置也能避免某个人的失败尝试拖慢其他所有人。这适用于经由边缘 nginx 到达后端的登录；MCP 服务器直接登录后端，因此它自身的登录调用仍共用 MCP 容器的地址。 按客户端计数的键与审计日志一样信任该请求头：它假定登录请求只经由边缘 nginx 到达后端，随附的 compose 文件和 Helm chart 通过不暴露后端来保证这一点。能够直接访问后端的调用方可以自行设置该请求头来选择自己的配额；请保持后端不对外暴露，或关闭 `TRUST_PROXY_HEADERS`。
