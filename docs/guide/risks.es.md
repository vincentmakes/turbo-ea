# Registro de Riesgos

El **Registro de Riesgos** captura los riesgos de arquitectura durante todo su ciclo de vida — desde la identificación hasta la mitigación, la evaluación residual, la supervisión y el cierre (o la aceptación formal). Vive como la pestaña **Riesgo** del [módulo GRC](grc.md) en `/grc?tab=risk`.

## Alineación con TOGAF

El registro implementa el proceso de Gestión de Riesgos de Arquitectura de **TOGAF ADM Fase G — Gobernanza de la Implementación** (TOGAF 10 §27):

| Paso TOGAF | Qué captura |
|-----------|-------------|
| Clasificación de riesgo | `Categoría` (security, compliance, operational, technology, financial, reputational, strategic) |
| Identificación del riesgo | `Título`, `Descripción`, `Origen` (manual o promovido desde un hallazgo de TurboLens) |
| Evaluación inicial | `Probabilidad inicial × Impacto inicial → Nivel inicial` (derivado automáticamente) |
| Mitigación | Una o más **tareas de mitigación** — elementos de trabajo asignados, de un solo uso o recurrentes (véase [Tareas de mitigación](#mitigation-tasks) abajo). El riesgo también lleva un `Propietario` y una `Fecha objetivo de resolución`. |
| Evaluación residual | `Probabilidad residual × Impacto residual → Nivel residual` (editable una vez planificada la mitigación). Sigue siendo una evaluación **manual** — completar una tarea no la ajusta automáticamente. La página de detalle muestra junto al bloque residual un resumen «X/Y abiertas · Z vencidas» como contexto para el juicio humano (alineado con ISO 31000). |
| Supervisión / aceptación | Flujo de `Estado`: identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed (con una rama lateral `accepted` que exige una justificación explícita) |

## Crear un riesgo

Tres caminos convergen en el mismo diálogo **Crear riesgo** — cada variante precarga campos distintos para que edite y envíe:

Las tres variantes incluyen los campos **Propietario**, **Categoría** y **Fecha objetivo de resolución** para asignar responsabilidad ya en la creación — sin necesidad de reabrir el riesgo.

La promoción es **idempotente** — una vez que un hallazgo ha sido promovido, su botón cambia a **Abrir riesgo R-000123** y navega directamente a la página de detalle del riesgo.

## Propietario → Todo + notificación

Asignar un **propietario** (ya sea al crear o después) automáticamente:

- Crea un **Todo de sistema** en la página de Tareas del propietario. La descripción es `[Risk R-000123] <título>`, la fecha de vencimiento refleja la fecha objetivo del riesgo y el enlace devuelve al detalle del riesgo. El Todo se marca como **hecho** automáticamente cuando el riesgo llega a `mitigated` / `monitoring` / `accepted` / `closed`.
- Dispara una **notificación en la campanita** (`risk_assigned`) — visible en el desplegable de la campanita y en la página de notificaciones, con correo opcional si el usuario lo ha activado. La autoasignación también dispara la campanita, de modo que la traza sea consistente entre flujos de equipo y personales.

Limpiar o reasignar el propietario mantiene el Todo sincronizado — el antiguo se elimina / se reasigna.

La misma mecánica se activa de forma independiente para **cada tarea de mitigación** del riesgo, de modo que un colaborador solo ve el trabajo que le corresponde — véase [Tareas de mitigación](#mitigation-tasks) abajo.

## Enlazar riesgos con fichas

Los riesgos son **muchos-a-muchos** con las fichas. Un riesgo puede afectar a varias Aplicaciones o Componentes de TI, y una ficha puede tener varios riesgos vinculados:

- Desde la página de detalle del riesgo: panel **Fichas afectadas** → elija una ficha y añádala. Haga clic en `×` para desvincular. El selector muestra de inmediato una lista navegable (no hace falta escribir), carga más fichas al desplazarse y oculta las que ya están vinculadas.
- Desde cualquier página de detalle de ficha: la nueva pestaña **Riesgos** lista cada riesgo vinculado a esa ficha, con un camino de un clic de vuelta al registro.

Las fichas vinculadas se **agrupan por tipo de ficha**, se ordenan alfabéticamente dentro de cada grupo y se colorean con el color propio del tipo, de modo que un riesgo que toca una docena de fichas de varios tipos sigue leyéndose de un vistazo. El mismo orden y los mismos colores se aplican a la columna **Fichas** de la cuadrícula del registro, donde cada ficha se muestra como un chip en el color de su tipo — la información emergente de la celda lista el conjunto completo bajo encabezados de tipo.

## Tareas de mitigación {: #mitigation-tasks }

La mitigación se captura como **elementos de trabajo asignados**, no como texto libre. En la página de detalle del riesgo, el panel **Tareas de mitigación** sustituye al antiguo campo único «plan de mitigación» — cada fila es una tarea real con su propio propietario, fecha de vencimiento, historial y (opcionalmente) una regla de recurrencia.

### De un solo uso vs. recurrente

Una tarea de mitigación es **de un solo uso** por defecto — adecuada para «Desplegar MFA», «Firmar SCC actualizadas» o cualquier trabajo con forma de proyecto. Active **Se repite** en el diálogo de la tarea y obtendrá una **revisión de control recurrente**: p. ej. «Re-atestiguar la documentación de transferencias transfronterizas cada 12 meses», «Realizar el simulacro de incidente OT cada 3 meses», «Auditar credenciales de Jenkins cada semana».

Las tareas recurrentes acumulan un **ciclo** (`occurrence`) por periodo. El siguiente ciclo se crea automáticamente al cerrar el actual — con aritmética de calendario correcta: una tarea mensual con vencimiento el 31 de enero pasa al 28 de febrero, no al 3 de marzo.

### La ventana de anticipación

El sentido de una revisión de control recurrente es que la persona responsable reciba el recordatorio **justo antes de la fecha de vencimiento** — no en el momento en que se cerró el ciclo anterior. Por eso cada tarea recurrente lleva un **Tiempo de anticipación** (días) — cuántos días antes de `due_date` el ciclo se activa y aparece en la lista `/todos` de la persona asignada.

Cada ciclo recorre tres estados visibles:

| Estado | Significado | ¿Visible en /todos? |
|--------|-------------|---------------------|
| **Programada** | El siguiente ciclo existe para la pista de auditoría («próxima revisión: vence el 15/11/2026») pero está latente. Hoy todavía está fuera de la ventana de anticipación. | No |
| **Abierta** | La ventana de anticipación se ha abierto. Un Todo de sistema `[Risk R-000123] <título de tarea>` aparece en la lista de la persona asignada; se dispara una notificación `task_assigned`. | Sí (pestaña Abiertas) |
| **Completada** / **Saltada** | La persona asignada cerró el ciclo. El Todo cambia a `done` y permanece en la pestaña **Completadas** como registro histórico. | Sí (pestaña Completadas) |

El diálogo sugiere un tiempo de anticipación sensato por unidad de recurrencia (1 día diaria, 2 semanal, 7 mensual, 14 anual — limitado a la mitad del ciclo para que la ventana no se solape con el ciclo anterior). La sugerencia se actualiza al cambiar la unidad o el intervalo, hasta que edite usted el campo.

Una vez al día a las **03:00 UTC** un proceso en segundo plano revisa todos los ciclos programados y promueve aquellos cuya ventana se ha abierto. ¿Necesita iniciar una revisión antes? Haga clic en **Activar ahora** (icono rayo en la fila de la tarea) para cambiar un ciclo programado a abierto inmediatamente — misma mecánica de Todo y notificación, sin esperar.

### Historial de auditoría por ciclo

Haga clic en la flecha de expansión de una fila de tarea para ver el historial de ciclos. Cada ocurrencia registra:

- La **fecha objetivo** en el momento de la planificación.
- Quién estaba **asignado** cuando se abrió el ciclo (`assigned_owner_id`), para que las revisiones históricas conserven su propietario original aunque el rol cambie después.
- Para ciclos cerrados: quién lo **completó** (`completed_by`), la marca de tiempo, la **instantánea propietario-al-cierre** (puede diferir del asignado si hubo rotación a mitad de ciclo) y notas libres de cierre.
- Para ciclos activados: la **marca de tiempo de activación** (para que la auditoría pueda verificar que la promoción diaria ocurrió el día correcto).

Esto sobrevive limpiamente a años de rotación de propietarios — la respuesta de auditoría a «¿Quién firmó la revisión de enero de 2024?» está a un clic de la tarea y no se pierde con los reequilibrios de responsabilidad.

### Permisos y personas asignadas

- **Añadir / editar / eliminar tareas** — requiere `risks.manage` (admin / bpm_admin / member por defecto).
- **Completar el ciclo abierto** — `risks.manage` **o** el usuario actualmente asignado a ese ciclo. Así un Viewer asignado a una revisión de control puede cerrar su propio ciclo sin escalar.
- **Saltar un ciclo / Activar ahora** — siempre requieren `risks.manage`. Saltar avanza la recurrencia sin afirmar que el trabajo se hizo; activar adelanta un ciclo programado y es una acción de planificación.

### Promoción desde un hallazgo de cumplimiento de TurboLens

Cuando hace clic en **Crear riesgo** en un hallazgo no conforme (véase [TurboLens](turbolens.md#promote-a-finding-to-the-risk-register)), el nuevo riesgo también recibe una **tarea de mitigación de un solo uso** inicializada desde el texto de remediación del hallazgo — así el análisis de brechas se convierte directamente en trabajo asignado y accionable.

### Exportación {: #export }

El botón **Exportar** del Registro de Riesgos escribe un `.xlsx` de dos hojas: la hoja 1 es la cuadrícula de riesgos filtrada, la hoja 2 es una fila por ciclo de cada tarea de cada riesgo en el mismo filtro, incluyendo el tiempo de anticipación y la marca de activación. Úselo para paquetes de auditoría o para partes interesadas sin acceso a Turbo EA. Cada fila de tarea en el panel de detalle dispone también de su propio botón **Exportar historial** para un libro por tarea.

### Importación {: #import }

El botón **Importar**, junto a «Exportar», carga riesgos de forma masiva desde un archivo `.xlsx`. Haga clic en **Descargar plantilla** para obtener un libro inicial con los encabezados correctos, rellene un riesgo por fila y súbalo. Una fila cuya `reference` coincide con un riesgo existente se **omite** (el importador nunca actualiza riesgos existentes), de modo que reimportar un registro exportado anteriormente es idempotente; cada otra fila crea un riesgo **completamente nuevo** con una referencia `R-NNNNNN` generada automáticamente. La vista previa indica cuántas filas se omitirán antes de que confirme.

Columnas reconocidas: `title` (obligatorio), `description`, `category`, `initial_probability`, `initial_impact`, `residual_probability`, `residual_impact`, `status`, `owner_email`, `target_resolution_date` (`YYYY-MM-DD`) y `cards` (nombres de fichas separados por punto y coma). Los responsables se asocian por correo electrónico y las fichas por nombre exacto **en la medida de lo posible** — todo lo que no se pueda asociar se omite con una advertencia no bloqueante y el riesgo se importa igualmente. Antes de escribir nada, verá una vista previa que muestra cuántas filas se crearán, cuáles tienen errores y las advertencias; no se guarda nada hasta que confirme. Requiere el permiso `risks.manage`.

## Matriz de riesgos

Tanto el Resumen de Seguridad de TurboLens como la página del Registro de Riesgos muestran un mapa de calor probabilidad × impacto de 4×4. Las celdas son **clicables** — haga clic en una para filtrar la lista inferior por ese segmento, y de nuevo (o en el × del chip) para borrar. En el Registro de Riesgos puede alternar la matriz entre las vistas **Inicial** y **Residual** para que el progreso de la mitigación se vea de un vistazo.

## Cuadrícula del registro

El registro es una cuadrícula AG Grid que sigue los estándares de la página [Inventario](inventory.md): columnas ordenables, filtrables y redimensionables con preferencias por usuario persistidas (columnas visibles, orden, estado de la barra lateral). Un botón **+ Nuevo riesgo** en la barra de herramientas abre el diálogo de creación manual. El botón **Exportar** de la barra de herramientas escribe un `.xlsx` de dos hojas con la cuadrícula de riesgos filtrada en la hoja 1 y una fila por ciclo de tarea de mitigación en la hoja 2 — véase [Tareas de mitigación → Exportación](#export) para el formato de columnas.

### Filtrar por fichas afectadas

La barra lateral de filtros de la izquierda tiene una sección **Fichas afectadas** que responde a las preguntas de paisaje que el filtro de columna no cubre:

- **Fichas** — elija una o varias fichas concretas para ver todos los riesgos que afectan a *cualquiera* de ellas («mostrar todos los riesgos que afectan a las aplicaciones A, B y C»). La lista ofrece cada ficha vinculada a al menos un riesgo, con búsqueda por nombre.
- **Tipo de ficha** — marque uno o varios tipos para ver todos los riesgos que tocan *cualquier* ficha de esos tipos («mostrar todos los riesgos que afectan a una aplicación»), sin nombrar fichas individuales.

Cada lista coincide con **cualquiera** de sus propias selecciones; las dos listas se combinan con **y**. Marcar `Application` y elegir la ficha *Payments Gateway* devuelve por tanto los riesgos que afectan a Payments Gateway **y** tocan al menos una aplicación.

Como cualquier otro filtro de la barra lateral, estos acotan la página entera: los indicadores, la matriz 4×4, la cuadrícula y ambas hojas de la exportación `.xlsx` siguen la selección activa.

## Propagación Riesgo ↔ Hallazgo

Si un Riesgo fue [promovido desde un hallazgo de TurboLens](turbolens.md#promote-a-finding-to-the-risk-register), los cambios de estado fluyen en **ambos sentidos**:

- El hallazgo lleva un enlace de retorno **Abrir riesgo R-000123** desde el momento en que se promueve (la acción es idempotente — pulsar de nuevo navega al riesgo existente en lugar de crear un duplicado).
- Cuando el Riesgo alcanza `mitigated` / `monitoring` / `closed` / `accepted` (o se elimina), el motor de retro-propagación transiciona automáticamente cada hallazgo de cumplimiento vinculado al valor correspondiente (`mitigated` / `verified` / `accepted` / `in_review`). La justificación de aceptación capturada en el Riesgo se refleja en la nota de revisión del hallazgo para que la pista de auditoría se mantenga consistente.

Esto mantiene alineados el Registro de Riesgos (vista de gobernanza) y la cuadrícula de Cumplimiento (vista operativa) sin mantenimiento manual.

## Flujo de estado

La página de detalle siempre muestra un único botón primario **Siguiente paso** más una pequeña fila de acciones laterales, de modo que el camino secuencial sea obvio pero las vías de escape de gobernanza queden a un clic:

| Estado actual | Siguiente paso (botón primario) | Acciones laterales |
|---|---|---|
| identified | Iniciar análisis | Aceptar riesgo |
| analysed | Planificar mitigación | Aceptar riesgo |
| mitigation_planned | Iniciar mitigación | Aceptar riesgo |
| in_progress | Marcar mitigado | Aceptar riesgo |
| mitigated | Iniciar supervisión | Retomar mitigación · Cerrar sin supervisión |
| monitoring | Cerrar | Retomar mitigación · Aceptar riesgo |
| accepted | — | Reabrir · Cerrar |
| closed | — | Reabrir |

Grafo completo de transiciones (forzado por el servidor):

```
identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed
       │           │             │                │            ▲           ▲
       └───────────┴─────────────┴────────────────┴──── accepted (se requiere justificación)
                                                              │
                              reopen → in_progress ◄──────────┘
```

- **Aceptar** un riesgo requiere una justificación de aceptación. El usuario, la marca de tiempo y la justificación quedan registrados.
- **Reabrir** un riesgo `accepted` / `closed` vuelve a `in_progress`. En `mitigated` también se permite una «Retomar mitigación» manual sin necesidad de una reapertura completa.

## Permisos

| Permiso | Quién lo obtiene por defecto |
|---------|-------------------------------|
| `risks.view` | admin, bpm_admin, member, viewer |
| `risks.manage` | admin, bpm_admin, member |

Los lectores (viewers) pueden ver el registro y los riesgos en las fichas pero no pueden crear, editar ni eliminar.
