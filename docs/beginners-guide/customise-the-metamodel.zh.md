# 轻量化地定制元模型

Turbo EA 的元模型完全是**管理员可配置的**——每个卡片类型、字段、子类型、关系和干系人角色都是数据，而非代码。您会忍不住想重新设计它。**别这么做。**

成功的团队**只有在默认字段无法回答他们的问题时**才会定制元模型。失败的团队会把第一个月花在把 `Application` 重命名为 `Solution`、添加 30 个自定义字段上，最终从未走到一份可用的报告。

## 元模型中已经包含了什么

在添加任何东西之前，先了解您已经拥有什么。内置的 **Application** 卡片类型开箱即带有以下字段（以及其他字段）：

| 内置字段 | 类型 | 用途 |
|----------------|------|--------------|
| `businessCriticality` | `single_select` | 关键任务 / 重要 / 有用 / 边缘 |
| `functionalSuitability` | `single_select` | 完美 / 合适 / 不足 / 不合理 |
| `technicalSuitability` | `single_select` | 完全合适 / 充分 / 不合理 / 不适当 |
| `timeModel` | `single_select`（必填） | **Tolerate / Invest / Migrate / Eliminate**——经典的 Gartner TIME 处置 |
| `riskLevel` | `single_select` | 低 / 中 / 高 / 关键 |
| `businessValue` | `single_select` | 驱动组合报告的 Y 轴 |
| `costTotalAnnual` | `cost` | 年度总成本 |
| `lifecycle.*` | 日期 | 计划 / 引入 / 活跃 / 退出 / 生命周期结束 |

应用组合合理化所需的一切都已经在那里了，**TIME 模型**也包含在内。您不需要再添加 TIME 字段——只需填入即可（手动填入或通过计算字段填入，参见[您的首次分析](your-first-analysis.md)）。`functionalSuitability` 和 `technicalSuitability` 这两个传统上驱动 TIME 定位的适配性维度也同样是内置字段。

## 添加字段前的两问测试

当您真的发现自己需要一个确实不在元模型中的字段时，请自问：

1. **我会用这个字段来过滤、分组或报告吗？** 如果不是，它属于描述或标签——不是字段。
2. **同一种类型的每张卡片都需要这个相同的答案吗？** 如果不是，它是一个关系或附件，不是字段。

如果两个问题都不能回答「是」，就不要加这个字段。

## 如果您确实需要一个自定义字段

对于罕见的、确实需要全新字段的情况（例如 `cloudReadiness` 标志、监管分类、客户细分标记），工作流程是：

1. 进入**管理员 → 元模型**，点击该类型，切换到**字段**标签页。
2. 选择分区（或新建一个），点击 **+ 添加字段**。
3. 填写：
    - **键** 使用小驼峰命名（例如 `cloudReadiness`）——将成为 JSON 中和公式中的属性键。
    - **标签**（并为您支持的每种语言添加翻译——否则非英语用户将看到原始的键）。
    - **类型**——`text`、`number`、`cost`、`boolean`、`date`、`url`、`single_select`、`multiple_select`。
    - **权重**——`0` 表示不计入数据质量，`1`+ 表示计入并加权。
    - **必填**——首次上线时请**保持关闭**；一旦必填，会阻止所有现有卡片被批准。
4. 对于选择类型，添加选项（键 + 标签 + 颜色）并翻译每个选项。
5. 保存。

该字段会立即在**资产清单**（列、过滤器）、卡片详情和**计算**公式中以 `<fieldKey>` 形式可用。完整参考：[管理员 → 元模型](../admin/metamodel.md)。

## 选项：通过计算自动推导字段 { #option-derive-a-field-automatically-with-a-calculation }

除了让用户手动填写字段这种标准方式之外，Turbo EA 还可以使用**计算**功能，根据同一张卡片上的其他字段（包括内置字段）**自动计算字段值**。计算出的字段将变为只读并带有「calculated」徽章，使用户无法偏离规则。

最典型的示例是从业务适配维度和技术适配维度推导出 Application 上内置 `timeModel` 字段的 **TIME 模型**计算。当您在**管理员 → 元模型 → 计算**中新建计算时，它已作为**公式参考**面板中的条目之一提供，因此您可以直接从面板中选取。目标类型 = `Application`，目标字段 = `timeModel`；面板提供的公式收录在[管理员 → 计算 → 示例公式](../admin/calculations.md#example-formulas)中。

该公式假定存在两个名为 `businessFit` 和 `technicalFit` 的 `single_select` 字段，选项为 `excellent` / `adequate` / `insufficient` / `unreasonable`。它们并不在内置元模型中——如果您希望使用此计算，请按上述自定义字段步骤在 Application 上添加它们。

!!! warning "Don't"
    计算出的 TIME 是一个**起步假设**，而不是裁定结果。要么在采信前与应用负责人逐项评审每个结果，要么在校验工作坊完成后关闭计算，依赖手动录入。

实践中行之有效的混合模式：在构建资产清单且您主要拥有适配性数据时保持计算开启；在校验工作坊期间关闭计算；之后让它保持关闭，使手动决策得以保留。

## 备选方案：改用标签组

如果该值是信息性而非可查询的，那么**标签组**（管理员 → 标签）比自定义字段更轻——无需更改元模型，无需迁移，更易演进。在以下情况使用标签组：

- 该值是描述性的（「面向客户」、「仅内部」、「2024 年收购」）。
- 您可能会频繁添加新选项。
- 您不需要在过滤下拉框中使用它，能边输入边搜索的标签芯片即可。

在以下情况使用自定义字段：

- 您需要把该值用在组合报告的轴上（X、Y、颜色）。
- 您希望把它纳入数据质量的加权计算。
- 它是一份不会频繁变化的受控词表。

## 应避免的反模式

以下是首次推广中最常见的元模型错误：

!!! warning "不要重命名内置卡片类型"
    把 `Application` 重命名为 `Solution` 看起来整洁，但会破坏能力热力图、组合报告和各类目录都依赖的概念映射。如果您的组织把它们称为「Solutions」，请设置**标签**的翻译——底层的 `key` 仍然保持为 `Application`。

!!! warning "不要在第一天就添加 30 个自定义字段"
    每个自定义字段都会增加数据收集的摩擦，并稀释数据质量分数。先加一个字段，用一个月，再加下一个。

!!! warning "不要重复创建内置字段"
    在添加 `timeDisposition`、`funcFit`、`techFit` 或 `appBusinessValue` 之前，请检查已有的字段列表——很有可能已经存在等效的内置字段（`timeModel`、`functionalSuitability`、`technicalSuitability`、`businessValue`）。重复字段会让数据分裂并破坏报告。

!!! warning "不要在第一天就让新字段成为 `required`"
    `Required` 会阻止每张没有该值的现有卡片被批准。等您为 80% 以上的卡片填好值**之后**，再把字段设为必填。

!!! warning "不要用自定义卡片类型替代自定义字段"
    「移动应用」应当是 `Application` 的一个子类型，而不是一个新卡片类型。新类型不会免费获得能力映射、组合报告或目录导入。

## 其他可能用到的轻量扩展

以下是常见的第二轮扩展，但**只在真的需要时再添加**：

| 需求 | 添加位置 | 类型 |
|------|-------------|------|
| 云就绪度 | Application | `single_select`（就绪 / 需要重构 / 留在本地） |
| 面向客户标志 | Application | `boolean` |
| 监管分类 | Application、DataObject | `multiple_select`（GDPR、PCI-DSS……） |
| 失稳风险类别 | Application、IT Component | `single_select`（单点故障等） |
| 成本拆分 | Application | 额外的 `cost` 字段，例如 `costRunTotalAnnual`、`costChangeTotalAnnual` |

每一项都通过了用于组合分析的两问测试。其中几项也很适合改成**计算**公式而非手动录入——这正是下一页的内容，并以 `timeModel` 本身作为完整示例。

下一步：[您的首次分析：应用合理化](your-first-analysis.md)。
