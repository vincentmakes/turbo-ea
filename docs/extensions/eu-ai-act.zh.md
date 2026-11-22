# EU AI Act Register

欧盟《人工智能法案》分阶段适用，每一个 AI 系统的提供者和部署者都必须回答同样的四个问题：您的哪些系统属于 AI 系统，每个系统属于哪一风险等级，您的角色带来哪些义务，证据又在哪里？

**EU AI Act Register** 直接在您的 EA 仓库已有的卡片上回答这些问题。它面向在 Turbo EA 中管理（或希望管理）其 IT 全景的 AI 系统与通用目的 AI（GPAI）模型的提供者和部署者。

!!! warning "它记录的是您自己的评估——并非法律意见"
    本登记册依据经第 (EU) 2026/1744 号条例修订的第 (EU) 2024/1689 号条例构建。它记录并整理贵组织自身的合规工作以及相关人员所做的决定。它不是法律意见，也不保证合规。

## 登记册就存在于您的卡片之上

登记册的内容**没有任何自有数据表**。每一个监管属性都是卡片上的一个字段，在 Turbo EA 自带的卡片详情中编辑，并附有引用条款的帮助文字：

| 登记册对象 | 在 Turbo EA 中 |
|---|---|
| AI 系统 | 已开启 *In AI Act scope* 的**应用程序**卡片 |
| 通用目的 AI 模型 | 已开启 *GPAI model (Art. 3(63))* 的 **IT 组件**卡片 |
| 组织的 AI 治理 | **组织**卡片 |

该扩展新增以下分区：

| 卡片类型 | 分区 | 包含 |
|---|---|---|
| **应用程序** | EU AI Act | In AI Act scope, Operator role, Risk tier, Annex III category, Annex I regime, Placed on the market before the high-risk date (Art. 111(2)), Art. 6(3) derogation claimed, Art. 6(3) rationale, Intended purpose, Art. 50 transparency duties, Substantially modified (Art. 25), AI Act classification completeness (%) |
| **应用程序** | EU AI Act — Provider obligations | 每项提供者义务一个状态，从第 9 条到第 73 条 |
| **应用程序** | EU AI Act — Deployer obligations | 第 26 条每项部署者义务一个状态、FRIA（FRIA required、其状态与日期）以及第 49(3) 条的登记 |
| **IT 组件** | EU AI Act — GPAI / Model | GPAI model (Art. 3(63)), Model origin, Systemic risk (Art. 51), Training compute (log10 FLOPs)、第 53 条与第 55 条的义务状态、AI Act classification completeness (%) |
| **组织** | AI governance (EU AI Act) | AI literacy programme (Art. 4), Body governed by public law, AI governance contact |

每项义务的状态为 **Not started**、**In progress**、**Implemented** 或 **Not applicable** 之一。

字段只在相关时显示。应用程序在被保存为属于适用范围之前，只显示 *In AI Act scope* 开关。之后，每个义务状态仅在该义务可能适用于该卡片的角色、风险等级和条件时才出现；*Placed on the market before the high-risk date (Art. 111(2))* 字段出现在高风险系统上；IT 组件的 GPAI 字段则随其 GPAI 开关而定。已经填写的状态始终可见，以便清除；被隐藏的值会保留，绝不会被删除。

**页眉标签。**每张 AI 系统和 GPAI 模型卡片的页眉都显示 **Obligations implemented**——例如 *Obligations implemented: 0 of 1*。其提示框列出仍未完成的事项，并给出每项义务的状态和到期日，同时指出缺失的分类输入；点击后会在工作台中打开该系统尚未完成的义务。没有可统计内容时，它显示 **No AI Act obligations apply**、**AI Act obligations: classify first** 或 **Prohibited practice (Art. 5)**。

![带有 EU AI Act 分区和页眉标签的 AI 系统卡片](../assets/img/en/107_ext_eu_ai_act_card.png)

### 两项度量

登记册报告两个数字，它们回答不同的问题——一个系统可能已完全完成分类，却没有任何义务得到落实。

| | Classification completeness | Obligations implemented |
|---|---|---|
| **问题** | 分类信息记录了多少？ | 适用的义务中有多少已满足？ |
| **AI 系统** | Operator role、风险等级、预期用途，以及高风险系统的附件 III 类别或附件 I 体系 | 按角色、风险等级和所选义务适用于该系统的各项义务 |
| **GPAI 模型** | 模型来源与系统性风险分类 | 第 53 条的义务；对具有系统性风险的模型，另加第 55 条 |
| **显示位置** | 卡片字段 *AI Act classification completeness (%)*、仪表板 | 卡片页眉标签、仪表板、Register 以及 Obligations 标签页 |

**Implemented** 与 **Not applicable** 计为已满足；**In progress** 与 **Not started** 则不计。没有百分比时，登记册会说明原因：**No obligations apply**、**Classify first**（角色或风险等级尚未设置）或 **Prohibited practice**（无可落实之事——该系统必须停用，或重新设计以脱离第 5 条的范围）。

## 概览

| | |
|---|---|
| **许可** | 商业——需要已签名的许可授权 |
| **Turbo EA 最低版本** | 2.186.0 |
| **权限** | `ext.eu-ai-act.view`、`ext.eu-ai-act.manage`、`ext.eu-ai-act.submit`、`ext.eu-ai-act.admin` |
| **数据访问授权** | `core.cards.read`、`core.cards.write`、`core.users.read`、`metamodel.custom_field_types` |
| **是否需要重启后端** | 是——包含后端代码 |
| **出现位置** | **GRC** 菜单下的 **EU AI Act**，共七个标签页（当您无法使用 GRC 菜单时，则为顶层入口） · **报告 → EU AI Act - Dashboard**（可保存为报告的仪表板） · 卡片上的 EU AI Act 分区与 **Obligations implemented** 页眉标签 · 四个问卷模板 · Excel 登记册工作簿以及 Annex IV / FRIA Word 文档 |

它还丰富了核心[合规扫描器](../guide/compliance.md)中的 **EU AI Act** 法规，该扫描器的 AI 发现会汇入 [Suggestions](#suggestions)。

## 快速上手

1. **打开 EU AI Act → Settings。**检查 **Taxonomy baseline**；如果期限应按今天以外的日期评估，请设置 **Reference date**；也可以选择加载演示数据。
2. **找出您已有的 AI 系统。**在 **Suggestions** 中点击 **Find suggestions**，接受属于适用范围的系统和模型。
3. **在 Classify 中对每个系统分类**，并将结果接受写入其卡片。
4. **在 Obligations 中跟踪义务**，将每个状态记录在卡片上。
5. **在 Audit 中冻结快照**，并从 **Register** 下载登记册工作簿以及 Annex IV 和 FRIA 文档。

!!! tip "向掌握数据的人收集数据"
    在**管理 → 问卷 → 从模板新建**中有四个问卷模板，用于向卡片所有者收集 AI Act 字段：**AI system intake (EU AI Act)**、**Provider obligations check (EU AI Act)**、**Deployer obligations check (EU AI Act)** 和 **GPAI model check (EU AI Act)**。每个模板都以草稿形式打开，并发给卡片的责任利益相关方。

## 工作台

**GRC** 菜单下的 **EU AI Act** 有七个标签页：**Dashboard**、**Register**、**Classify**、**Obligations**、**Suggestions**、**Audit** 和 **Settings**。其中每个列表都是一个 Turbo EA 表格，侧边栏与资产清单相同——一个 **Filters** 标签（跨所有列搜索，外加风险等级、角色、状态、严重程度或期限等分面）和一个 **Columns** 标签（显示、隐藏和冻结列，按表格记住设置）。点击指向某张卡片的行，会在卡片面板中打开它。

### Dashboard

五个磁贴——**AI systems in scope**、**High-risk**、**Unclassified**、**GPAI models** 和 **Overdue obligations**——每个都会打开其数字背后的行；另有一行 **Validation**，列出阻断性发现和警告，并附有 **Open audit** 链接。其下为：

- **Risk-tier distribution**——适用范围内系统的风险等级分布。
- **Compliance quadrant**——每个系统按监管暴露度（适用的义务）与 **Obligations implemented** 绘制，分为四个区域：**Act now**、**On track**、**Monitor** 和 **Comfortable**。位于同一位置的系统共用一个圆盘，圆盘上显示该处的系统数量。没有百分比的系统不会绘制；图下方有一行文字统计它们。
- **Ranked by urgency**——同样的系统以列表呈现，每项度量一列。点击某个系统会打开其**状态对话框**：两项度量及其明细、仍缺失的分类输入，以及带状态和到期日的未完成义务，并提供 **Open card** 和 **Show in Obligations**。
- **Applicability timeline (Art. 113)**——[Obligations](#obligations) 下表格中的各里程碑，每个都标记为已生效或倒计时中。

![EU AI Act 仪表板](../assets/img/en/104_ext_eu_ai_act_dashboard.png)

### Register

两个视图——**AI systems** 和 **GPAI models**——各为登记册中卡片的表格。对系统，它显示风险等级、角色、分类依据、**Obligations implemented**（点击会打开该系统尚未完成的义务）和逾期数量；对模型，则显示其来源、系统性风险、训练算力以及使用它的系统。**New AI system** 和 **New GPAI model** 会创建类型正确且已预设开关的卡片，**Open in inventory** 则在资产清单中列出同样的卡片。登记册的一行*就是*它的卡片：点击即可在卡片详情中编辑 AI Act 分区。

AI systems 视图的 **Documents** 列为每个系统提供两个 Word 下载，内容已根据仓库预先填写：**Annex IV.docx**（附件 IV 技术文档）和 **FRIA.docx**（第 27 条基本权利影响评估的框架）。两者开头都有一段说明，介绍面向中小企业和小型中市值企业的简化附件 IV 表格（第 11(1) 条），以及对数据保护影响评估的复用（第 27(4) 条）。

### Classify

分类向导针对某个系统提出一组引导式问题，并给出风险等级建议，每条理由都附有依据的条款。在 **Classify a system** 下选择系统并回答：

1. **AI system or not**——这是否为第 3(1) 条意义上的 AI 系统？若否，结果为 **Out of scope**。
2. **Role**——贵组织对该系统的运营者角色，以及您是否对其作了实质性修改、贴了自有品牌或更改了其预期用途（这可能使您依据第 25 条成为其提供者）。
3. **Prohibited practices (Art. 5)**——包括第 (EU) 2026/1744 号条例自 2026 年 12 月 2 日起禁止的两种做法：未经同意而生成可识别人员的逼真亲密或露骨性内容（第 5(1)(ba) 条），以及儿童性虐待材料（第 5(1)(bb) 条）。每一项都会说明相关方是作为提供者还是作为部署者。对于生成图像、视频、音频或文本的系统，其提供者还会被问到该系统是否可能产出此类内容，以及是否有保障措施能够可靠地阻止；只有回答这类保障措施并未到位，才会构成被禁止的做法。
4. **High risk under Annex I**——属于所列欧盟立法范围内的产品或产品的安全组件。选定一种体系后，向导会询问是否存在第 6(1a)–(1c) 条的某项理由使该系统脱离第 6(1) 条：它仅用于非安全方面，或该产品仅就健康和安全以外的风险由第三方评估。
5. **High risk under Annex III**——预期用途是否属于附件 III 的某个用例，以及该系统是否对自然人进行画像。
6. **The Art. 6(3) derogation**——是否适用某项豁免条件。所主张的豁免必须记录在 **Art. 6(4) rationale** 中；该文本会写入卡片，缺少它时校验会被阻断。
7. **Transparency duties (Art. 50)**——聊天机器人披露、合成内容标注、情绪识别告知、深度伪造及公共利益文本的标识。

**Evaluate** 显示带有依据条款的理由的 **Proposed classification**，并且不会向卡片写入任何内容。**Accept & write to card** 会把分类字段写入卡片——角色、风险等级、依据、豁免和透明度义务——并将该评估记录为已接受的评估。

运行向导需要该扩展的管理权限，以及一张您可以打开的卡片；接受则还需要对该卡片的编辑权限。如果您可以打开卡片但不能编辑，仍然可以运行向导并查看建议，但 **Accept & write to card** 会呈灰色并说明原因：*You may not edit this card, so the classification cannot be written to it.*

![显示建议分类的分类向导](../assets/img/en/105_ext_eu_ai_act_classify.png)

**评估历史就是审计线索。**每次运行都会保留——谁在何时、为何对哪个系统分类——因此「为什么这个系统是高风险，是谁决定的？」这个问题在多年后依然可以回答。每一行列出卡片（已归档的卡片标为 **archived**，已不存在的卡片显示为 **Deleted card**）、在 **By** 下运行它的人、风险等级和状态：**Draft**、**Accepted** 或 **Superseded**。再次运行向导会新增一条记录；接受它会把先前已接受的记录标记为 **Superseded**，且绝不修改它。评估的详情显示 **Run by**、**Accepted by**，以及在被后一条替代后显示 **Superseded by** 和日期——被替代的记录会保留其接受者。对于在 1.6.0 版之前被替代的记录，只知道替代它们的人，因此 **Accepted by** 显示「—」。历史仅列出您可以打开的卡片的评估。**Taxonomy baseline** 列默认隐藏；请在 **Columns** 下将其打开。

### Obligations

每个 AI 系统的每项适用义务——切换到 **GPAI model** 后则为每个 GPAI 模型的——集中在一个表格中：卡片、分组、义务、条款、状态、到期日、里程碑，以及说明该义务期望何种证明的 **Evidence hint**。可按状态、分组和期限（逾期、**Due soon**、**Later**）筛选，也可以在工具栏中选择单张卡片。状态是卡片字段，因此需打开卡片来记录；到期日未满足的义务即为逾期，尚未到期的义务从到期日前 180 天起显示 **Due soon**。

适用哪些义务取决于各系统的角色、风险等级和条件——在修订后的基线中，针对提供者、部署者和 GPAI 模型共计 32 项义务。其日期按第 (EU) 2026/1744 号条例修订后分阶段适用：

| 日期 | 里程碑 | 条款 |
|---|---|---|
| 2025 年 2 月 2 日 | 禁止的做法与 AI 素养 | Art. 113(a) |
| 2025 年 8 月 2 日 | 通用目的 AI 模型义务 | Art. 113(b) |
| 2026 年 8 月 2 日 | 一般适用（含第 50 条透明度） | Art. 113 |
| 2026 年 12 月 2 日 | 其他禁止的做法（第 5(1)(ba)、(bb) 条） | Art. 113(a) |
| 2027 年 12 月 2 日 | 附件 III 下的高风险 AI 系统 | Art. 113(c)(i) |
| 2028 年 8 月 2 日 | 附件 I 受监管产品中的高风险 AI | Art. 113(c)(ii) |
| 2030 年 8 月 2 日 | 已投放市场、供公共机关使用的高风险 AI | Art. 111(2) |

期限依据 Settings 中的 **Reference date** 评估（为空时即今天）。三条规则决定了列表的形态：

- **附件 I 第 B 节（第 2(2) 条）。**仅因属于附件 I 第 B 节所涵盖的产品——车辆、航空、船舶设备、铁路和机械——而成为高风险的系统，在登记册中不承担任何 AI Act 义务，显示 **No obligations apply**。已记录的状态仍保留在卡片上，但不计入统计。同时落入附件 III 某个用例的系统，则保留其全部义务。
- **已在市场上的系统（第 111(2) 条）。**请在高风险系统的卡片上记录其是否 *Placed on the market before the high-risk date (Art. 111(2))*。在该日期之前投放市场且设计未发生重大变更：高风险义务搁置（第 50 条透明度仍然计入）；在该日期之前投放市场且拟供公共机关使用：这些义务顺延至 2030 年 8 月 2 日；发生重大变更、未在该日期之前投放市场或留空：则全面适用。
- **登记适用豁免的系统（第 49(2) 条）。**主张第 6(3) 条豁免的提供者多一项义务：在欧盟数据库中将该系统登记为经评估不属于高风险的系统。

![涵盖所有 AI 系统的 Obligations 标签页](../assets/img/en/106_ext_eu_ai_act_obligations.png)

### Suggestions

**Find suggestions** 会遍历您的卡片并提出登记册决定，每条都附有证据：

- **AI Act scope**——尚未作出决定的应用程序，带有核心 AI 子类型之一（**AI Agent**、**MCP Server**），或被合规扫描器标记为具有 AI 功能。
- **GPAI check**——尚未作出决定的 IT 组件，具有 **AI Model** 子类型、带扫描器标记，或被已在适用范围内的系统使用。
- **Bootstrap checklist**——一个高风险系统，其适用的义务均尚无状态；接受后会把每一项设为 **Not started**，使工作变得可见。

列表上方的一条横幅链接到合规扫描器自身的 EU AI Act 发现。

只有当有人在某一行上点击 **Accept** 后，才会向卡片写入内容；**Dismiss** 会将其从列表中移除。状态——**Proposed**、**Accepted** 或 **Dismissed**——在侧边栏中选择。接受除管理权限外，还需要对该卡片的编辑权限；缺少时 **Accept** 呈灰色并说明：*You may not edit this card, so the suggestion cannot be written to it.*

### Audit

- **Live validation**——登记册在参考日期当前状态下的发现，每条都带有严重程度（**Blocking** 或 **Warning**）、规则、条款、卡片和消息；**Open card** 会打开需要修正的卡片。
- **Rule coverage**——机器无法检查的规则。它们被报告为未执行，因为需要人工判断，而不是被悄悄跳过。
- **Snapshots**——**Freeze snapshot** 在某个 **Reference date** 捕获登记册。每个快照随后经历三种状态：
    1. **Draft**——点击 **Validate** 进行检查。
    2. **Validated**——点击 **Finalize**。只要仍有阻断性发现，就会被拒绝。
    3. **Final**——快照不可更改，属于审计线索的一部分，不能再次校验，也不能删除。

  **XLSX** 将快照下载为 Excel 登记册工作簿（需要提交权限）。最终快照总是原样下载：其内容会与定稿时固定的哈希核对。草稿快照保留其生成时的日期和发现——规则变更的升级之后，请重新生成一个。

### Settings

**Taxonomy baseline**——所有投影和期限所依据的法规。**ai-act-2026-omnibus**（经第 (EU) 2026/1744 号条例修订的法规）为默认值；**ai-act-2024**（按原始日期通过的法规）仍可选择，以便针对它所做的评估和快照保持可读。

**Reference date**——期限依据此日期评估；为空表示今天。

**Demo data**——**Load demo data** 会生成一个小型演示全景：涵盖每个风险等级、一个具有系统性风险的 GPAI 模型、一条已接受的评估线索，以及用于建议的素材。所有演示卡片的名称中都带有 *(AI demo)*；**Remove demo data** 会再次将其删除。

## 谁能看到什么、能做什么

- **您只能看到您有权打开其卡片的系统。**登记册、义务、仪表板数字与时间线、发现、建议、评估历史以及 Annex IV / FRIA 文档，对每个人只显示其在资产清单中有权打开卡片的系统，并且每一个数字——计数、百分比、逾期项、阻断性发现——都基于其所能看到的内容计算。某个可见系统所引用、但您无权打开的卡片会显示 **Card not accessible**。有内容被省略时，仪表板和 Register 会用一行文字说明：*Some systems are not shown because you do not have access to their cards.* 没有任何内容可显示时，仪表板和 Obligations 标签页会用同一行文字代替空列表。因此，仅拥有该扩展权限而无法访问卡片的角色看不到任何系统。
- **快照涵盖整个登记册。**快照及其 Excel 下载是正式的登记记录：它们包含每一个系统，无论谁来查看都不会被过滤。拥有查看权限的所有人都能在 Audit 标签页看到快照列表；下载需要提交权限。通过 API，快照的存储内容只返回给拥有提交权限的人，以及登记册对其不隐瞒任何内容的人；其他人只收到其日期、基线和状态。
- **接受需要两项权限。**对于 **Accept & write to card** 以及接受某条建议，都需要该扩展的 `ext.eu-ai-act.manage` 权限**并且**对该卡片的编辑权限。可以打开卡片但不能编辑的人，仍然可以运行向导并查看建议；按钮会呈灰色并附原因，且不会写入任何内容。要让其能够接受，请为其角色授予该卡片类型的编辑权限，或让其以可编辑的角色成为该卡片的利益相关方。对您无权打开的卡片运行向导，或接受、忽略建议，都会被拒绝。
- **卡片历史会记录接受者。**在 Turbo EA 2.209.0 及更高版本中，由 **Accept & write to card** 或已接受的建议所做的更改，会以执行者的姓名记录在卡片的「历史」标签页中，并带有 **Extension** 标签。更早的版本显示 **System**。加载或移除演示数据会记录为该扩展所为。
- **评估历史只显示显示名称**——绝不显示电子邮件。无法读取名称时，显示「—」。

## 权限

| 权限 | 授予 |
|---|---|
| `ext.eu-ai-act.view` | 查看 AI 系统登记册、仪表板和校验结果 |
| `ext.eu-ai-act.manage` | 运行分类、编辑 AI Act 数据并决定建议 |
| `ext.eu-ai-act.submit` | 冻结登记册快照并下载登记册导出 |
| `ext.eu-ai-act.admin` | 配置 AI Act 设置（分类体系版本、参考日期、演示数据） |

编辑登记册数据本身还会用到您通常的卡片编辑权限，因为每个 AI Act 字段都位于卡片上。

## 许可过期或扩展被停用时

工作台及其报告会消失，但**不会删除任何内容**。您的 AI Act 数据位于普通卡片上，因此每个值都原样保留，在资产清单中可见且可编辑。应用续期后的许可会立即恢复工作台。

## 说明与限制

- 校验只涵盖机器可以检查的内容。它无法检查的规则会在 **Rule coverage** 下列为未执行；请把一次干净的校验视为检查清单，而不是合规结论。
- 卡片字段由两个基线共用，卡片无法得知当前选择的是哪个基线。在 **ai-act-2024** 下，带有附件 I 第 B 节体系的高风险卡片会隐藏该基线仍然计入的义务状态，并且尽管该基线忽略第 111(2) 条字段，该字段仍会显示。登记册、仪表板和导出始终遵循所选的基线。
- 在基线提供翻译的情况下，向导的回答选项会以您的语言显示。
- 从早期版本升级后，请针对受监管产品中的 AI（附件 I 的理由）和生成内容的系统（保障措施问题）重新运行向导，并记录已在市场上的高风险系统的第 111(2) 条状态。
