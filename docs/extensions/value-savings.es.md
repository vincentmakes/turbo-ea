# EA Value Tracker

Toda función de EA acaba recibiendo la misma pregunta del director financiero o
del CIO: *¿cuánto vale realmente la arquitectura para nosotros?* Las hojas de ruta
y los diagramas no la responden; los números, sí.

**EA Value Tracker** convierte las [decisiones de arquitectura](../guide/delivery.md)
de Turbo EA en un registro financiero auditable del valor que crea su práctica de
EA. El valor se declara donde se origina — en la decisión —, se congela al
firmarla y más tarde se concilia con lo realmente realizado, bajo una aprobación
con cuatro ojos. Un panel lo consolida todo, de modo que la respuesta en la
revisión presupuestaria es un informe y no una búsqueda entre hojas de cálculo.

## De un vistazo

| | |
|---|---|
| **Licencia** | Comercial — se requiere un derecho firmado |
| **Versión mínima de Turbo EA** | 2.14.0 |
| **Permisos** | `ext.value-savings.record`, `ext.value-savings.approve` |
| **Permisos de acceso a datos** | ninguno |
| **Requiere reiniciar el backend** | sí — incluye código de backend |
| **Dónde aparece** | Panel **Valor y ahorros** en las decisiones · registro **Realización de valor** bajo el bloque de firma · cuatro columnas en las tablas de decisiones · **Informes → EA Value Tracker** |

## El ciclo de vida

El valor recorre cuatro etapas, mostradas como una secuencia en cada decisión:

**Declarado (borrador)** › **Declarado (aprobado)** › **Realizado (pendiente)** ›
**Realizado (aprobado)**

1. Mientras se redacta una decisión, los arquitectos adjuntan **ahorros
   declarados**.
2. **Al firmar se congelan.** Las cifras que aprobaron los firmantes pasan a ser
   declaraciones aprobadas y ya no pueden editarse.
3. Tras la ejecución, alguien **registra lo que realmente se realizó** frente a
   cada declaración.
4. Una **segunda persona aprueba** la realización: quien registra nunca puede
   aprobar sus propias cifras.

## Declarar valor en una decisión

Abra un borrador de decisión (**EA Delivery → Decisiones**) y desplácese hasta
**Valor y ahorros**, justo después de las consecuencias.

![El panel «Valor y ahorros» en un borrador de decisión](../assets/img/en/66_ext_value_tracker_claims.png)

Pulse **Añadir ahorro** y complete el diálogo:

| Campo | Notas |
|---|---|
| **Categoría** | **Ahorros directos**, **Ahorros indirectos**, **Costes evitados**, **Habilitación de ingresos** o **Riesgos evitados** |
| **Importe** | En la moneda de su espacio de trabajo. Debe ser mayor que cero |
| **Ejercicio fiscal** | Derivado del inicio de ejercicio definido en la [Configuración general](../admin/settings.md) |
| **Tipo** | **Puntual** o **Recurrente** |
| **Responsable** | Una o varias personas que responden por la cifra |
| **Descripción** | Texto libre opcional |

Añada tantas declaraciones como justifique la decisión. Junto al título del panel
se muestra un total acumulado y, debajo, una etiqueta por categoría.

!!! note "«Recurrente» es informativo"
    Una entrada **recurrente** permanece en el ejercicio fiscal que le haya
    asignado: nunca se extrapola automáticamente a ejercicios posteriores. La
    distinción existe para que quien lea distinga un ahorro anual recurrente de
    uno puntual, y para que el panel presente por separado el importe recurrente
    anual.

Editar las declaraciones requiere el permiso habitual `adr.manage`.

## Qué ocurre al firmar

Cuando los firmantes firman la decisión, Turbo EA congela la decisión completa,
incluidas sus declaraciones. El editor desaparece del cuerpo del documento y:

- las declaraciones pasan a **Declarado (aprobado)** y quedan en solo lectura;
- aparece un registro **Realización de valor** **bajo el bloque de firma**;
- en la cabecera de la decisión aparecen un botón **Realización de valor** y las
  etiquetas **Declarado** y **Realizado**, junto a Duplicar y Nueva revisión.

Para cambiar una cifra aprobada, cree una **nueva revisión** de la decisión. Es
deliberado: las cifras que aprobaron los firmantes permanecen exactamente como
las aprobaron.

## Registrar y aprobar el valor realizado

![El registro «Realización de valor» bajo el bloque de firma](../assets/img/en/67_ext_value_tracker_realization.png)

**Registrar.** Quien tenga `ext.value-savings.record` verá un botón **Registrar**
en cada declaración aprobada que aún no tenga realización. El diálogo pide el
**importe** real, el **ejercicio fiscal**, una persona **aprobadora** y una
descripción opcional.

La persona aprobadora **debe ser distinta de quien registra**: una regla de cuatro
ojos que aplica el servidor, no solo el formulario. Al guardar, la fila se crea
como **Pendiente** y se genera una tarea para la persona aprobadora («Aprobar
valor realizado: …») enlazada a la decisión, junto con la notificación de
asignación habitual.

**Aprobar.** La persona designada — que además debe tener
`ext.value-savings.approve` — abre la decisión y pulsa **Aprobar** o **Rechazar**
en la fila pendiente. La tarea se completa y la cifra pasa a **Realizado
(aprobado)**. Las filas rechazadas se conservan para la pista de auditoría.

**Correcciones.**

- Solo quien decidió puede revertir su decisión más adelante o pulsar **Retirar
  decisión** para devolver la fila a pendiente (lo que reabre la tarea).
- Solo quien registró puede eliminar su propia fila, y únicamente mientras siga
  pendiente. Las personas aprobadoras rechazan en lugar de eliminar.
- Para corregir una cifra ya aprobada, registre una **nueva entrada de ajuste** en
  lugar de modificar el histórico.

## El panel

**Informes → EA Value Tracker** lo consolida todo.

![El panel de EA Value Tracker](../assets/img/en/68_ext_value_tracker_dashboard.png)

**Barra de herramientas**

- **Declarado** / **Realizado** — la base de todo el informe: valor *declarado* en
  las decisiones o valor realmente *realizado*.
- **Ejercicio fiscal** — el ejercicio en curso viene preseleccionado; deseleccione
  todo para ver todos los años.
- Filtros de **Categoría** y **Persona**.
- **Incluir borradores** o **Incluir pendientes**.

**Indicadores** — Realizado (aprobado), Declaraciones aprobadas, Recurrente
(anual), Borrador y el número de decisiones que contribuyen.

El **embudo de ahorros** muestra las cuatro etapas una junto a otra, de modo que
la brecha entre lo prometido y lo conseguido salta a la vista.

![Ahorros por categoría](../assets/img/en/69_ext_value_tracker_categories.png)

**Ahorros por categoría** es un anillo con el total en el centro. **Ahorros por
persona (reparto equitativo)** atribuye a una entrada asignada a *N* personas
*importe ÷ N* a cada una, para que ningún valor se cuente dos veces.

![Ahorros por ejercicio fiscal](../assets/img/en/70_ext_value_tracker_fiscal_years.png)

**Ahorros por ejercicio fiscal** abarca una ventana fija de cuatro años atrás a
dos años adelante e ignora deliberadamente el filtro de ejercicio, para que la
tendencia siempre resulte legible.

Dos tablas completan el cuadro: el **desglose por persona** y las **decisiones que
contribuyen**, el registro completo con un enlace **Abrir** a cada decisión.

El informe se guarda, comparte, imprime y exporta a XLSX y PPTX como cualquier
informe del núcleo, de modo que puede pasar directamente a un dosier de comité de
dirección.

## En las tablas de decisiones

Se añaden cuatro columnas a la tabla de decisiones compartida, tanto en
**EA Delivery → Decisiones** como en **GRC → Gobernanza → Decisiones**:

| Columna | Muestra |
|---|---|
| **Ahorros declarados** | Total declarado en esa decisión |
| **Realizado** | Total de realizaciones aprobadas |
| **Aprobador de ahorros** | Quién aprobó las realizaciones |
| **Etapa de ahorros** | La etapa más avanzada alcanzada |

Se comportan como columnas nativas — la ordenación, el filtro rápido y el tema
funcionan — y pueden ocultarse o fijarse desde el selector de columnas.

## Permisos

| Permiso | Permite |
|---|---|
| `adr.view` (núcleo) | Ver los paneles, las columnas y el panel de valor |
| `adr.manage` (núcleo) | Añadir, editar y eliminar declaraciones en una decisión sin firmar |
| `ext.value-savings.record` | Registrar una realización frente a una declaración aprobada |
| `ext.value-savings.approve` | Aprobar o rechazar una realización — **y** ser la persona designada como aprobadora |

Asigne los dos permisos de la extensión en **Admin → Usuarios y roles**. Tenga en
cuenta que `ext.value-savings.approve` no basta por sí solo: el servidor comprueba
además que usted sea la persona aprobadora designada en esa fila concreta.

## Si la licencia caduca o la extensión se desactiva

Los paneles, las columnas y el panel de valor desaparecen, pero **no se elimina
nada**. Las declaraciones residen en la propia decisión y viajan con una
transferencia de espacio de trabajo; las realizaciones permanecen en las tablas
propias de la extensión. Una licencia renovada lo devuelve todo.

## Notas y limitaciones

- Los ahorros **no** se incluyen deliberadamente en la exportación a Word de la
  decisión: esa exportación es el documento de decisión, no el registro
  financiero.
- Las realizaciones se registran frente a una declaración aprobada, de modo que
  una decisión debe estar firmada antes de poder realizar valor contra ella.
- La extensión incluye código de backend, por lo que instalarla o actualizarla
  requiere un reinicio puntual del backend. Turbo EA muestra entonces un aviso.
