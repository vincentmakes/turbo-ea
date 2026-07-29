# 计算

**计算**功能（**管理 > 元模型 > 计算**标签页）允许您定义**在卡片保存时自动计算字段值的公式**。这对于从架构数据中派生指标、评分和聚合非常强大。

## 工作原理

1. 管理员定义一个针对特定卡片类型和字段的公式
2. 当该类型的任何卡片被创建或更新时，公式自动运行
3. 结果写入目标字段
4. 目标字段在卡片详情页面标记为**只读**（用户看到「计算字段」徽章）

## 创建计算

点击 **+ 新建计算**并配置：

| 字段 | 描述 |
|------|------|
| **名称** | 计算的描述性名称 |
| **目标类型** | 此计算适用的卡片类型 |
| **目标字段** | 存储结果的字段 |
| **公式** | 要执行的表达式（参见下方语法） |
| **执行顺序** | 同一类型存在多个计算时的执行顺序（数字越小越先执行） |
| **激活** | 启用或禁用计算 |

## 公式语法

公式使用安全的沙箱表达式语言。您可以引用当前卡片的字段、关联卡片与子卡片、父卡片以及生命周期日期。

!!! warning "请使用字段键，而非字段标签"
    字段通过其**键**引用，通常为驼峰式（`costTotalAnnual`），而不是卡片上显示的标签
    （`年度总成本`）。不存在的名称会解析为 `None`，对 `None` 做任何算术运算都会失败，
    并返回一个笼统的**求值错误**。

    您可以在**管理 > 元模型 >** *（卡片类型）* 中打开该字段，查看它的**键**。更简单的方式：
    在公式编辑器中，公式输入框下方的标签列出了所选类型每个字段的 `data.<键>`，输入
    `data.` 即可打开自动补全。

### 上下文变量

| 变量 | 描述 | 示例 |
|------|------|------|
| `data.<字段键>` | 当前卡片的任何自定义字段，通过其键引用 | `data.costTotalAnnual` |
| `data.name`、`data.description`、`data.status`、`data.subtype`、`data.approval_status`、`data.reference` | 卡片的内置属性 | `data.subtype` |
| `data.lifecycle.<阶段>` | 生命周期日期，阶段为 `plan`、`phaseIn`、`active`、`phaseOut` 或 `endOfLife` | `data.lifecycle.endOfLife` |
| `relations.<关系类型键>` | 通过该关系类型连接的卡片数组，两个方向均包含 | `relations.relAppToITC` |
| `relation_count.<关系类型键>` | 通过该关系类型连接的卡片数量 | `relation_count.relAppToITC` |
| `children` | 直接子卡片数组（层级类型） | `SUM(PLUCK(children, "attributes.costTotalAnnual"))` |
| `children_count` | 直接子卡片数量 | `children_count` |
| `parent` | 父卡片（包含 `id`、`name`、`type`、`subtype`、`attributes` 的对象），根卡片则为 `None` | `IF(parent, parent.attributes.businessCriticality, data.businessCriticality)` |
| `hierarchy_level` | 当前卡片在其父子层级中的深度（`1` = 根，无上限）。非层级卡片类型为 `1` | `hierarchy_level * 10` |

关系类型键即**管理 > 元模型 > 关系**中显示的键，例如 `relAppToITC` 或
`relInitiativeToApp`。方向无关紧要：无论卡片位于源端还是目标端，都能通过同一个键找到该关系
类型。已归档的卡片不会出现在 `relations`、`relation_count` 和 `children` 中。

### 读取关联卡片上的字段

`relations.<关系类型键>` 和 `children` 中的每一项都是一个包装对象，而不是关联卡片字段本身：

```json
{
  "id": "8f1c…",
  "name": "NexaCore ERP",
  "type": "Application",
  "attributes":     { "costTotalAnnual": 45000, "businessCriticality": "missionCritical" },
  "rel_attributes": { "costTotalAnnual": 12000 }
}
```

* `attributes` 保存关联卡片自身的字段值。
* `rel_attributes` 保存**存放在连接本身上**的值，前提是该关系类型定义了属性模式。例如
  `relAppToITC` 自带一个 `costTotalAnnual`，因此您可以记录某个应用在某个 IT 组件上的支出。

这对 `PLUCK` 和 `FILTER` 很关键：它们接收的是键路径，因此需要 `attributes.` 前缀才能取到
字段：

```
# 汇总该应用所使用 IT 组件的年度成本
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))

# 改为汇总记录在每条「应用—组件」连接上的成本
SUM(PLUCK(relations.relAppToITC, "rel_attributes.costTotalAnnual"))
```

直接提取 `"costTotalAnnual"` 这样的裸键，会在包装对象上查找，结果什么都找不到，返回一个全
是 `None` 的列表，而 `SUM` 会把它汇报为 `0`。一条关系公式若顽固地返回 `0`，几乎总是缺少
`attributes.` 前缀。

### 处理空值

没有值的字段会解析为 `None`，而算术表达式中的 `None` 会引发错误。请用 `COALESCE` 包裹每个
可能为空的字段：

```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

`SUM`、`AVG`、`MIN` 和 `MAX` 本身就会跳过非数值项，因此无需额外保护。

### Initiative 卡片上的 PPM 数据

`ppm` 根将 PPM 模块的预算行与成本行开放给公式，按 capex 与 opex 拆分并按财年细分 —— 这是卡片上汇总后的 `data.costBudget` / `data.costActual` 属性无法提供的细节。

| 变量 | 描述 |
|----------|-------------|
| `ppm.capexBudget`, `ppm.opexBudget`, `ppm.totalBudget` | 计划预算，来自 PPM 预算行 |
| `ppm.capexPlanned`, `ppm.opexPlanned`, `ppm.totalPlanned` | PPM 成本行上的计划金额 |
| `ppm.capexActual`, `ppm.opexActual`, `ppm.totalActual` | PPM 成本行上的实际金额 |
| `ppm.byYear` | 按财年划分的同样九项指标，形式为列表 `{year, capexBudget, …}` |
| `ppm.currentFiscalYear` | 今天所属的财年 |
| `ppm.unscheduledPlanned`, `ppm.unscheduledActual` | 没有日期的成本行：计入合计，但不属于任何财年 |

`byYear` 是列表而非以年份为键的对象，因此常规的 `FILTER` 和 `PLUCK` 函数可直接作用于它：

```
# 所有年度的 capex 预算合计
ppm.capexBudget

# 仅当前财年的 capex 预算
SUM(PLUCK(FILTER(ppm.byYear, "year", ppm.currentFiscalYear), "capexBudget"))

# 与此卡片关联的每个举措的 capex 预算
SUM(PLUCK(relations.relInitiativeToApp, "ppm.capexBudget"))
```

* **财年以其结束所在的日历年命名。** 若财年起始月为 10 月，则 2025 年 10 月 15 日属于 FY2026，2025 年 9 月 30 日属于 FY2025。使用默认的 1 月起始时，财年就等于日历年。
* **预算行与成本行的年份来源不同。** 预算行携带的是您填写的财年；成本行的年份由其日期推导。若贵组织按期间*开始*的年份为财年命名，两者就会不一致。
* `total*` 是所有行的合计，而非 `capex + opex`。类别不属于两者之一的行（例如来自导入）仍计入合计。
* 非举措类型的卡片读取所有 `ppm` 指标均为 `0`，且 `byYear` 为空，因此在错误类型上的公式返回零而不是报错。

编辑 PPM 预算行或成本行会重新运行该举措的计算，因此由此派生的一切会立即更新。通过关系读取*另一张*卡片 PPM 数据的卡片则不会刷新。

### 内置函数

| 函数 | 描述 | 示例 |
|------|------|------|
| `IF(condition, true_val, false_val)` | 条件逻辑。只有被选中的分支会被求值 | `IF(data.businessCriticality == "missionCritical", 100, 25)` |
| `SUM(array)` | 数值求和 | `SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `AVG(array)` | 数值平均 | `AVG(PLUCK(children, "attributes.numberOfUsers"))` |
| `MIN(array)` | 最小值 | `MIN(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `MAX(array)` | 最大值 | `MAX(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `COUNT(array)` | 项目数量 | `COUNT(relations.relAppToInterface)` |
| `ROUND(value, decimals)` | 四舍五入 | `ROUND(data.costTotalAnnual / 12, 2)` |
| `ABS(value)` | 绝对值 | `ABS(data.budgetVariance)` |
| `LN(value)` | 自然对数。对零、负数和非数值输入返回 `None` | `LN(data.numberOfUsers)` |
| `COALESCE(a, b, ...)` | 第一个非空值 | `COALESCE(data.customScore, 0)` |
| `LOWER(text)` | 文本转小写 | `LOWER(data.productName)` |
| `UPPER(text)` | 文本转大写 | `UPPER(data.subtype)` |
| `CONCAT(a, b, ...)` | 连接字符串 | `CONCAT(data.name, " (", data.subtype, ")")` |
| `CONTAINS(text, search)` | 检查文本是否包含子串 | `CONTAINS(data.description, "legacy")` |
| `PLUCK(array, 键路径)` | 从每项中提取一个键路径 | `PLUCK(relations.relAppToITC, "attributes.costTotalAnnual")` |
| `FILTER(array, 键路径, value)` | 保留键路径等于指定值的项目 | `FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise")` |
| `MAP_SCORE(value, mapping)` | 将分类值映射为分数 | `MAP_SCORE(data.businessCriticality, {"missionCritical": 3, "businessCritical": 2})` |

安全的 Python 内置函数 `len`、`str`、`int`、`float`、`bool`、`abs`、`round`、`min`、`max`
和 `sum` 同样可用，常规运算符和比较运算符也可以使用。

### 公式示例 { #example-formulas }

**同一张卡片上多个成本字段求和：**
```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

**某个应用所使用 IT 组件的年度总成本：**
```
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))
```

**基于关键性的风险评分：**
```
IF(data.businessCriticality == "missionCritical", 100, IF(data.businessCriticality == "businessCritical", 75, 25))
```

**关联接口数量：**
```
relation_count.relAppToInterface
```

**某个组织中本地部署应用的数量：**
```
COUNT(FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise"))
```

**从子卡片汇总成本：**
```
SUM(PLUCK(children, "attributes.costTotalAnnual"))
```

**TIME 模型定位（Tolerate / Invest / Migrate / Eliminate）**，与您在新建计算时于**管理员 → 元模型 → 计算**中的**公式参考**面板看到的示例相同。目标类型 = `Application`，目标字段 = `timeModel`。假定您已添加两个名为 `businessFit` 和 `technicalFit` 的 `single_select` 字段，选项为 `excellent`、`adequate`、`insufficient`、`unreasonable`：
```
# ── TIME Model (Tolerate / Invest / Migrate / Eliminate) ──
# Assumes single_select fields: businessFit and technicalFit
# with options: excellent, adequate, insufficient, unreasonable.
#
# Scoring: Map each dimension to 1-4 numeric scale.
# Business Fit  = Y-axis (how well does it serve the business?)
# Technical Fit = X-axis (how healthy is the technology?)
#
# Quadrant logic (threshold at score 2.5):
#   Invest    = high business + high technical
#   Migrate   = high business + low technical
#   Tolerate  = low business  + high technical
#   Eliminate = low business  + low technical
#
bf = MAP_SCORE(data.businessFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
IF(bf is None or tf is None, None, IF(bf >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))
```

如示例所示，公式可以跨多行书写。形如 `名称 = 表达式` 的一行会保存一个中间值供后续行复用，
而最后一行的值就是写入目标字段的结果。

这也是 [EA 新手指南](../beginners-guide/customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation)所引用的工作示例。

支持使用 `#` 添加**注释**：
```
# Calculate weighted risk score
IF(data.businessCriticality == "missionCritical", data.riskScore * 2, data.riskScore)
```

## 验证与测试

公式编辑器提供两种不同的检查，两者行为并不相同：

* **验证**在一张合成卡片上运行公式。每个数值字段都会被赋予虚拟值 `1`，而且这张卡片
  **没有关系、没有子卡片、也没有自己的父卡片数据**。它可以确认语法能够解析、所用名称确实存
  在，但聚合 `relations` 或 `children` 的公式在这里始终显示 `0` 或空结果。这是预期行为，并
  不代表公式有问题。
* **测试**在已保存的计算上可用，它针对您选定的真实卡片运行。凡是涉及关系、子卡片或父卡片的
  情况都应使用它。测试不会写入卡片，结果只展示给您。

## 解读手动运行的结果

从列表运行计算会对目标类型的每一张卡片求值，并报告实际发生了什么，而不仅仅是处理了多少张卡片。
结果横幅上的**查看详情**会展开明细：

* **每个计算一个区块**，显示成功计算的卡片数和失败的卡片数。该类型的所有启用计算会一起运行，
  因此这里能看出问题出在哪一个上。
* **每种不同的错误一行**，并标注触发该错误的卡片数。写错的公式在所有卡片上都以同样的方式出错，
  因此二十一次失败通常只需一次修改，而不是二十一次。
* **卡片本身**，列在各条错误下方并带有链接，可直接打开查看导致失败的数据。每种错误最多列出十张
  卡片；超出部分以数量形式显示。

**复制报告**会把整份明细以纯文本形式复制到剪贴板。

计算列表中的状态标记反映同一次运行：只要有卡片失败即为红色，全部计算成功时才是绿色。

## 计算何时运行

在以下情况下，卡片的计算会被重新求值：

* 卡片被创建或保存；
* 涉及该卡片的关系被创建、修改或删除（关系两端都会重新计算）；
* 卡片被重新指定父级，此时其整个子树都会重新计算；
* 您从列表中手动运行该计算，此时它会对目标类型的每张卡片求值并保存结果。

当公式所读取的**另一张**卡片被编辑时，计算**不会**重新求值。如果您修改了某个 IT 组件上的成
本，聚合该成本的应用不会随之变化，直到该应用被保存、它的某个关系发生变化，或您为该类型运行
了这项计算。对于聚合他人维护数据的场景，请定期运行计算，或在批量导入之后运行。

!!! note "注意"
    `parent` 和 `hierarchy_level` 派生的值同理：它们在重新指定父级时以及手动运行时刷新，而
    非在每次编辑父卡片时刷新。请始终用 `IF(parent, …)` 保护 `parent` 引用，以免根卡片
    （此时 `parent` 为 `None`）报错。

## 执行顺序

当多个计算针对同一卡片类型时，它们按**执行顺序**值指定的顺序运行。当一个计算依赖于另一个计算的结果时，这很重要：将依赖项设置为先运行（较小的数字）。

Turbo EA 会拒绝形成循环的计算组合，例如字段 A 由字段 B 计算得出，而 B 又由 A 计算得出。
