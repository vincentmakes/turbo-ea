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

Las fórmulas utilizan un lenguaje de expresiones seguro y aislado. Puede hacer referencia a los campos de la ficha actual, a las fichas relacionadas e hijas, a la ficha principal y a las fechas del ciclo de vida.

!!! warning "Use la clave del campo, no su etiqueta"
    Los campos se referencian por su **clave**, normalmente en camelCase (`costTotalAnnual`),
    no por la etiqueta que se muestra en la ficha (`Costo anual total`). Un nombre que no
    existe se resuelve como `None`, y cualquier operación aritmética sobre `None` falla con un
    **error de evaluación** genérico.

    Puede consultar la clave en **Administrador > Metamodelo >** *(tipo de ficha)*, abriendo
    el campo y leyendo su **Clave**. Más sencillo: en el editor de fórmulas, las etiquetas
    situadas bajo el cuadro de fórmula listan `data.<clave>` para cada campo del tipo
    seleccionado, y al escribir `data.` se abre el autocompletado.

### Variables de Contexto

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `data.<claveDelCampo>` | Cualquier campo personalizado de la ficha actual, por su clave | `data.costTotalAnnual` |
| `data.name`, `data.description`, `data.status`, `data.subtype`, `data.approval_status`, `data.reference` | Propiedades integradas de la ficha | `data.subtype` |
| `data.lifecycle.<fase>` | Fechas del ciclo de vida, donde la fase es `plan`, `phaseIn`, `active`, `phaseOut` o `endOfLife` | `data.lifecycle.endOfLife` |
| `relations.<claveDelTipoDeRelación>` | Matriz de fichas vinculadas por ese tipo de relación, en cualquier dirección | `relations.relAppToITC` |
| `relation_count.<claveDelTipoDeRelación>` | Número de fichas vinculadas por ese tipo de relación | `relation_count.relAppToITC` |
| `children` | Matriz de fichas hijas directas (tipos jerárquicos) | `SUM(PLUCK(children, "attributes.costTotalAnnual"))` |
| `children_count` | Número de hijos directos | `children_count` |
| `parent` | La ficha principal (objeto con `id`, `name`, `type`, `subtype`, `attributes`), o `None` para una ficha raíz | `IF(parent, parent.attributes.businessCriticality, data.businessCriticality)` |
| `hierarchy_level` | Profundidad de la ficha actual en su jerarquía padre-hijo (`1` = raíz, sin límite). `1` para tipos de ficha no jerárquicos | `hierarchy_level * 10` |

La clave del tipo de relación es la que aparece en **Administrador > Metamodelo >
Relaciones**, por ejemplo `relAppToITC` o `relInitiativeToApp`. La dirección no importa: una
ficha encuentra un tipo de relación bajo la misma clave tanto si está en el extremo origen
como en el destino. Las fichas archivadas se excluyen de `relations`, `relation_count` y
`children`.

### Leer campos de una ficha relacionada

Cada elemento de `relations.<claveDelTipoDeRelación>` y de `children` es un objeto
envoltorio, no los campos de la ficha relacionada directamente:

```json
{
  "id": "8f1c…",
  "name": "NexaCore ERP",
  "type": "Application",
  "attributes":     { "costTotalAnnual": 45000, "businessCriticality": "missionCritical" },
  "rel_attributes": { "costTotalAnnual": 12000 }
}
```

* `attributes` contiene los valores de los campos propios de la ficha relacionada.
* `rel_attributes` contiene los valores almacenados **en el propio vínculo**, si el tipo de
  relación define un esquema de atributos. Por ejemplo, `relAppToITC` lleva su propio
  `costTotalAnnual`, de modo que puede registrar lo que una aplicación gasta en un componente
  de TI concreto.

Esto es importante para `PLUCK` y `FILTER`, que reciben una ruta de clave y por tanto
necesitan el prefijo `attributes.` para alcanzar un campo:

```
# Sumar el costo anual de los componentes de TI que usa esta aplicación
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))

# Sumar en su lugar el costo registrado en cada vínculo aplicación-componente
SUM(PLUCK(relations.relAppToITC, "rel_attributes.costTotalAnnual"))
```

Extraer una clave simple como `"costTotalAnnual"` la busca en el objeto envoltorio, no
encuentra nada y devuelve una lista de `None`, que `SUM` presenta como `0`. Una fórmula sobre
relaciones que insiste en devolver `0` es casi siempre un prefijo `attributes.` que falta.

### Gestión de valores vacíos

Un campo sin valor se resuelve como `None`, y `None` en una expresión aritmética provoca un
error. Envuelva con `COALESCE` todo campo que pueda estar vacío:

```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

`SUM`, `AVG`, `MIN` y `MAX` ya omiten las entradas no numéricas, así que no necesitan
protección.

### Datos de PPM en fichas de Iniciativa

La raíz `ppm` expone a las fórmulas las líneas de presupuesto y de costo del módulo PPM, separadas entre capex y opex y desglosadas por ejercicio fiscal: un detalle que los atributos consolidados `data.costBudget` / `data.costActual` de la ficha no pueden dar.

| Variable | Descripción |
|----------|-------------|
| `ppm.capexBudget`, `ppm.opexBudget`, `ppm.totalBudget` | Presupuesto previsto, de las líneas de presupuesto de PPM |
| `ppm.capexPlanned`, `ppm.opexPlanned`, `ppm.totalPlanned` | Importes previstos en las líneas de costo de PPM |
| `ppm.capexActual`, `ppm.opexActual`, `ppm.totalActual` | Reales en las líneas de costo de PPM |
| `ppm.byYear` | Las mismas nueve medidas por ejercicio fiscal, como lista `{year, capexBudget, …}` |
| `ppm.currentFiscalYear` | El ejercicio fiscal en el que cae la fecha de hoy |
| `ppm.unscheduledPlanned`, `ppm.unscheduledActual` | Líneas de costo sin fecha: cuentan en los totales, pero no pertenecen a ningún ejercicio |

`byYear` es una lista y no un objeto indexado por año, de modo que las funciones habituales `FILTER` y `PLUCK` funcionan sobre ella:

```
# Presupuesto capex total de todos los ejercicios
ppm.capexBudget

# Solo el presupuesto capex del ejercicio actual
SUM(PLUCK(FILTER(ppm.byYear, "year", ppm.currentFiscalYear), "capexBudget"))

# Presupuesto capex de cada Iniciativa vinculada a esta ficha
SUM(PLUCK(relations.relInitiativeToApp, "ppm.capexBudget"))
```

* **Un ejercicio fiscal lleva el nombre del año natural en el que termina.** Con inicio en octubre, el 15 oct 2025 cae en el EF2026 y el 30 sep 2025 en el EF2025. Con el inicio en enero por defecto, el ejercicio es simplemente el año natural.
* **Las líneas de presupuesto y de costo obtienen su ejercicio de fuentes distintas.** Una línea de presupuesto lleva el ejercicio que usted escribió; el de una línea de costo se deduce de su fecha. Si su organización nombra los ejercicios por el año de *inicio*, ambos discreparán.
* `total*` es la suma de todas las líneas, no `capex + opex`. Una línea cuya categoría no sea ninguna de las dos (de una importación, por ejemplo) sigue contando en el total.
* Una ficha que no es una Iniciativa lee todas las medidas `ppm` como `0` con `byYear` vacío, así que una fórmula en el tipo equivocado devuelve cero en lugar de fallar.

Editar una línea de presupuesto o de costo de PPM vuelve a ejecutar los cálculos de la iniciativa, así que todo lo derivado se actualiza de inmediato. Las fichas que leen los datos de PPM de *otra* ficha a través de una relación no se refrescan.

### Funciones Incorporadas

| Función | Descripción | Ejemplo |
|---------|-------------|---------|
| `IF(condición, valor_verdadero, valor_falso)` | Lógica condicional. Solo se evalúa la rama elegida | `IF(data.businessCriticality == "missionCritical", 100, 25)` |
| `SUM(matriz)` | Suma de valores numéricos | `SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `AVG(matriz)` | Promedio de valores numéricos | `AVG(PLUCK(children, "attributes.numberOfUsers"))` |
| `MIN(matriz)` | Valor mínimo | `MIN(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `MAX(matriz)` | Valor máximo | `MAX(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `COUNT(matriz)` | Número de elementos | `COUNT(relations.relAppToInterface)` |
| `ROUND(valor, decimales)` | Redondear un número | `ROUND(data.costTotalAnnual / 12, 2)` |
| `ABS(valor)` | Valor absoluto | `ABS(data.budgetVariance)` |
| `LN(valor)` | Logaritmo natural. Devuelve `None` para cero, valores negativos y entradas no numéricas | `LN(data.numberOfUsers)` |
| `COALESCE(a, b, ...)` | Primer valor no nulo | `COALESCE(data.customScore, 0)` |
| `LOWER(texto)` | Texto en minúsculas | `LOWER(data.productName)` |
| `UPPER(texto)` | Texto en mayúsculas | `UPPER(data.subtype)` |
| `CONCAT(a, b, ...)` | Unir cadenas de texto | `CONCAT(data.name, " (", data.subtype, ")")` |
| `CONTAINS(texto, búsqueda)` | Verificar si el texto contiene una subcadena | `CONTAINS(data.description, "legacy")` |
| `PLUCK(matriz, ruta)` | Extraer una ruta de clave de cada elemento | `PLUCK(relations.relAppToITC, "attributes.costTotalAnnual")` |
| `FILTER(matriz, ruta, valor)` | Conservar los elementos cuya ruta de clave sea igual a un valor | `FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise")` |
| `MAP_SCORE(valor, mapeo)` | Mapear valores categóricos a puntuaciones | `MAP_SCORE(data.businessCriticality, {"missionCritical": 3, "businessCritical": 2})` |

También están disponibles las funciones integradas seguras de Python `len`, `str`, `int`,
`float`, `bool`, `abs`, `round`, `min`, `max` y `sum`, junto con los operadores y
comparaciones habituales.

### Ejemplos de Fórmulas { #example-formulas }

**Suma de varios campos de costo de la misma ficha:**
```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

**Costo anual total de los componentes de TI que usa una aplicación:**
```
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))
```

**Puntuación de riesgo basada en la criticidad:**
```
IF(data.businessCriticality == "missionCritical", 100, IF(data.businessCriticality == "businessCritical", 75, 25))
```

**Cantidad de interfaces relacionadas:**
```
relation_count.relAppToInterface
```

**Cantidad de aplicaciones on-premise en una organización:**
```
COUNT(FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise"))
```

**Consolidar un costo desde las fichas hijas:**
```
SUM(PLUCK(children, "attributes.costTotalAnnual"))
```

**Ubicación en el Modelo TIME (Tolerate / Invest / Migrate / Eliminate)**, el mismo ejemplo que verá en el panel **Formula Reference** dentro de **Admin → Metamodelo → Cálculos** al crear un nuevo cálculo. Tipo objetivo = `Application`, campo objetivo = `timeModel`. Asume que ha agregado dos campos `single_select` denominados `businessFit` y `technicalFit` con las opciones `excellent`, `adequate`, `insufficient`, `unreasonable`:
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

Como muestra el ejemplo, una fórmula puede ocupar varias líneas. Una línea con la forma
`nombre = expresión` almacena un valor intermedio que las líneas posteriores pueden reutilizar,
y el valor de la última línea es el que se escribe en el campo objetivo.

Este es también el ejemplo de trabajo referenciado por la [Guía para principiantes de EA](../beginners-guide/customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation).

**Los comentarios** se admiten usando `#`:
```
# Calcular puntuación de riesgo ponderada
IF(data.businessCriticality == "missionCritical", data.riskScore * 2, data.riskScore)
```

## Validar y probar

El editor de fórmulas ofrece dos comprobaciones distintas, y se comportan de forma diferente:

* **Validar** ejecuta la fórmula contra una ficha sintética. Cada campo numérico recibe el
  valor ficticio `1`, y la ficha **no tiene relaciones, ni hijos, ni datos propios de ficha
  principal**. Confirma que la sintaxis se analiza correctamente y que los nombres utilizados
  existen, pero una fórmula que agrega sobre `relations` o `children` siempre mostrará `0` o
  un resultado vacío aquí. Es lo esperado y no indica que la fórmula esté rota.
* **Probar**, disponible en un cálculo guardado, se ejecuta contra una ficha real que usted
  elige. Es la opción adecuada para todo lo que involucre relaciones, hijos o la ficha
  principal. No se escribe nada en la ficha, el resultado solo se le muestra a usted.

## Leer los resultados de una ejecución manual

Ejecutar un cálculo desde la lista lo evalúa para todas las fichas del tipo de destino e informa
de lo ocurrido, no solo de cuántas fichas se procesaron. **Ver detalles** en el aviso de
resultado abre el desglose:

* **Un bloque por cálculo**, con el número de fichas calculadas sin errores y el número de
  fallidas. Todos los cálculos activos del tipo se ejecutan juntos, así que esto es lo que
  indica cuál es el culpable.
* **Una fila por cada error distinto**, con el número de fichas afectadas. Una fórmula
  incorrecta lo es de la misma manera en todas partes: veintiún fallos suelen ser una sola
  corrección, no veintiuna.
* **Las fichas en sí**, listadas bajo cada error y enlazadas, para abrir una y ver los datos que
  la rompieron. Se listan como máximo diez por error; si hubo más, el resto se muestra como un
  recuento.

**Copiar informe** coloca todo el desglose en el portapapeles como texto plano.

El indicador de estado en la lista de cálculos refleja la misma ejecución: rojo si alguna ficha
falló, verde solo cuando todas se calcularon.

## Cuándo se ejecutan los cálculos

Los cálculos de una ficha se reevalúan cuando:

* la ficha se crea o se guarda;
* se crea, modifica o elimina una relación que toca la ficha (se recalculan ambos extremos de
  la relación);
* la ficha se reasigna a otro padre, lo que recalcula todo su subárbol;
* usted ejecuta el cálculo manualmente desde la lista, lo que lo evalúa para todas las fichas
  del tipo objetivo y guarda los resultados.

**No** se reevalúan cuando se edita otra ficha de la que la fórmula lee datos. Si cambia un
costo en un componente de TI, la aplicación que lo agrega no se moverá hasta que esa
aplicación se guarde, cambie alguna de sus relaciones o ejecute el cálculo para el tipo. Para
agregaciones sobre datos que mantienen otras personas, ejecute el cálculo periódicamente o
después de una importación masiva.

!!! note "Nota"
    Lo mismo se aplica a los valores derivados de `parent` y `hierarchy_level`: se actualizan
    al reasignar el padre y en una ejecución manual, no en cada edición de la ficha principal.
    Proteja siempre una referencia a `parent` con `IF(parent, …)` para que las fichas raíz,
    donde `parent` es `None`, no den error.

## Orden de Ejecución

Cuando múltiples cálculos tienen como objetivo el mismo tipo de ficha, se ejecutan en el orden especificado por su valor de **orden de ejecución**. Esto es importante cuando un cálculo depende del resultado de otro: establezca la dependencia para que se ejecute primero (número menor).

Turbo EA rechaza un conjunto de cálculos que formaría un ciclo, por ejemplo un campo A calculado a partir del campo B mientras B se calcula a partir de A.
