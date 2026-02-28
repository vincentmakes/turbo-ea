# Calculations

The **Calculations** feature (**Admin > Metamodel > Calculations** tab) lets you define **formulas that automatically compute field values** when cards are saved. This is powerful for deriving metrics, scores, and aggregations from your architecture data.

## How It Works

1. An admin defines a formula targeting a specific card type and field
2. When any card of that type is created or updated, the formula runs automatically
3. The result is written to the target field
4. The target field is marked as **read-only** on the card detail page (users see a "calculated" badge)

## Creating a Calculation

Click **+ New Calculation** and configure:

| Field | Description |
|-------|-------------|
| **Name** | Descriptive name for the calculation |
| **Target Type** | The card type this calculation applies to |
| **Target Field** | The field where the result is stored |
| **Formula** | The expression to evaluate (see syntax below) |
| **Execution Order** | Order of execution when multiple calculations exist for the same type (lower runs first) |
| **Active** | Enable or disable the calculation |

## Formula Syntax

Formulas use a safe, sandboxed expression language. You can reference card attributes, related card data, and lifecycle information.

### Context Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `fieldKey` | Any attribute from the current card | `businessCriticality` |
| `related_{type_key}` | Array of related cards of a given type | `related_applications` |
| `lifecycle_plan`, `lifecycle_active`, etc. | Lifecycle date values | `lifecycle_endOfLife` |

### Built-in Functions

| Function | Description | Example |
|----------|-------------|---------|
| `IF(condition, true_val, false_val)` | Conditional logic | `IF(riskLevel == "critical", 100, 25)` |
| `SUM(array)` | Sum of numeric values | `SUM(PLUCK(related_applications, "costTotalAnnual"))` |
| `AVG(array)` | Average of numeric values | `AVG(PLUCK(related_applications, "dataQuality"))` |
| `MIN(array)` | Minimum value | `MIN(PLUCK(related_itcomponents, "riskScore"))` |
| `MAX(array)` | Maximum value | `MAX(PLUCK(related_itcomponents, "costAnnual"))` |
| `COUNT(array)` | Number of items | `COUNT(related_interfaces)` |
| `ROUND(value, decimals)` | Round a number | `ROUND(avgCost, 2)` |
| `ABS(value)` | Absolute value | `ABS(delta)` |
| `COALESCE(a, b, ...)` | First non-null value | `COALESCE(customScore, 0)` |
| `LOWER(text)` | Lowercase text | `LOWER(status)` |
| `UPPER(text)` | Uppercase text | `UPPER(category)` |
| `CONCAT(a, b, ...)` | Join strings | `CONCAT(firstName, " ", lastName)` |
| `CONTAINS(text, search)` | Check if text contains substring | `CONTAINS(description, "legacy")` |
| `PLUCK(array, key)` | Extract a field from each item | `PLUCK(related_applications, "name")` |
| `FILTER(array, key, value)` | Filter items by field value | `FILTER(related_interfaces, "status", "ACTIVE")` |
| `MAP_SCORE(value, mapping)` | Map categorical values to scores | `MAP_SCORE(criticality, {"high": 3, "medium": 2, "low": 1})` |

### Example Formulas

**Total annual cost from related applications:**
```
SUM(PLUCK(related_applications, "costTotalAnnual"))
```

**Risk score based on criticality:**
```
IF(riskLevel == "critical", 100, IF(riskLevel == "high", 75, IF(riskLevel == "medium", 50, 25)))
```

**Count of active interfaces:**
```
COUNT(FILTER(related_interfaces, "status", "ACTIVE"))
```

**Comments** are supported using `#`:
```
# Calculate weighted risk score
IF(businessCriticality == "missionCritical", riskScore * 2, riskScore)
```

## Running Calculations

Calculations run automatically when a card is saved. You can also manually trigger a calculation to run across all cards of the target type:

1. Find the calculation in the list
2. Click the **Run** button
3. The formula is evaluated for every matching card and results are saved

## Execution Order

When multiple calculations target the same card type, they run in the order specified by their **execution order** value. This is important when one calculation depends on the result of another — set the dependency to run first (lower number).
