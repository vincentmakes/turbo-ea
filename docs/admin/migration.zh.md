# 平台迁移

> 当前支持的源平台：**SAP LeanIX**。其他适配器（Ardoq、Mega HOPEX、BiZZdesign、Avolution Abacus 等）接入相同的暂存与应用流水线，发布后会自动出现在上传对话框中。

平台迁移导入器（**管理 → 设置 → 迁移**）将一个完整的 LeanIX 工作区作为 Turbo EA 卡片、关系、标签、相关方、文档、评论以及完整构建的元模型，在一次可审阅的分阶段操作中导入。

## 适用对象？

从 LeanIX（SAP LeanIX）迁移到 Turbo EA 的客户。导入器接受 LeanIX **Full Snapshot** xlsx 工作簿 — 即多表导出，每个 fact sheet 类型一张工作表、每种关系类型一张工作表，外加 `TagGroups`、`Tags`、`Documents`、`Comments`、`Types` 和一张 `ReadMe` 参考表。其它格式的上传将在上传步骤即被拒绝，并附明确的错误提示。

## 如何获取导出

在 LeanIX 中打开 **Administration → Export → Full Snapshot**。该操作会生成一份 XLSX 工作簿，包含所有**活跃**的 fact sheet 及其关系、标签组、标签、文档（LeanIX 中称为 *resources*）和评论。

**已归档的 fact sheet 不包含在 Full Snapshot 中** — 如需将其导入 Turbo EA，请先在 LeanIX 中将其恢复。

## 工作流程

1. **上传**快照：**设置 → 迁移 → 新建迁移**。文件保留在服务器磁盘上；数据库仅存储元数据。解析在后台运行，状态会自动从 `uploaded → parsed`。

2. **审阅**每种实体类型的标签页视图。每条 staged 行带有一个动作：
    - `create` — 将添加到 Turbo EA
    - `update` — 已存在；diff 字段将被合并
    - `skip` — 已存在且无变更
    - `conflict` — 端点缺失、类型未映射、与 built-in 冲突、邮箱格式错误等 — 详见 *Note* 列查看完整原因

    每个标签页在表格上方显示一行**筛选小药丸** — 适用时按卡片类型一个，否则按动作 — 便于将长列表（数百张卡、数十种 fact sheet 类型）一次缩小到一个切片。**卡片**标签页在源 UUID 旁边显示已解析的**卡片名称**。*Note* 列显示完整冲突原因；`update` 行列出已更改的字段名，并附带工具提示详述 `旧 → 新` 的过渡。

    **新类型**、**自定义字段**和**新关系**标签页展示来自您源工作区的租户自定义元模型。默认情况下原样接受，并在 Turbo EA 中创建对应的非 built-in 卡片类型 / 字段 / 关系类型。

3. **映射导入字段**（可选，在**自定义字段**标签页中）。为每一个源平台自定义列，从行旁的下拉菜单中选择三种结果之一：
    - **作为新自定义字段导入**（默认）— 该列作为新属性落到目标卡片类型上，位于一个合成的 *Imported from {source}* 区段。
    - **映射到已有的 Turbo EA 字段** — 值被路由到目标卡片类型的 built-in 字段（例如把 LeanIX 的 `businessCriticality` 送到 TEA 自身的 `businessCriticality` 槽位）。应用时则跳过该元模型字段行，不会创建孤立的列。
    - **映射到生命周期阶段** — 对于日期列，值被路由到 `card.lifecycle` 中的标准槽位 `plan` / `phaseIn` / `active` / `phaseOut` / `endOfLife`。日期/datetime 值自动转换为 `YYYY-MM-DD`（某些平台为 datetime 单元格写入的 `T00:00:00` 后缀会被去除）；无法解析的值会被丢弃，以免破坏生命周期映射。
    - **不导入该字段** — 该列被完全跳过，既不作为属性也不作为元模型字段。

    映射按迁移生效，状态为 `parsed` 或 `previewed` 时可随时编辑。源平台核心列由适配器直接路由到 Turbo EA 标准槽位（例如 LeanIX 的 `name`、`displayName`、`description`、`status`、`category → subtype`、`lifecycle:*`、`qualitySeal`、`completion`），在标签页顶部以只读信息横幅列出 — 这些无需做映射决定。

4. **应用**：满意后即可。Apply 流水线在 12 个按依赖顺序排列的 pass 中（元模型类型 → 元模型字段 → 元模型关系类型 → 用户 → 卡片 → 标签组 → 标签 → 卡片-标签关联 → 关系 → 订阅 → 文档 → 评论），各自的 savepoint 内运行 — 单行失败不会污染整个 import。状态从 `applying → applied`（或 `failed`，如果错误超过安全阈值）。

    如果解析后的快照包含**冲突**行，staging 标签页上方会出现警告横幅（带可点击的小药丸，跳转到对应标签页），点击**应用**会打开确认对话框，详细列出哪些类型携带冲突。在 apply 执行前必须显式确认冲突行将被跳过。应用后的*应用结果*在 *已创建 / 已更新 / 已跳过 / 错误* 旁显示专门的 *冲突* 小药丸 — 冲突不是悄无声息的跳过，而是管理员在迁移历史中可见的一等结果。

## 导入的内容

| LeanIX | Turbo EA |
|---|---|
| Application、ITComponent、Business Capability、Business Context、Process、DataObject、Interface、Provider、TechCategory、Platform、Objective、Project / Initiative | 直接 1:1 卡片类型映射 |
| User Group | Organization，子类型 `team`，打上 `leanix_origin=UserGroup` |
| 生命周期阶段（plan / phaseIn / active / phaseOut / endOfLife） | 原样写入 `cards.lifecycle` |
| 层级关系（`childParentRelation`） | 折叠到 `Card.parent_id` |
| 后继/前序边（`*SuccessorRelation`） | 存储为关系；导入时翻转方向，使 Turbo EA 的「source 后继于 target」约定与 LeanIX 的「X 的后继是 Y」语义一致。新租户卡片类型的 `has_successors=true`，因此 lineage 视图可被渲染。 |
| 关系（50+ 种 LeanIX 默认边类型，xlsx 风格 `applicationITComponentRelation` 与 GraphQL 风格 `relApplicationToITComponent` 均支持） | Turbo EA 原生关系，含边属性 |
| 租户自定义关系类型（Server↔Application、lxSystem*、lxDora*、microservice*、ESG* 等） | 新的非 built-in `relation_types` 行，在同一次导入 pass 中自动创建，使每条边真正落地 |
| 标签（single/multi 组） | 标签组 + 标签 + 每卡 join |
| 订阅（每个 RESPONSIBLE/OBSERVER 角色一条） | 相关方行；用户自动创建为停用（`is_active=false`） |
| 文档（URL） | 文档附件 |
| 评论（顶级 + 回复，扁平化） | 评论行 |
| 租户自定义 fact sheet 类型（如 `ESGCapability`、`Server`、`System`、`TechPlatform`、`TechnicalStack`） | 新的非 built-in 卡片类型，`has_hierarchy=true`、`has_successors=true`，并预先填充 `Imported from LeanIX` 字段段落 |
| 租户自定义字段 | 追加到目标类型 `fields_schema` 中合成的 `Imported from LeanIX` 段落。字段类型和**完整**的枚举选项列表从工作簿的 `ReadMe` 参考表中提取 — 即使数据中只用到一个值，`currentMaturity` 也会以 single-select 形式落地，包含全部 5 个值（`adHoc, repeatable, defined, managed, optimized`） |
| 租户自定义关系类型 | 新的非 built-in 关系类型，端点类型通过 LX↔TEA 类型映射转换（`UserGroup → Organization` 等） |

### 为什么 ReadMe 表很重要

xlsx 的第一张表（`ReadMe`）是 LeanIX 的权威字段参考：每一列都注明了类型（`String`、`Integer`、`Percent`、`Datetime`、`Boolean`、`String list`），并在适用时给出完整枚举约束（`Possible values: one of A, B, C.`）。导入器优先读取这张表，并将其作为字段元数据的主要真实来源 — 仅当 ReadMe 未覆盖某列时才退回到数据内的 `Types` 表。这就是「导入字段是自由文本输入」与「带有正确选项的下拉框」之间的差别。

## **不**导入的内容

快照不包含以下内容 — 导入器在每行的 *Note* 列中标记缺失：

- **文档二进制文件** — 快照中只有 URL；导入器创建链接型文档行。请手动重新上传二进制文件。
- **评论 threading** — 回复扁平化为顶级评论以保留正文；线程父级需要快照中不存在的 LeanIX UI 元数据。
- **用户密码与 SSO 绑定** — 自动创建的用户落地时被停用。事后邀请或绑定 SSO。
- **导入之前的审计历史** — Turbo EA 历史从 apply 时间戳开始。
- **图表 / 海报视图 / 仪表板 / 已保存搜索 / 通知偏好 / API 令牌 / Webhook** — Turbo EA 中无对应物，或快照中无类似项。

## 重新运行 import

幂等性已内置。`migration_identity_map` 表记录每个已导入实体的 LeanIX → Turbo EA UUID 映射。重新上传相同快照（或同一工作区的更新快照）会检测已存在的实体并写入 `update`/`skip` staged 行，而非重复 `create`。卡片的 `external_id` 携带 LeanIX 的 `factSheetId`，因此即便 identity map 被清空，链接仍可恢复。

如需重做导入（例如您在 UI 中批量删除了已导入卡片，希望全部重新落地），请使用迁移行上的垃圾桶图标删除它，然后重新上传。`applied` 迁移可被删除；删除会释放按文件哈希的幂等锁，允许重新上传同一快照。`migration_identity_map` 中指向已不存在卡片的孤立行，会在下一次 staging pass 中自动剪枝 — 无需手动清理 identity map。

## 权限

此页面由 `admin.migrate` 权限保护。默认仅 **admin** 角色拥有；如需让非 admin 驱动迁移，请在**设置 → 角色**中显式授予其他角色。

## 需注意的限制

- **每个文件哈希仅允许一个进行中的迁移。** 当某哈希的迁移仍处于活动状态时，重新上传完全相同的字节将返回现有迁移记录（SHA-256 哈希是自然的幂等键）。如果确实想重新摄取同一文件，请先删除迁移记录。
- **大型工作区**（10k+ fact sheet）：解析器是流式的，但 apply 流水线每个 pass 在单个事务中写入行。超大 import 请规划约 15 分钟。
- **自定义字段、值和标签是被容忍而非预先映射。** 任何不在 Turbo EA built-in 元模型中的 LeanIX 列都会原样落入导入卡片的 `attributes` 映射，并出现在**自定义字段**标签页中，供管理员处理（路由到已有的 TEA 字段、映射到生命周期阶段、或跳过 — 参见上方流程中的*映射导入字段*）。租户自定义标签组以及源平台新增的关系类型（如 `lxSystemSystem*`、`*Lx*Dora*`、`microservice*`、`eSGCapability*`）亦同样处理 — 在**新类型** / **新关系**标签页中原样出现，等待管理员决定。
- **订阅邮箱可接受两种分隔符。** LeanIX 的「Full Snapshot」导出在 `subscriptions:<RoleType>[:<RoleName>]` 单元格中以 `;` 分隔邮箱；GraphQL CSV 导出使用 `,`。解析器两者都接受。邮箱格式错误的行（缺少 `@`，或分隔符未被拆开）会被 staged 为 `conflict` 并附带清晰原因，而不是创建为虚假用户 — 请修正源导出后重新上传。

## 清理

删除一条迁移记录（设置 → 迁移 → 垃圾桶图标）会同时移除该迁移在数据库中的行（staged 记录级联删除）和磁盘上的快照文件。`uploaded`、`parsed`、`previewed`、`failed`、`aborted`、`applied` 状态的迁移均可被删除；`applying` 状态的迁移必须先完成（或失败）才能移除。
