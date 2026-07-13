# GRC

El módulo **GRC** reúne Gobernanza, Riesgo y Cumplimiento en un único espacio de trabajo en `/grc`. Consolida tareas que antes vivían entre Entrega EA y TurboLens, de modo que arquitectas, propietarios de riesgo y revisores de cumplimiento operen sobre una base común.

!!! note
    El módulo GRC puede ser habilitado o deshabilitado por un administrador en [Configuración](../admin/settings.es.md). Cuando está deshabilitado, la navegación y las funcionalidades de GRC se ocultan.

GRC tiene tres pestañas:

Puedes apuntar directamente a cualquier pestaña con `/grc?tab=governance`, `/grc?tab=risk` o `/grc?tab=compliance`.

![GRC — pestaña Gobernanza](../assets/img/es/52_grc_gobernanza.png)

## Gobernanza

La pestaña Gobernanza se divide en dos **sub-pestañas**, con enlace profundo vía `/grc?tab=governance&sub=principles` (por defecto) y `/grc?tab=governance&sub=decisions`:

### Principios

Visor de solo lectura de los Principios EA publicados en el metamodelo (declaración, justificación, implicaciones). El catálogo se edita desde **Administración → Metamodelo → Principios**.

### Decisiones

![GRC — sub-pestaña Decisiones](../assets/img/es/52a_grc_decisiones.png)

La sub-pestaña Decisiones es el **registro maestro de los Architecture Decision Records (ADR)** — cada ADR del paisaje, independientemente de la iniciativa a la que esté vinculado. Reemplaza la antigua pestaña Decisiones de Entrega EA, que se disolvió al aterrizar GRC.

Los ADR documentan decisiones de arquitectura importantes junto con su contexto, consecuencias y alternativas consideradas. Las decisiones emitidas por el asistente TurboLens Architect aterrizan aquí como borradores para revisión.

#### Columnas de la tabla

La cuadrícula de ADR refleja el diseño de la cuadrícula de Inventario:

| Columna | Descripción |
|---------|-------------|
| **N.º de referencia** | Número de referencia generado automáticamente (ADR-001, ADR-002, …) con un punto de estado |
| **Estado** | Chip de color — Borrador, En Revisión o Firmado |
| **Título** | Título del ADR |
| **Decisión** | Extracto en texto plano de la decisión |
| **Tarjetas vinculadas** | Píldoras de color que coinciden con el color del tipo de cada tarjeta vinculada |
| **Creado por** | Autor del ADR |
| **Creado** | Fecha de creación |
| **Modificado** | Fecha de última modificación |
| **Firmado** | Fecha de firma |
| **Firmado por** | Una píldora por cada firmante que ha firmado |

Cada columna dispone de un **filtro de encabezado** — filtros de texto en las columnas de texto, filtros de fecha en las columnas de fecha — cada uno con su propio botón **Restablecer**. En cuanto algún filtro de columna está activo, aparece un botón **Borrar filtros de columna** en la barra de herramientas de la cuadrícula para borrarlos todos a la vez. El ancho, el orden y la ordenación de las columnas, así como los filtros activos, se recuerdan por navegador.

#### Barra lateral de filtros

La barra lateral persistente a la izquierda tiene dos pestañas:

- **Filtros** — filtros de facetas sobre la lista de ADR:
    - **Tipos de tarjeta** — casillas con puntos coloreados que filtran por tipos de tarjetas vinculadas
    - **Tarjetas vinculadas** — filtrar por tarjetas vinculadas específicas
    - **Estado** — Borrador / En Revisión / Firmado
    - **Firmado por** — filtrar por firmante
    - **Fecha de creación** / **modificación** / **firma** — rangos de fechas desde/hasta
- **Columnas** — elegir qué columnas de la cuadrícula son visibles. **N.º de referencia** y **Título** se muestran siempre; **Restablecer** restaura la selección predeterminada. Su elección se recuerda por navegador.

Use la barra de **filtro rápido** para búsqueda de texto completo. Haga clic derecho en cualquier fila para un menú contextual (**Editar**, **Vista previa**, **Duplicar**, **Eliminar**).

#### Crear un ADR

Los ADR se pueden crear desde tres lugares — todos abren el mismo editor y alimentan el mismo registro:

1. **GRC → Gobernanza → Decisiones**: haga clic en **+ Nuevo ADR**, complete el título y opcionalmente vincule tarjetas (incluidas iniciativas).
2. **Espacio de trabajo de Entrega EA**: seleccione una iniciativa, haga clic en **+ Nuevo artefacto ▾** en la cabecera (o **+ Añadir** en la sección *Decisiones de Arquitectura*) y elija **Nueva Decisión de Arquitectura** — la iniciativa queda pre-vinculada.
3. **Tarjeta → pestaña Recursos**: haga clic en **Crear ADR** — la tarjeta actual queda pre-vinculada.

En todos los casos puede buscar y vincular tarjetas adicionales durante la creación. Las iniciativas se vinculan mediante el mismo mecanismo de vinculación que cualquier otra tarjeta, por lo que un ADR puede referenciar múltiples iniciativas. El editor se abre con secciones para **Contexto**, **Decisión**, **Consecuencias** y **Alternativas Consideradas**.

#### El Editor de ADR

El editor proporciona:

- Edición de texto enriquecido para cada sección (Contexto, Decisión, Consecuencias, Alternativas Consideradas)
- Vinculación de tarjetas — conecte el ADR a tarjetas relevantes (aplicaciones, componentes TI, iniciativas, …). Las iniciativas se vinculan a través de la vinculación estándar de tarjetas, no por un campo dedicado, lo que permite que un ADR referencie múltiples iniciativas
- Decisiones relacionadas — referencie otros ADR

#### Flujo de Firma

Los ADR soportan un proceso formal de firma:

1. Cree el ADR en estado **Borrador**.
2. Haga clic en **Solicitar Firmas** y busque firmantes por nombre o correo electrónico.
3. El ADR pasa a **En Revisión** — cada firmante recibe una notificación y una tarea.
4. Los firmantes revisan y hacen clic en **Firmar**.
5. Cuando todos hayan firmado, el ADR pasa automáticamente al estado **Firmado**.

Los ADR firmados están bloqueados y no pueden editarse — para cambios cree una nueva revisión.

#### Revisiones

Abra un ADR firmado y haga clic en **Revisar** para crear un nuevo borrador basado en la versión firmada. La nueva revisión hereda el contenido y los vínculos de tarjetas y recibe un número de revisión incremental. Cada revisión conserva su propio rastro de firmas.

#### Vista previa

Haga clic en el icono de vista previa para ver una versión de solo lectura y formateada del ADR — útil para revisión antes de firmar.

## Riesgo

![GRC — Registro de riesgos](../assets/img/es/53_grc_registro_riesgos.png)

Incrusta el **Registro de riesgos** TOGAF Fase G. El ciclo de vida completo, el flujo de estados, los conmutadores de matriz y el comportamiento de propietarios están documentados en la [guía del Registro de riesgos](risks.md). Lo más relevante:

## Cumplimiento

![GRC — Registro de cumplimiento](../assets/img/es/54_grc_cumplimiento.png)


La pestaña Cumplimiento es un registro de doble fuente — los hallazgos pueden ser **redactados manualmente** por un revisor **o** producidos por un **escaneo IA** bajo demanda contra las regulaciones habilitadas (EU AI Act, RGPD, NIS2, DORA, SOC 2, ISO 27001 vienen habilitadas por defecto). Ambos tipos de hallazgo comparten el mismo ciclo de vida, pueden promoverse a un Riesgo y son bulk-actionables desde la cuadrícula. Consulta la [guía de Cumplimiento](compliance.md) para el ciclo de vida completo, el diálogo de creación manual, el flujo de escaneo, el detector semántico de EU AI Act y el bucle de promoción a Riesgo.

La misma pestaña Cumplimiento también aparece en el Detalle de la ficha (auto-ocultada cuando la ficha no tiene hallazgos vinculados), de modo que un Application Owner pueda triagiar sus hallazgos sin salir de la ficha.

## Permisos

| Permiso | Roles por defecto |
|---------|-------------------|
| `grc.view` | admin, bpm_admin, member, viewer |
| `grc.manage` | admin, bpm_admin, member |
| `risks.view` / `risks.manage` | ver [Registro de riesgos § Permisos](risks.md) |
| `compliance.view` / `compliance.manage` | ver [TurboLens § Security & Compliance](turbolens.md) |

`grc.view` controla la visibilidad de la propia ruta GRC — sin él, la entrada del menú superior queda oculta. Cada pestaña además exige su permiso de dominio, de modo que una visualizadora puede leer el registro sin poder disparar un escaneo LLM, por ejemplo.
