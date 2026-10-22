# Su primer análisis: Armonización de Aplicaciones

Esta es la recompensa. Tiene un inventario de aplicaciones, un mapa de capacidades y el campo integrado Modelo TIME. Ahora los conecta y produce los dos informes que justifican todo el programa de EA ante un CIO:

- El informe **Portafolio de aplicaciones**, con cada aplicación agrupada por **Criticidad de negocio** y coloreada según su disposición **TIME** (**T**olerar / **I**nvertir / **M**igrar / **E**liminar).
- El **Mapa de capacidades**, un mapa de calor que muestra dónde tiene redundancia (varias aplicaciones por capacidad) y fragilidad (una sola aplicación por capacidad).

## Paso 1 — Mapee aplicaciones a capacidades

La relación más valiosa de todo el metamodelo es **Application → Business Capability** (`apoya` / `es apoyado por`). La establecerá para cada aplicación dentro del alcance.

### Camino masivo: modo edición de inventario

1. Vaya a **Inventario**, filtre por Tipo = `Application`.
2. Asegúrese de que la columna de relación **Business Capability** sea visible (pestaña Columnas → Relaciones).
3. Active el modo **Edición de Cuadrícula** en la barra de herramientas.
4. Haga clic en la celda de capacidad en cada fila y elija una o más capacidades. Cada cambio se guarda en cuanto lo hace.

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

## Paso 2 — Valore la criticidad y la idoneidad

Tres campos integrados de la sección **Evaluación** de cada ficha de Aplicación alimentan el análisis. Complételos con el Propietario de la Aplicación — en un taller de una hora típicamente puede valorar 30–50 aplicaciones usando la **Edición en cuadrícula** con las tres columnas visibles.

| Campo | Opciones | Qué responde |
|-------|----------|--------------|
| **Criticidad de negocio** | Crítico para la misión / Crítico para el negocio / Operativo / Administrativo | ¿Cuánto depende el negocio de esta aplicación? |
| **Idoneidad funcional** | Perfecto / Apropiado / Insuficiente / Inadecuado | ¿Qué tan bien hace lo que el negocio necesita? |
| **Idoneidad técnica** | Totalmente apropiado / Adecuado / Inadecuado / Inapropiado | ¿Qué tan sana es la tecnología subyacente? |

La Criticidad de negocio agrupa el informe del Paso 4. Las dos valoraciones de idoneidad son lo que lee el cálculo TIME del Paso 3.

Editar estos campos en una ficha aprobada cambia su estado de aprobación a **Roto**. Vuelva a aprobar las fichas en lote después del taller.

## Paso 3 — Derive TIME con un campo calculado

El campo integrado **Modelo TIME** en Application (`timeModel`, cuatro opciones: `tolerate` / `invest` / `migrate` / `eliminate`) es la columna de decisión que impulsa el resto del análisis. En lugar de pedirle a cada Propietario de la Aplicación que elija una, derívela de las dos valoraciones de idoneidad con un **cálculo** — la clásica ubicación de Gartner:

| | Idoneidad técnica alta | Idoneidad técnica baja |
|---|---|---|
| **Idoneidad funcional alta** | **Invertir** | **Migrar** |
| **Idoneidad funcional baja** | **Tolerar** | **Eliminar** |

1. Vaya a **Admin → Metamodelo → Cálculos** y haga clic en **Nuevo cálculo**.
2. Establezca **Tipo de ficha de destino** = `Application` y **Campo de destino** = **Modelo TIME**.
3. Pegue la fórmula de [Personalice el metamodelo → Opción: derive un campo automáticamente con un Cálculo](customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation). Usa los campos de idoneidad integrados, así que no se necesita ningún campo personalizado.
4. Haga clic en **Validar**, guarde y luego use **Probar con ficha** en algunas aplicaciones que conozca bien para comprobar el resultado.
5. Ponga el cálculo en **Activo** en la lista y luego haga clic en **Recalcular todo** en su fila para completar el Modelo TIME en todas las aplicaciones.

A partir de entonces, el Modelo TIME se recalcula cada vez que se guarda una aplicación, muestra una insignia **calculado** y ya no se puede editar a mano. Una aplicación a la que le falte cualquiera de las dos valoraciones de idoneidad no recibe valor TIME — es intencionado: le muestra qué valoraciones faltan todavía.

!!! warning "No haga esto"
    Un TIME calculado es una **hipótesis inicial**, no un veredicto. Revise los resultados con los Propietarios de las Aplicaciones antes de presentarlos. Cuando una decisión deba anular la fórmula, desactive el cálculo (el interruptor **Activo**) y edite el Modelo TIME a mano en la **Edición en cuadrícula**.

Referencia: [Admin → Cálculos](../admin/calculations.md).

## Paso 4 — Ejecute el informe Portafolio de aplicaciones

1. Vaya a **Informes → Portafolio de aplicaciones**.
2. Establezca **Agrupar por** = **Criticidad de negocio**.
3. Establezca **Colorear aplicaciones por** = **Modelo TIME**.
4. Haga clic en el icono de marcador (**Guardar informe**) y asigne un nombre a la vista ("Portafolio de Aplicaciones — Dominio de Ventas"). Lo encontrará de nuevo en **Informes → Informes guardados**.

Cada nivel de Criticidad de negocio se convierte en un recuadro, con un chip por aplicación coloreado según su disposición TIME y una barra que muestra la distribución. Para centrarse en un dominio, use el filtro **Relacionado por** con las capacidades de su alcance.

Qué buscar:

- **Aplicaciones "Crítico para la misión" y "Crítico para el negocio" marcadas como Migrar** — sus decisiones de modernización más consecuentes. Estas van primero.
- **Aplicaciones "Administrativo" y "Operativo" marcadas como Eliminar o Migrar** — sus logros de simplificación más rápidos: retírelas o consolídelas en otra plataforma.
- **Aplicaciones "Crítico para la misión" marcadas como Invertir** — confirme que realmente están recibiendo la inversión.
- **Aplicaciones sin color** (TIME *No definido*) — falta una de las dos valoraciones de idoneidad. Vuelva al Paso 2.

Referencia: [Informes → Informe de Portafolio](../guide/reports.md#informe-de-portafolio).

## Paso 5 — Ejecute el Mapa de capacidades

1. Vaya a **Informes → Mapa de capacidades**.
2. Mantenga la **Métrica del mapa de calor** en **Cantidad de aplicaciones**: la intensidad del color de las celdas es proporcional al número de aplicaciones que soportan esa capacidad.
3. Opcional: active **Mostrar aplicaciones** y establezca **Colorear apps por** = **Modelo TIME** para ver la disposición TIME de las aplicaciones dentro de cada capacidad.

Qué buscar:

- **Celdas calientes** (muchas aplicaciones por capacidad) — redundancia candidata. El caso de negocio más común para una Racionalización del portafolio de aplicaciones vive aquí.
- **Celdas frías** con aplicaciones que esperaría — brechas en su mapeo, o capacidades genuinamente subsoportadas.
- **Celdas blancas** en medio de una rama activa — aplicaciones no mapeadas, o capacidades no modeladas.

Referencia: [Informes → Mapa de Capacidades](../guide/reports.md#mapa-de-capacidades).

## Paso 6 — Presente e itere

Ahora tiene una vista de portafolio defendible. Ponga los dos informes frente al CIO de Ventas (o quien sea dueño de su alcance) y:

- Confirme las decisiones TIME en las aplicaciones "Crítico para la misión" y "Crítico para el negocio".
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
