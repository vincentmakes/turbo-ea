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

### 公式示例

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
