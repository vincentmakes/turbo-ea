# Su primer análisis: Armonización de Aplicaciones

Esta es la recompensa. Tiene un inventario de aplicaciones, un mapa de capacidades y un campo de disposición TIME. Ahora los conecta y produce los dos informes que justifican todo el programa de EA ante un CIO:

- Un **Informe de Portafolio** que muestra cada aplicación dimensionada por costo, coloreada por disposición TIME.
- Un **Mapa de Calor de Capacidades** que muestra dónde tiene redundancia (varias aplicaciones por capacidad) y fragilidad (una sola aplicación por capacidad).

## Paso 1 — Mapee aplicaciones a capacidades

La relación más valiosa de todo el metamodelo es **Application → Business Capability** (`supports` / `supported by`). La establecerá para cada aplicación dentro del alcance.

### Camino masivo: modo edición de inventario

1. Vaya a **Inventario**, filtre por Tipo = `Application`.
2. Asegúrese de que la columna de relación **Business Capability** sea visible (pestaña Columnas → Relaciones).
3. Active el modo **Edición de Cuadrícula** en la barra de herramientas.
4. Haga clic en la celda de capacidad en cada fila y elija una o más capacidades.
5. Guarde.

Para 50–200 aplicaciones, esto toma una tarde y una taza de café.

### Camino ficha por ficha

Para mapeos de alto criterio (o cuando hay un taller con el Propietario de la Aplicación involucrado), abra cada ficha de Aplicación y use la sección **Relaciones**. Obtiene el selector completo con búsqueda, vista previa de jerarquía y la capacidad de establecer atributos de relación.

### ¿Cuántas capacidades por aplicación?

| Cantidad de mapeos | Qué significa |
|--------------------|---------------|
| **0** | Sin mapear — su inventario está incompleto. Filtre por estos y corrija. |
| **1** | El caso limpio e ideal — esta aplicación soporta exactamente una capacidad. |
| **2–3** | Bien — muchas aplicaciones abarcan un par de capacidades relacionadas. |
| **4+** | Sospechoso — puede estar confundiendo "usa datos de" con "soporta". Revise. |

!!! tip "Buena práctica"
    El mapeo de primera pasada es rápido y aproximado. La segunda pasada — hecha con el Propietario de la Aplicación revisando — es lo que hace que los datos sean confiables. Planifique para ambas.

## Paso 2 — Elija cómo completará el Modelo TIME

El campo integrado **Modelo TIME** en Application (`timeModel`, obligatorio, cuatro opciones: `tolerate` / `invest` / `migrate` / `eliminate`) es la columna de decisión que impulsa el resto del análisis. Tiene dos maneras de poblarlo.

### Opción A — Entrada manual de TIME (recomendada para la primera pasada)

Con el Propietario de la Aplicación en un taller de una hora típicamente puede clasificar 30–50 aplicaciones:

- **Tolerar** — funciona, bajo costo, no es un diferenciador estratégico. Déjelo en paz.
- **Invertir** — estratégico, área de crecimiento, financie mejoras.
- **Migrar** — reemplazar o mover a una nueva plataforma dentro del horizonte de planificación.
- **Eliminar** — duplicado, fin de vida, dar de baja.

Use el modo **Edición de Cuadrícula** del inventario con la columna **Modelo TIME** visible para capturar decisiones a velocidad.

### Opción B — TIME calculado mediante una fórmula

En lugar de pedirle a cada Propietario de Aplicación que establezca TIME manualmente, puede derivar `timeModel` automáticamente a partir de las dos dimensiones de idoneidad integradas (`functionalSuitability` × `technicalSuitability`) utilizando la función **Cálculos**. Esta es la clásica ubicación en cuatro cuadrantes de Gartner.

El ejemplo trabajado — la fórmula, la tabla de cuadrantes y el patrón híbrido recomendado — se encuentra en [Personalice el metamodelo → Opción: derive un campo automáticamente con un Cálculo](customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation). Úselo como recomendación inicial que los propietarios luego validan, no como un veredicto.

## Paso 3 — Ejecute el Informe de Portafolio

1. Vaya a **Informes → Portafolio**.
2. Configure los ejes:
    - **Tipo de ficha**: `Application`
    - **Eje X**: `technicalSuitability` (el campo integrado de aptitud técnica).
    - **Eje Y**: `functionalSuitability` o `businessValue` (campos integrados de aptitud al negocio).
    - **Tamaño**: `costTotalAnnual` — cuanto mayor sea el gasto, mayor será la burbuja.
    - **Color**: `timeModel` — esto es lo que hace que el informe esté listo para la decisión.
3. Guarde la configuración como una vista nombrada ("Portafolio de Aplicaciones — Dominio de Ventas") para que pueda volver a ella.

Qué buscar:

- **Burbujas rojas grandes** (candidatos a Eliminar de alto costo) — sus ahorros más rápidos.
- **Burbujas ámbar grandes** (candidatos a Migrar de alto costo) — sus decisiones de transformación más consecuentes.
- **Grupos en la parte superior derecha de la matriz** que no son verdes — aplicaciones estratégicas que no están recibiendo la inversión.

Referencia: [Informes](../guide/reports.md).

## Paso 4 — Ejecute el Mapa de Calor de Capacidades

1. Vaya a **Informes → Mapa de Capacidades**.
2. El mapa de calor muestra su jerarquía de capacidades de negocio con la intensidad del color de las celdas proporcional al **número de aplicaciones que soportan esa capacidad**.

Qué buscar:

- **Celdas calientes** (muchas aplicaciones por capacidad) — redundancia candidata. El caso de negocio más común para una Racionalización del portafolio de aplicaciones vive aquí.
- **Celdas frías** con aplicaciones que esperaría — brechas en su mapeo, o capacidades genuinamente subsoportadas.
- **Celdas blancas** en medio de una rama activa — aplicaciones no mapeadas, o capacidades no modeladas.

Referencia: [Informes → Mapa de Capacidades](../guide/reports.md).

## Paso 5 — Presente e itere

Ahora tiene una vista de portafolio defendible. Ponga los dos informes frente al CIO de Ventas (o quien sea dueño de su alcance) y:

- Confirme las decisiones TIME en las 10 aplicaciones de mayor costo.
- Identifique las 3 principales celdas calientes en el mapa de calor como proyectos candidatos de racionalización.
- Capture los seguimientos como comentarios o tareas pendientes en las aplicaciones mismas — Turbo EA los rastrea por ficha.

Eso es todo. Tiene una práctica de EA funcional en Turbo EA.

## Qué sigue

Una vez que su portafolio de aplicaciones esté vivo y sea confiable, estos se convierten en próximos pasos de alto valor. Ninguno de ellos es útil antes de que tenga un inventario poblado — razón por la cual esta guía los aplazó deliberadamente.

| Módulo | Cuándo abrirlo | Dónde encontrarlo |
|--------|----------------|-------------------|
| **Registro de Riesgos** | Cuando esté listo para rastrear riesgos de arquitectura contra aplicaciones y capacidades (TOGAF Fase G). | [Registro de Riesgos](../guide/risks.md) |
| **GRC / Cumplimiento** | Cuando necesite mapear aplicaciones y capacidades contra regulaciones (GDPR, NIS2, EU AI Act, DORA, SOC 2, ISO 27001). | [GRC](../guide/grc.md) |
| **PPM** | Cuando las decisiones de racionalización se conviertan en proyectos con presupuestos, cronogramas e informes de estado. | [PPM](../guide/ppm.md) |
| **TurboLens AI** | Cuando tenga suficientes fichas para que la IA encuentre duplicados de proveedores, candidatos a modernización y recomendaciones de arquitectura. | [TurboLens](../guide/turbolens.md) |
| **BPM** | Cuando esté listo para modelar los procesos que se asientan sobre sus aplicaciones. | [BPM](../guide/bpm.md) |
| **Diagramas** | Cuando necesite diagramas de arquitectura de forma libre que se mantengan sincronizados con el inventario. | [Diagramas](../guide/diagrams.md) |
| **EA Delivery** | Cuando comience a producir Declaraciones de Trabajo de Arquitectura y Registros de Decisiones de Arquitectura al estilo TOGAF. | [EA Delivery](../guide/delivery.md) |

Bienvenido a Turbo EA.
