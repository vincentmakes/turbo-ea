# Registro de Riesgos

El **Registro de Riesgos** captura los riesgos de arquitectura durante todo su ciclo de vida — desde la identificación hasta la mitigación, la evaluación residual, la supervisión y el cierre (o la aceptación formal). Vive como una pestaña dentro de **EA Delivery → Riesgos**, junto a Iniciativas, Principios de EA y Decisiones de Arquitectura.

## Alineación con TOGAF

El registro implementa el proceso de Gestión de Riesgos de Arquitectura de **TOGAF ADM Fase G — Gobernanza de la Implementación** (TOGAF 10 §27):

| Paso TOGAF | Qué captura |
|-----------|-------------|
| Clasificación de riesgo | `Categoría` (security, compliance, operational, technology, financial, reputational, strategic) |
| Identificación del riesgo | `Título`, `Descripción`, `Origen` (manual o promovido desde un hallazgo de TurboLens) |
| Evaluación inicial | `Probabilidad inicial × Impacto inicial → Nivel inicial` (derivado automáticamente) |
| Mitigación | `Plan de mitigación`, `Propietario`, `Fecha objetivo de resolución` |
| Evaluación residual | `Probabilidad residual × Impacto residual → Nivel residual` (editable una vez planificada la mitigación) |
| Supervisión / aceptación | Flujo de `Estado`: identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed (con una rama lateral `accepted` que exige una justificación explícita) |

## Crear un riesgo

Tres caminos convergen en el mismo diálogo **Crear riesgo** — cada variante precarga campos distintos para que edite y envíe:

1. **Manual** — pestaña Riesgos → **+ Nuevo riesgo**. Formulario en blanco.
2. **Desde un hallazgo CVE** — TurboLens → Seguridad y Cumplimiento → panel de CVE → **Crear riesgo**. Precarga título (ID de CVE sobre la ficha), descripción (texto del NVD + impacto de negocio + CVSS), categoría `security`, probabilidad/impacto del CVE, mitigación desde la recomendación de remediación del hallazgo y enlaza la ficha afectada.
3. **Desde un hallazgo de cumplimiento** — TurboLens → Seguridad y Cumplimiento → pestaña Cumplimiento → **Crear riesgo** sobre un hallazgo no conforme. Precarga categoría `compliance`, probabilidad/impacto a partir de la severidad + estado de la regulación, descripción desde el requisito + la brecha.

Las tres variantes incluyen los campos **Propietario**, **Categoría** y **Fecha objetivo de resolución** para asignar responsabilidad ya en la creación — sin necesidad de reabrir el riesgo.

La promoción es **idempotente** — una vez que un hallazgo ha sido promovido, su botón cambia a **Abrir riesgo R-000123** y navega directamente a la página de detalle del riesgo.

## Propietario → Todo + notificación

Asignar un **propietario** (ya sea al crear o después) automáticamente:

- Crea un **Todo de sistema** en la página de Tareas del propietario. La descripción es `[Risk R-000123] <título>`, la fecha de vencimiento refleja la fecha objetivo del riesgo y el enlace devuelve al detalle del riesgo. El Todo se marca como **hecho** automáticamente cuando el riesgo llega a `mitigated` / `monitoring` / `accepted` / `closed`.
- Dispara una **notificación en la campanita** (`risk_assigned`) — visible en el desplegable de la campanita y en la página de notificaciones, con correo opcional si el usuario lo ha activado. La autoasignación también dispara la campanita, de modo que la traza sea consistente entre flujos de equipo y personales.

Limpiar o reasignar el propietario mantiene el Todo sincronizado — el antiguo se elimina / se reasigna.

## Enlazar riesgos con fichas

Los riesgos son **muchos-a-muchos** con las fichas. Un riesgo puede afectar a varias Aplicaciones o Componentes de TI, y una ficha puede tener varios riesgos vinculados:

- Desde la página de detalle del riesgo: panel **Fichas afectadas** → busque y añada. Haga clic en `×` para desvincular.
- Desde cualquier página de detalle de ficha: la nueva pestaña **Riesgos** lista cada riesgo vinculado a esa ficha, con un camino de un clic de vuelta al registro.

## Matriz de riesgos

Tanto el Resumen de Seguridad de TurboLens como la página del Registro de Riesgos muestran un mapa de calor probabilidad × impacto de 4×4. Las celdas son **clicables** — haga clic en una para filtrar la lista inferior por ese segmento, y de nuevo (o en el × del chip) para borrar. En el Registro de Riesgos puede alternar la matriz entre las vistas **Inicial** y **Residual** para que el progreso de la mitigación se vea de un vistazo.

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
