# Gestión de Cartera de Proyectos (PPM)

El módulo **PPM** proporciona una solución completa de gestión de cartera de proyectos para el seguimiento de iniciativas, presupuestos, riesgos, tareas y cronogramas. Se integra directamente con el tipo de tarjeta Iniciativa para enriquecer cada proyecto con informes de estado, seguimiento de costos y visualización Gantt.

!!! note
    El módulo PPM puede ser habilitado o deshabilitado por un administrador en [Configuración](../admin/settings.md). Cuando está deshabilitado, la navegación y funciones de PPM quedan ocultas.

## Panel de Portafolio

El **Panel de Portafolio** es el punto de entrada principal para PPM. Proporciona:

- **Tarjetas de KPI** — Total de iniciativas, presupuesto total, costo real total y resúmenes de estado de salud
- **Gráficos circulares de salud** — Distribución de salud de cronograma, costo y alcance (En curso / En riesgo / Fuera de curso)
- **Distribución de estado** — Desglose por subtipo de iniciativa y estado
- **Vista general Gantt** — Barras de cronograma mostrando las fechas de inicio y fin de cada iniciativa, con indicadores de salud RAG

### Agrupación y filtrado

Use la barra de herramientas para:

- **Agrupar por** cualquier tipo de tarjeta relacionada (p. ej., Organización, Plataforma)
- **Filtrar por subtipo** (Idea, Programa, Proyecto, Épica)
- **Buscar** por nombre de iniciativa

Estos filtros se mantienen en la URL, por lo que al actualizar la página se conserva su vista actual.

## Vista de detalle de iniciativa

Haga clic en cualquier iniciativa para abrir su página de detalle con siete pestañas:

### Pestaña de visión general

La visión general muestra un resumen de la salud y finanzas de la iniciativa:

- **Resumen de salud** — Indicadores de cronograma, costo y alcance del último informe de estado
- **Presupuesto vs. Real** — Tarjeta de KPI combinada mostrando presupuesto total y gasto real con variación
- **Actividad reciente** — Resumen del último informe de estado

### Pestaña de informes de estado

Los informes de estado mensuales rastrean la salud del proyecto a lo largo del tiempo. Cada informe incluye:

| Campo | Descripción |
|-------|-------------|
| **Fecha del informe** | La fecha del período de reporte |
| **Salud del cronograma** | En curso, En riesgo o Fuera de curso |
| **Salud del costo** | En curso, En riesgo o Fuera de curso |
| **Salud del alcance** | En curso, En riesgo o Fuera de curso |
| **Resumen** | Resumen ejecutivo del estado actual |
| **Logros** | Lo que se logró en este período |
| **Próximos pasos** | Actividades planificadas para el próximo período |

### Pestaña de presupuesto y costos

Seguimiento de datos financieros con dos tipos de partidas:

- **Líneas de presupuesto** — Presupuesto planificado por año fiscal y categoría (CapEx / OpEx). Las líneas de presupuesto se agrupan según el **mes de inicio del año fiscal** configurado en [Configuración](../admin/settings.md#inicio-del-año-fiscal). Por ejemplo, si el año fiscal comienza en abril, una línea de presupuesto de junio de 2026 pertenece al AF 2026–2027
- **Líneas de costo** — Gastos reales con fecha, descripción y categoría

Los totales de presupuesto y costos se acumulan automáticamente en los atributos `costBudget` y `costActual` de la tarjeta de Iniciativa.

### Pestaña de gestión de riesgos

El registro de riesgos rastrea los riesgos del proyecto con:

| Campo | Descripción |
|-------|-------------|
| **Título** | Breve descripción del riesgo |
| **Probabilidad** | Puntuación de probabilidad (1–5) |
| **Impacto** | Puntuación de impacto (1–5) |
| **Puntuación de riesgo** | Calculado automáticamente como probabilidad x impacto |
| **Estado** | Abierto, Mitigando, Mitigado, Cerrado o Aceptado |
| **Mitigación** | Acciones de mitigación planificadas |
| **Responsable** | Usuario responsable de gestionar el riesgo |

### Pestaña de tareas

El gestor de tareas admite vistas de **tablero Kanban** y **lista** con cuatro columnas de estado:

- **Por hacer** — Tareas aún no iniciadas
- **En progreso** — Tareas en las que se está trabajando actualmente
- **Hecho** — Tareas completadas
- **Bloqueado** — Tareas que no pueden avanzar

Las tareas se pueden filtrar y agrupar por elemento de Estructura de Desglose del Trabajo (WBS). Arrastre y suelte tarjetas entre columnas para actualizar el estado.

Los filtros de visualización (modo de vista, filtro WBS, alternancia de agrupación) se mantienen en la URL entre actualizaciones de página.

### Pestaña Gantt

El diagrama de Gantt visualiza el cronograma del proyecto con:

- **Paquetes de trabajo (WBS)** — Elementos jerárquicos de estructura de desglose del trabajo con fechas de inicio/fin
- **Tareas** — Barras de tareas individuales vinculadas a paquetes de trabajo
- **Hitos** — Fechas clave marcadas con indicadores de diamante
- **Barras de progreso** — Porcentaje de finalización visual, arrastrables para ajustar directamente
- **Marcas trimestrales** — Cuadrícula de cronograma para orientación

### Pestaña de detalles de tarjeta

La última pestaña muestra la vista completa de detalle de la tarjeta, incluyendo todas las secciones estándar.

## Estructura de Desglose del Trabajo (WBS)

La WBS proporciona una descomposición jerárquica del alcance del proyecto:

- **Paquetes de trabajo** — Agrupaciones lógicas de tareas con fechas de inicio/fin y seguimiento de finalización
- **Hitos** — Eventos significativos o puntos de finalización
- **Jerarquía** — Relaciones padre-hijo entre elementos WBS
- **Auto-finalización** — El porcentaje de finalización se calcula automáticamente a partir de las proporciones de tareas hechas/totales, acumulándose recursivamente a través de la jerarquía WBS hasta los elementos padre. El completamiento del nivel superior representa el progreso general de la iniciativa

## Integración con los detalles de la ficha

Cuando PPM está activado, las fichas de **Iniciativa** muestran una pestaña **PPM** como última pestaña en la [vista de detalle de la ficha](card-details.md). Al hacer clic en esta pestaña, se navega directamente a la vista detallada PPM de la iniciativa (pestaña Resumen). Esto proporciona un punto de acceso rápido desde cualquier ficha de Iniciativa a su página de proyecto PPM completa.

A la inversa, la pestaña **Detalles de la ficha** dentro de la vista detallada PPM de la iniciativa muestra las secciones estándar de la ficha sin la pestaña PPM, evitando la navegación circular.

## Permisos

| Permiso | Descripción |
|---------|-------------|
| `ppm.view` | Ver el panel de PPM, diagrama de Gantt e informes de iniciativas. Concedido a todos los roles por defecto |
| `ppm.manage` | Crear y gestionar informes de estado, tareas, costos, riesgos y elementos WBS. Concedido a los roles Admin, BPM Admin y Miembro |
| `reports.ppm_dashboard` | Ver el panel del portafolio PPM. Concedido a todos los roles por defecto |
