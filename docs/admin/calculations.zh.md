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

公式使用安全的沙箱表达式语言。您可以引用卡片属性、关联卡片数据和生命周期信息。

### 上下文变量

| 变量 | 描述 | 示例 |
|------|------|------|
| `fieldKey` | 当前卡片的任何属性 | `businessCriticality` |
| `related_{type_key}` | 给定类型的关联卡片数组 | `related_applications` |
| `lifecycle_plan`、`lifecycle_active` 等 | 生命周期日期值 | `lifecycle_endOfLife` |
| `parent` | 父卡片（包含 `id`、`name`、`type`、`subtype`、`attributes` 的对象），根卡片则为 `None` | `IF(parent, parent.attributes.businessCriticality, data.businessCriticality)` |
| `hierarchy_level` | 当前卡片在其父子层级中的深度（`1` = 根，无上限）。非层级卡片类型为 `1` | `hierarchy_level * 10` |

!!! note "注意"
    `parent` 和 `hierarchy_level` 派生的值会在卡片被重新指定父级时刷新（其整个子树会被重新计算），以及在您对该类型运行**全部重新计算**时刷新——而非在每次编辑父卡片时刷新。请始终用 `IF(parent, …)` 保护 `parent` 引用，以免根卡片（此时 `parent` 为 `None`）报错。

### 内置函数

| 函数 | 描述 | 示例 |
|------|------|------|
| `IF(condition, true_val, false_val)` | 条件逻辑 | `IF(riskLevel == "critical", 100, 25)` |
| `SUM(array)` | 数值求和 | `SUM(PLUCK(related_applications, "costTotalAnnual"))` |
| `AVG(array)` | 数值平均 | `AVG(PLUCK(related_applications, "dataQuality"))` |
| `MIN(array)` | 最小值 | `MIN(PLUCK(related_itcomponents, "riskScore"))` |
| `MAX(array)` | 最大值 | `MAX(PLUCK(related_itcomponents, "costAnnual"))` |
| `COUNT(array)` | 项目数量 | `COUNT(related_interfaces)` |
| `ROUND(value, decimals)` | 四舍五入 | `ROUND(avgCost, 2)` |
| `ABS(value)` | 绝对值 | `ABS(delta)` |
| `COALESCE(a, b, ...)` | 第一个非空值 | `COALESCE(customScore, 0)` |
| `LOWER(text)` | 文本转小写 | `LOWER(status)` |
| `UPPER(text)` | 文本转大写 | `UPPER(category)` |
| `CONCAT(a, b, ...)` | 连接字符串 | `CONCAT(firstName, " ", lastName)` |
| `CONTAINS(text, search)` | 检查文本是否包含子串 | `CONTAINS(description, "legacy")` |
| `PLUCK(array, key)` | 从每项中提取字段 | `PLUCK(related_applications, "name")` |
| `FILTER(array, key, value)` | 按字段值筛选项目 | `FILTER(related_interfaces, "status", "ACTIVE")` |
| `MAP_SCORE(value, mapping)` | 将分类值映射为分数 | `MAP_SCORE(criticality, {"high": 3, "medium": 2, "low": 1})` |

### 公式示例 { #example-formulas }

**关联应用程序的年度总成本：**
```
SUM(PLUCK(related_applications, "costTotalAnnual"))
```

**基于关键性的风险评分：**
```
IF(riskLevel == "critical", 100, IF(riskLevel == "high", 75, IF(riskLevel == "medium", 50, 25)))
```

**活跃接口数量：**
```
COUNT(FILTER(related_interfaces, "status", "ACTIVE"))
```

**TIME 模型定位（Tolerate / Invest / Migrate / Eliminate）**——与您在新建计算时于**管理员 → 元模型 → 计算**中的**公式参考**面板看到的示例相同。目标类型 = `Application`，目标字段 = `timeModel`。假定您已添加两个名为 `businessFit` 和 `technicalFit` 的 `single_select` 字段，选项为 `excellent`、`adequate`、`insufficient`、`unreasonable`：
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

这也是 [EA 新手指南](../beginners-guide/customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation)所引用的工作示例。

支持使用 `#` 添加**注释**：
```
# Calculate weighted risk score
IF(businessCriticality == "missionCritical", riskScore * 2, riskScore)
```

## 运行计算

计算在卡片保存时自动运行。您也可以手动触发计算在目标类型的所有卡片上运行：

1. 在列表中找到计算
2. 点击**运行**按钮
3. 公式对每张匹配的卡片求值并保存结果

## 执行顺序

当多个计算针对同一卡片类型时，它们按**执行顺序**值指定的顺序运行。当一个计算依赖于另一个计算的结果时，这很重要 —— 将依赖项设置为先运行（较小的数字）。
