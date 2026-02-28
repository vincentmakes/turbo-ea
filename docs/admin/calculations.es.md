# Cálculos

La función de **Cálculos** (**Administrador > Metamodelo > pestaña Cálculos**) le permite definir **fórmulas que calculan automáticamente valores de campos** cuando se guardan las fichas. Esto es muy útil para derivar métricas, puntuaciones y agregaciones a partir de sus datos de arquitectura.

## Cómo Funciona

1. Un administrador define una fórmula dirigida a un tipo de ficha y campo específicos
2. Cuando se crea o actualiza cualquier ficha de ese tipo, la fórmula se ejecuta automáticamente
3. El resultado se escribe en el campo objetivo
4. El campo objetivo se marca como **solo lectura** en la página de detalle de la ficha (los usuarios ven una insignia «calculado»)

## Creación de un Cálculo

Haga clic en **+ Nuevo Cálculo** y configure:

| Campo | Descripción |
|-------|-------------|
| **Nombre** | Nombre descriptivo para el cálculo |
| **Tipo Objetivo** | El tipo de ficha al que se aplica este cálculo |
| **Campo Objetivo** | El campo donde se almacena el resultado |
| **Fórmula** | La expresión a evaluar (consulte la sintaxis a continuación) |
| **Orden de Ejecución** | Orden de ejecución cuando existen múltiples cálculos para el mismo tipo (el menor se ejecuta primero) |
| **Activo** | Habilitar o deshabilitar el cálculo |

## Sintaxis de Fórmulas

Las fórmulas utilizan un lenguaje de expresiones seguro y aislado. Puede hacer referencia a atributos de fichas, datos de fichas relacionadas e información del ciclo de vida.

### Variables de Contexto

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `fieldKey` | Cualquier atributo de la ficha actual | `businessCriticality` |
| `related_{type_key}` | Matriz de fichas relacionadas de un tipo dado | `related_applications` |
| `lifecycle_plan`, `lifecycle_active`, etc. | Valores de fechas del ciclo de vida | `lifecycle_endOfLife` |

### Funciones Incorporadas

| Función | Descripción | Ejemplo |
|---------|-------------|---------|
| `IF(condición, valor_verdadero, valor_falso)` | Lógica condicional | `IF(riskLevel == "critical", 100, 25)` |
| `SUM(matriz)` | Suma de valores numéricos | `SUM(PLUCK(related_applications, "costTotalAnnual"))` |
| `AVG(matriz)` | Promedio de valores numéricos | `AVG(PLUCK(related_applications, "dataQuality"))` |
| `MIN(matriz)` | Valor mínimo | `MIN(PLUCK(related_itcomponents, "riskScore"))` |
| `MAX(matriz)` | Valor máximo | `MAX(PLUCK(related_itcomponents, "costAnnual"))` |
| `COUNT(matriz)` | Número de elementos | `COUNT(related_interfaces)` |
| `ROUND(valor, decimales)` | Redondear un número | `ROUND(avgCost, 2)` |
| `ABS(valor)` | Valor absoluto | `ABS(delta)` |
| `COALESCE(a, b, ...)` | Primer valor no nulo | `COALESCE(customScore, 0)` |
| `LOWER(texto)` | Texto en minúsculas | `LOWER(status)` |
| `UPPER(texto)` | Texto en mayúsculas | `UPPER(category)` |
| `CONCAT(a, b, ...)` | Unir cadenas de texto | `CONCAT(firstName, " ", lastName)` |
| `CONTAINS(texto, búsqueda)` | Verificar si el texto contiene una subcadena | `CONTAINS(description, "legacy")` |
| `PLUCK(matriz, clave)` | Extraer un campo de cada elemento | `PLUCK(related_applications, "name")` |
| `FILTER(matriz, clave, valor)` | Filtrar elementos por valor de campo | `FILTER(related_interfaces, "status", "ACTIVE")` |
| `MAP_SCORE(valor, mapeo)` | Mapear valores categóricos a puntuaciones | `MAP_SCORE(criticality, {"high": 3, "medium": 2, "low": 1})` |

### Ejemplos de Fórmulas

**Costo anual total de las aplicaciones relacionadas:**
```
SUM(PLUCK(related_applications, "costTotalAnnual"))
```

**Puntuación de riesgo basada en la criticidad:**
```
IF(riskLevel == "critical", 100, IF(riskLevel == "high", 75, IF(riskLevel == "medium", 50, 25)))
```

**Cantidad de interfaces activas:**
```
COUNT(FILTER(related_interfaces, "status", "ACTIVE"))
```

**Los comentarios** se admiten usando `#`:
```
# Calcular puntuación de riesgo ponderada
IF(businessCriticality == "missionCritical", riskScore * 2, riskScore)
```

## Ejecución de Cálculos

Los cálculos se ejecutan automáticamente cuando se guarda una ficha. También puede activar manualmente un cálculo para que se ejecute en todas las fichas del tipo objetivo:

1. Encuentre el cálculo en la lista
2. Haga clic en el botón **Ejecutar**
3. La fórmula se evalúa para cada ficha coincidente y los resultados se guardan

## Orden de Ejecución

Cuando múltiples cálculos tienen como objetivo el mismo tipo de ficha, se ejecutan en el orden especificado por su valor de **orden de ejecución**. Esto es importante cuando un cálculo depende del resultado de otro: establezca la dependencia para que se ejecute primero (número menor).
