# Digital Autonomy Assessment

**Digital Autonomy Assessment** 把乌得勒支大学的 **Digital Autonomy Assessment
Framework（DAAF）** 引入 Turbo EA，落在应用层面。它为每张应用卡片增加一个
**Digital Autonomy** 区块——22 项加权指标，分布于风险暴露、缓解能力与战略重要性
三个维度，每项按 DAAF 原始评分表以 1–5 打分并附有内嵌说明——自动计算 1–10 的自
主性评分，并把整个应用组合绘制在**自主性四象限**图上。

它回答了大多数架构图谱回避的问题：*如果这家供应商明天不再可用、不再负担得起，或
在法律上不再可用，我们的暴露程度有多高，又真正能做些什么？*

!!! note "界面语言"
    该框架内容提供英语、德语、法语、西班牙语、意大利语和丹麦语。在中文界面下，
    该区块与各项指标以**英文**显示，因此下文引用的标签与屏幕所见一致。

## 概览

| | |
|---|---|
| **许可** | **免费**——无需任何许可授权即可运行 |
| **Turbo EA 最低版本** | 2.17.0 |
| **权限** | `ext.digital-autonomy.view` |
| **数据访问授权** | 无 |
| **是否需要重启后端** | 否 |
| **出现位置** | 应用卡片上的 **Digital Autonomy** 与 **Digital autonomy score** 区块 · **报告 → Digital Autonomy** · 调查页面的**从模板新建** |

## 快速上手

1. 从**管理 → 扩展**安装。无需应用许可证，也无需重启——字段立即出现。
2. 在**管理 → 用户与角色**中，把 `ext.digital-autonomy.view` 授予需要查看该报告
   的角色。管理员已经拥有该权限。
3. 决定采用**快速**评估还是**完整**评估——参见
   [快速评估还是完整评估](#快速评估还是完整评估)。默认启用 22 项指标的完整版。
4. 为应用打分，逐张卡片进行，或[通过调查收集](#通过调查收集评分)。

## 指标

**Digital Autonomy** 区块出现在每张应用卡片上，按八个维度（A–H）分组。每项指标
以**1–5**按其各自的评分表打分。

![应用卡片上的「Digital Autonomy」区块](../assets/img/en/65_ext_digital_autonomy_indicators.png)

点击数字即可打分；再次点击已选中的数字则清除。将鼠标悬停在某个数字上会显示该级别
的评分表文字，每项指标还带有可展开的**帮助**，内含 DAAF 说明及其所用术语的定义
（*充分性决定*、*CLOUD Act*、*FISA 702* 等）。

标注为**快速**的指标构成快速评估。

| 维度 | 指标 | 权重 | 快速 |
|---|---|---|---|
| **A · 地缘政治与法律合规风险** | A1 · Supplier jurisdiction | 3 | ✔ |
| | A2 · Sanctions and geopolitical risk | 2 | |
| | A3 · Hosting and data location | 2 | ✔ |
| **B · 供应商与供应链依赖** | B1 · Vendor concentration | 3 | ✔ |
| **C · 技术韧性** | C1 · Alternative available | 3 | ✔ |
| | C2 · Migratability | 3 | |
| | C3 · Data portability | 3 | |
| | C4 · Encryption management | 2 | |
| | C5 · Software transparency and openness | 3 | |
| **D · 组织韧性** | D1 · Internal expertise and knowledge continuity | 3 | ✔ |
| | D2 · Exit plan in place | 3 | |
| | D3 · Backup strategy | 2 | |
| **E · 合同韧性** | E1 · Exit clauses and transition arrangement | 3 | ✔ |
| | E2 · Contractual flexibility | 2 | |
| **F · 组织重要性** | F1 · Impact on outage | 3 | ✔ |
| | F2 · Integration dependencies | 2 | |
| **G · 数据敏感性、访问管理与政策** | G1 · Personal data | 3 | ✔ |
| | G2 · Research data and knowledge security | 3 | |
| | G3 · Intellectual property | 2 | |
| **H · 学术影响** | H1 · Academic freedom | 3 | ✔ |
| | H2 · Research collaboration | 2 | |
| | H3 · Long-term archiving | 2 | |

!!! note "哪个方向才是好的？"
    各评分表的方向并不一致，控件会据此着色。对于**风险**类指标（A、B、F、G、H），
    **1 为最佳**——例如 A1 的第 1 级是「EU/EEA jurisdiction. No extraterritorial
    claims. Full EU protection.」，第 5 级是「No adequacy decision, no safeguards.
    Direct access by foreign governments.」。对于**能力**类指标（C、D、E），
    **5 为最佳**。您无须刻意记忆：按钮按颜色分级，两端分别标注 **Low** 与
    **High**。

## 评分

只读区块 **Digital autonomy score** 位于指标下方，每次保存时自动重算。

![应用卡片上计算得出的自主性评分](../assets/img/en/64_ext_digital_autonomy_score.png)

| 字段 | 含义 |
|---|---|
| **Risk exposure** | 维度 A（地缘政治）与 B（供应商集中度）的加权平均 |
| **Mitigation capacity** | 技术（C）、组织（D）与合同（E）韧性的加权平均 |
| **Strategic importance** | F（组织重要性）、G（数据敏感性）与 H（学术影响）的加权平均 |
| **Digital autonomy score** | 综合三者得出的 1–10 单一数值，以仪表形式显示 |

**数值越高越好**——10 为最优，1 为紧急。

!!! warning "评估不完整则完全不出分"
    所有公式都有保护：只要缺少任何一项所需指标，评分就保持为空，而不会给出误导性
    的数字。只有评估完整的应用才会出现在四象限报告中。

由于评分像其他字段一样存储在卡片上，因此在任何地方都能取用：清单、筛选器、导出以
及您自己的报告。

## 快速评估还是完整评估

扩展提供**同一组四个计算的两种变体**——一种读取全部 22 项指标，另一种只读取快速
评估的九项。哪一组处于**启用**状态，既决定计算内容，*也*决定卡片显示多少项指标。

在**管理 → 元模型 → 计算**中切换：

- **完整评估（默认）**——名为 *Digital Autonomy — … (full)* 的四行处于启用状态，
  *(quick)* 四行停用。卡片显示全部 22 项指标。
- **快速评估**——启用 *Digital Autonomy — … (quick)* 四行并停用 *(full)* 四行。
  卡片仅显示九项快速指标，评分也据此计算。

!!! tip "没有单独的显示开关"
    计算页面上的这一个选择就是全部开关。快速集合一旦启用，卡片会自动隐藏仅属于完
    整评估的 13 项指标，报告也遵循同一设置。切勿同时启用两种变体——它们写入相同的
    字段。

## 通过调查收集评分

与其自己为每个应用填写 22 项指标，不如去问真正了解情况的人。在**管理 → 调查**中
使用**从模板新建**：

- **New DAAF survey — Quick (9)** 创建 *DAAF Quick Scan* 草稿。
- **New DAAF survey — Full (22)** 创建 *DAAF Full Assessment* 草稿。

两者都以应用卡片为目标，并在调查生成器中以**草稿**形式打开，因此在您审阅之前不会
发出任何内容。选择应当接收调查的干系人角色（以及所需的筛选条件——生命周期阶段、
子类型），然后发送。受访者看到的是与卡片上相同的 1–5 打分控件和相同的内嵌帮助；
应用回复后，评分会写回卡片。

您可以随时从模板生成新的调查——年度重新评估只需一次点击。

## 自主性四象限报告

**报告 → Digital Autonomy** 绘制每个已完整评估的应用。

![「Autonomy quadrant」报告](../assets/img/en/63_ext_digital_autonomy_quadrant.png)

横轴为**风险 × 战略重要性**，纵轴为**缓解能力**（高在上方），由此形成四个象限：

| 象限 | 含义 | 应对 |
|---|---|---|
| **Optimal** | 暴露低、缓解强 | 保持现状并定期监控。 |
| **Manageable** | 暴露高，但有可靠的备选方案 | 在有可靠退路的前提下接受风险。 |
| **Attention** | 暴露低、缓解弱 | 建立缓解措施，或有意识地接受风险。 |
| **Critical** | 暴露高、缓解弱 | 需紧急行动：迁移或缓解。 |

每个点都有编号，与图旁列表中的行一一对应，该列表**按评分升序排列——最紧急的排在
最前**。点击任一圆点或行，即可在侧面板中打开该应用，无须离开报告。

**筛选器与坐标轴**

- **Risk exposure**、**Mitigation capacity** 与 **Strategic importance** 选择器可
  将其他数值字段放到各坐标轴上——如果您维护着自己的等价指标，这会很有用。您的选择
  会记录在浏览器中。
- **生命周期**与**子类型**可缩小范围。

该报告支持常规的保存、共享、打印与导出。保存后的视图出现在**报告 → 已保存**中。

## 权限

| 权限 | 允许 |
|---|---|
| `ext.digital-autonomy.view` | 查看**报告 → Digital Autonomy** 报告 |

为指标打分使用的是您对应用卡片的常规**编辑**权限：能编辑应用的人就能为其打分。在
快速与完整模式之间切换，以及从模板创建调查，则需要**计算**与**调查**页面的常规管
理员权限。

## 停用或移除扩展后

停用或卸载会从卡片类型中移除这两个区块，但**绝不会触碰卡片上已保存的取值**。重新
启用扩展后，每一项评分都会原样回归。字段是以叠加方式合并的，因此管理员自行在这些
区块中添加的字段同样会被保留。

## 语言

指标标签、问题、评分表与帮助文本提供**英语、德语、法语、西班牙语、意大利语和丹麦
语**。在葡萄牙语、中文、俄语和阿拉伯语环境下，框架内容回退为英语——原始框架未提供
这些语言。

## 署名与许可

本扩展复现了**乌得勒支大学**由 **Tim van Neerbos**（首席企业架构师）在 Digital
Autonomy 项目中创建的 **Digital Autonomy Assessment Framework（DAAF）**。

- 来源：<https://github.com/utrechtuniversity/digital-autonomy-assessment-tool>
- 原始工具：<https://utrechtuniversity.github.io/digital-autonomy-assessment-tool/>
- 许可：**知识共享 署名-非商业性使用-相同方式共享 4.0 国际
  （CC BY-NC-SA 4.0）**——<https://creativecommons.org/licenses/by-nc-sa/4.0/>
- © 2026 Universiteit Utrecht — Tim van Neerbos

**已作出修改。** 该框架的指标、权重、评分表、帮助说明与 1–10 评分经过调整，以便在
Turbo EA 内部于应用卡片层面原生运行——包括专用的 1–5 评分字段类型、各层级与总分的
计算、调查模板以及自主性四象限报告。

评分表与帮助文本的多语言译文来自 DAAF 项目（在 **Thomas Steenbergen（SIVON）** 协
助下完成；据来源说明，德语、法语、西班牙语、意大利语和丹麦语为尽力而为的译文，尚
未经母语者审校）。

依据该框架的**非商业性使用**条款，本扩展**免费**发布；依据**相同方式共享**条款，
其中所含经改编的 DAAF 内容仍以 CC BY-NC-SA 4.0 授权。
