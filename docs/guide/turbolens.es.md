# Inteligencia AI de TurboLens

El módulo **TurboLens** proporciona análisis impulsado por IA de su paisaje de arquitectura empresarial. Utiliza el proveedor de IA configurado para realizar análisis de proveedores, detección de duplicados, evaluación de modernización y recomendaciones de arquitectura.

!!! note
    TurboLens requiere un proveedor de IA comercial (Anthropic Claude, OpenAI, DeepSeek o Google Gemini) configurado en [Configuración de IA](../admin/ai.md). El módulo está disponible automáticamente cuando la IA está configurada.

!!! info "Créditos"
    TurboLens está basado en el proyecto de código abierto [ArchLens](https://github.com/vinod-ea/archlens) de [Vinod](https://github.com/vinod-ea), publicado bajo la Licencia MIT. La lógica de análisis ha sido portada de Node.js a Python e integrada de forma nativa en Turbo EA.

## Panel de Control

El panel de control de TurboLens proporciona una visión general de un vistazo del análisis de su paisaje.

| Indicador | Descripción |
|-----------|-------------|
| **Total de Tarjetas** | Número de tarjetas activas en su portafolio |
| **Calidad Promedio** | Puntuación media de calidad de datos en todas las tarjetas |
| **Proveedores** | Número de proveedores tecnológicos analizados |
| **Grupos de Duplicados** | Número de grupos de duplicados identificados |
| **Modernizaciones** | Número de oportunidades de modernización encontradas |
| **Coste Anual** | Coste anual total en todas las tarjetas |

El panel de control también muestra:

- **Tarjetas por tipo** — Desglose del recuento de tarjetas por tipo de tarjeta
- **Distribución de calidad de datos** — Tarjetas agrupadas en niveles de calidad Bronce (<50%), Plata (50–80%) y Oro (>80%)
- **Principales problemas de calidad** — Tarjetas con las puntuaciones de calidad de datos más bajas, con enlaces directos a cada tarjeta

## Análisis de Proveedores

El análisis de proveedores utiliza IA para categorizar sus proveedores tecnológicos en más de 45 categorías del sector (p. ej., CRM, ERP, Infraestructura Cloud, Seguridad).

**Cómo usar:**

1. Navegue a **TurboLens > Vendors**
2. Haga clic en **Run Analysis**
3. La IA procesa su portafolio de proveedores en lotes, categorizando cada proveedor con razonamiento
4. Los resultados muestran un desglose por categorías y una tabla detallada de proveedores

Cada entrada de proveedor incluye la categoría, subcategoría, número de aplicaciones asociadas, coste anual total y el razonamiento de la IA para la categorización. Alterne entre las vistas de cuadrícula y tabla usando el selector de vista.

## Resolución de Proveedores

La resolución de proveedores construye una jerarquía canónica de proveedores resolviendo alias e identificando relaciones padre-hijo.

**Cómo usar:**

1. Navegue a **TurboLens > Resolution**
2. Haga clic en **Resolve Vendors**
3. La IA identifica alias de proveedores (p. ej., «MSFT» = «Microsoft»), empresas matrices y agrupaciones de productos
4. Los resultados muestran la jerarquía resuelta con puntuaciones de confianza

La jerarquía organiza los proveedores en cuatro niveles: proveedor, producto, plataforma y módulo. Cada entrada muestra el número de aplicaciones y componentes de TI vinculados, el coste total y un porcentaje de confianza.

## Detección de Duplicados

La detección de duplicados identifica solapamientos funcionales en su portafolio — tarjetas que sirven el mismo propósito empresarial o uno similar.

**Cómo usar:**

1. Navegue a **TurboLens > Duplicates**
2. Haga clic en **Detect Duplicates**
3. La IA analiza las tarjetas de Application, IT Component e Interface en lotes
4. Los resultados muestran grupos de posibles duplicados con evidencias y recomendaciones

Para cada grupo, puede:

- **Confirm** — Marcar el duplicado como confirmado para seguimiento
- **Investigate** — Señalar para investigación adicional
- **Dismiss** — Descartar si no es un duplicado real

## Evaluación de Modernización

La evaluación de modernización evalúa las tarjetas en busca de oportunidades de actualización basadas en las tendencias tecnológicas actuales.

**Cómo usar:**

1. Navegue a **TurboLens > Duplicates** (pestaña Modernization)
2. Seleccione un tipo de tarjeta de destino (Application, IT Component o Interface)
3. Haga clic en **Assess Modernization**
4. Los resultados muestran cada tarjeta con el tipo de modernización, recomendación, nivel de esfuerzo (bajo/medio/alto) y prioridad (baja/media/alta/crítica)

Los resultados se agrupan por prioridad para que pueda centrarse primero en las oportunidades de modernización de mayor impacto.

## IA de Arquitectura

La IA de Arquitectura es un asistente guiado de 5 pasos que genera recomendaciones de arquitectura basadas en su paisaje existente. Vincula sus objetivos empresariales y capacidades con propuestas de soluciones concretas, análisis de brechas, mapeo de dependencias y un diagrama de arquitectura objetivo.

<div style="text-align: center;">
<iframe width="560" height="315" src="https://www.youtube.com/embed/FDneDl0ULsA" title="Descripción general de la IA de Arquitectura" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
</div>

Un indicador de progreso en la parte superior rastrea su avance a través de las cinco etapas: Requisitos, Adecuación al Negocio, Adecuación Técnica, Solución y Arquitectura Objetivo. Puede hacer clic en cualquier paso previamente alcanzado para navegar hacia atrás y revisar fases anteriores — todos los datos posteriores se preservan y solo se eliminan cuando vuelve a enviar activamente una fase. Su progreso se guarda automáticamente en la sesión del navegador, por lo que puede navegar a otro lugar y regresar sin perder su trabajo. También puede guardar evaluaciones en la base de datos y retomarlas más tarde (consulte [Guardar y retomar](#guardar-y-retomar) a continuación). Haga clic en **Nueva Evaluación** para comenzar un análisis nuevo en cualquier momento.

### Paso 1: Requirements

Introduzca su requisito empresarial en lenguaje natural (p. ej., «Necesitamos un portal de autoservicio para clientes»). A continuación:

- **Select Business Objectives** — Elija una o más tarjetas de Objective existentes en el menú desplegable de autocompletado. Esto fundamenta el análisis de la IA en sus objetivos estratégicos. Se requiere al menos un objetivo.
- **Select Business Capabilities** (opcional) — Elija tarjetas de Business Capability existentes o escriba nuevos nombres de capacidades. Las nuevas capacidades aparecen como chips azules etiquetados como «NEW: nombre». Esto ayuda a la IA a centrarse en áreas de capacidad específicas.

Haga clic en **Generate Questions** para continuar.

### Paso 2: Business Fit (Fase 1)

La IA genera preguntas de aclaración empresarial adaptadas a su requisito y objetivos seleccionados. Las preguntas son de diferentes tipos:

- **Text** — Campos de respuesta de texto libre
- **Single choice** — Haga clic en un chip de opción para seleccionar
- **Multi choice** — Haga clic en varios chips de opción; también puede escribir una respuesta personalizada y pulsar Enter

Cada pregunta puede incluir contexto que explica por qué la IA la formula (nota de «Impacto»). Responda todas las preguntas y haga clic en **Submit** para continuar a la Fase 2.

### Paso 3: Technical Fit (Fase 2)

La IA genera preguntas técnicas en profundidad basadas en sus respuestas de la Fase 1. Estas pueden incluir categorías NFR (requisito no funcional) como rendimiento, seguridad o escalabilidad. Responda todas las preguntas y haga clic en **Analyse Capabilities** para generar opciones de solución.

### Paso 4: Solution (Fase 3)

Este paso tiene tres subfases:

#### 3a: Opciones de Solución

La IA genera múltiples opciones de solución, cada una presentada como una tarjeta con:

| Elemento | Descripción |
|----------|-------------|
| **Approach** | Buy, Build, Extend o Reuse — chip con código de colores |
| **Summary** | Breve descripción del enfoque |
| **Pros & Cons** | Principales ventajas y desventajas |
| **Estimates** | Coste estimado, duración y complejidad |
| **Impact Preview** | Nuevos componentes, componentes modificados, componentes retirados y nuevas integraciones que introduciría esta opción |

Haga clic en **Select** en la opción que desea seguir. Si regresa a este paso después de seleccionar una opción, la opción previamente elegida se resalta visualmente con un borde y una insignia «Seleccionado» para que pueda identificar fácilmente su elección actual.

#### 3b: Análisis de Brechas

Tras seleccionar una opción, la IA identifica brechas de capacidad en su paisaje actual. Cada brecha muestra:

- **Nombre de la capacidad** con nivel de urgencia (crítico/alto/medio)
- **Descripción del impacto** que explica por qué esta brecha es importante
- **Recomendaciones de mercado** — Recomendaciones de productos clasificadas (oro n.º 1, plata n.º 2, bronce n.º 3) con proveedor, razonamiento, ventajas/desventajas, coste estimado y esfuerzo de integración

Seleccione los productos que desea incluir haciendo clic en las tarjetas de recomendación (aparecen casillas de verificación). Haga clic en **Analyse Dependencies** para continuar.

#### 3c: Análisis de Dependencias

Tras seleccionar los productos, la IA identifica dependencias adicionales de infraestructura, plataforma o middleware requeridas por sus selecciones. Cada dependencia muestra:

- **Necesidad** con nivel de urgencia
- **Motivo** que explica por qué se requiere esta dependencia
- **Opciones** — Productos alternativos para satisfacer la dependencia, con el mismo detalle que las recomendaciones de brechas

Seleccione las dependencias y haga clic en **Generate Capability Map** para producir la arquitectura objetivo final.

### Paso 5: Target Architecture

El paso final genera un mapeo de capacidades completo:

| Sección | Descripción |
|---------|-------------|
| **Summary** | Narrativa de alto nivel de la arquitectura propuesta |
| **Capabilities** | Lista de Business Capabilities coincidentes — las existentes (en verde) y las nuevas propuestas (en azul) |
| **Proposed Cards** | Nuevas tarjetas que se crearán en su paisaje, mostradas con sus iconos de tipo de tarjeta y subtipos |
| **Proposed Relations** | Conexiones entre las tarjetas propuestas y los elementos del paisaje existente |
| **Dependency Diagram** | Diagrama C4 interactivo que muestra los nodos existentes junto con los nodos propuestos (bordes discontinuos con insignia verde «NEW»). Desplácese, amplíe y explore la arquitectura visualmente |

Desde este paso, puede hacer clic en **Choose Different** para volver y seleccionar una opción de solución diferente, o en **Start Over** para comenzar una evaluación completamente nueva.

!!! warning "Evaluación asistida por IA"
    Esta evaluación utiliza IA para generar recomendaciones, opciones de solución y una arquitectura objetivo. Debe ser realizada por un profesional de TI cualificado (arquitecto empresarial, arquitecto de soluciones, líder de TI) en colaboración con las partes interesadas del negocio. Los resultados generados requieren criterio profesional y pueden contener imprecisiones. Utilice los resultados como punto de partida para discusiones y refinamientos posteriores.

### Guardar y retomar

Después de revisar la arquitectura objetivo, puede guardar o confirmar su trabajo:

**Guardar evaluación** — Persiste una instantánea completa de la evaluación (todas las respuestas, opciones seleccionadas, análisis de brechas, dependencias y arquitectura objetivo) en la base de datos. Las evaluaciones guardadas aparecen en la pestaña **Evaluaciones**.

**Retomar una evaluación guardada** — Las evaluaciones no confirmadas pueden reabrirse en el asistente interactivo con el estado completamente restaurado:

- Desde la pestaña **Evaluaciones**, haga clic en el botón **Retomar** en cualquier fila de evaluación guardada
- Desde el **Visor de evaluación** de solo lectura, haga clic en **Retomar** en el encabezado
- El asistente se restaura a la fase y estado exactos donde lo dejó, incluyendo todas las preguntas generadas por la IA, sus respuestas, opciones seleccionadas y selecciones de productos
- Puede continuar desde donde se detuvo, elegir un enfoque diferente o confirmar para crear una iniciativa
- Guardar de nuevo actualiza la evaluación existente (en lugar de crear una nueva)

!!! tip "Instantánea completa"
    Una evaluación guardada es una instantánea completa de su sesión del asistente. Mientras no se haya confirmado en una iniciativa, puede retomarla, elegir un enfoque de solución diferente y volver a guardarla tantas veces como sea necesario.

**Confirmar y crear iniciativa** — Convierte la propuesta de arquitectura en tarjetas reales en su panorama:

- **Nombre de la iniciativa** se rellena por defecto con el título de la opción de solución seleccionada (editable antes de la creación)
- **Fechas de inicio/fin** para el cronograma de la iniciativa
- **Nuevas tarjetas propuestas** con interruptores para incluir o excluir tarjetas individuales, e iconos de edición para renombrar tarjetas antes de la creación. Esta lista incluye las nuevas Business Capabilities identificadas durante la evaluación.
- **Relaciones propuestas** con interruptores para incluir o excluir
- Un indicador de progreso muestra el estado de creación (iniciativa → tarjetas → relaciones → ADR)
- En caso de éxito, un enlace abre la nueva tarjeta de Iniciativa

### Salvaguardas arquitectónicas

El sistema aplica automáticamente la integridad arquitectónica:

- Cada nueva aplicación se vincula a al menos una Business Capability
- Cada nueva Business Capability se vincula a los objetivos de negocio seleccionados
- Las tarjetas sin relaciones (huérfanas) se eliminan automáticamente de la propuesta

### Architecture Decision Record

Un borrador de ADR se crea automáticamente junto con la iniciativa con:

- **Contexto** del resumen del mapeo de capacidades
- **Decisión** que captura el enfoque y los productos seleccionados
- **Alternativas consideradas** de las opciones de solución no seleccionadas

### Cambiar enfoque

Haga clic en **Choose Different** para volver a las opciones de solución y seleccionar un enfoque diferente. Todas sus respuestas de la Fase 1 y la Fase 2 se conservan — solo se restablecen los datos posteriores (análisis de brechas, dependencias, arquitectura objetivo). Tras seleccionar una nueva opción, el asistente vuelve a recorrer el análisis de brechas y el análisis de dependencias. Puede guardar la evaluación actualizada o confirmar cuando esté listo.

## Seguridad y Cumplimiento

La pestaña **Seguridad y Cumplimiento** ejecuta un análisis bajo demanda contra el paisaje vigente y produce un informe de riesgos conforme a estándares más un análisis de brechas regulatorias.

### Qué se analiza

- **CVE** — cada Aplicación y Componente de TI no archivado se busca en la [Base Nacional de Vulnerabilidades del NIST](https://nvd.nist.gov/) usando los atributos `vendor`, `productName` / `version` de la ficha. Los resultados se contextualizan mediante una pasada de IA que califica **prioridad** (crítica / alta / media / baja) y **probabilidad** (muy alta / alta / media / baja) a partir de la criticidad de negocio, la fase del ciclo de vida, el vector de ataque, la explotabilidad y la disponibilidad de parches.
- **Cumplimiento** — el mismo paisaje se comprueba con el LLM configurado contra **Ley de IA de la UE**, **RGPD**, **NIS2**, **DORA**, **SOC 2** e **ISO/IEC 27001**. Cada regulación tiene su propia lista de control; los hallazgos son **específicos de una ficha** (una ficha concreta es el origen de la brecha) o **de alcance transversal** (problema sistémico).

### Ejecutar un análisis

Sólo los usuarios con `security_compliance.manage` pueden lanzar análisis (admin por defecto). La pestaña Resumen muestra **dos tarjetas de análisis independientes**:

- **Análisis CVE** — consulta NVD + priorización por IA. Puede relanzarse sin peligro; los hallazgos de cumplimiento no se ven afectados.
- **Análisis de cumplimiento** — análisis de brechas por IA contra las regulaciones marcadas. Reemplaza los hallazgos de cumplimiento para las regulaciones incluidas en esta ejecución.

Cada análisis muestra su propia barra de progreso por fases (cargar fichas → consultar NVD → priorización IA → guardar, o cargar fichas → detección semántica de IA → comprobación por regulación). Ambos pueden correr en paralelo.

Refrescar la página **no interrumpe un análisis en curso** — la tarea en segundo plano sigue corriendo en el servidor y la interfaz vuelve a engancharse automáticamente al sondeo de progreso al recargar.

### Estructura del informe de riesgos

- **Resumen** — barra de KPI (total de hallazgos, recuentos críticos / altos / medios, puntuación global de cumplimiento), una **matriz de riesgo probabilidad × severidad** de 5×5, los cinco hallazgos críticos principales y un mapa de calor compacto de cumplimiento en el que puede pulsar para ver el detalle. La matriz es **clicable**: al pulsar una celda se abre la sub-pestaña CVE filtrada por ese segmento, con un chip descartable sobre la tabla para ver (y borrar) el filtro activo.
- **CVE** — tabla filtrable con ficha, ID de CVE (enlazado a la página de detalle del NVD), puntuación base CVSS, severidad, prioridad, probabilidad, disponibilidad de parche y estado. Cada fila abre un panel de detalle con la descripción, vector CVSS, vector de ataque, puntuaciones de explotabilidad / impacto, referencias, impacto de negocio y remediación generados por IA, y una barra de acciones de estado (**Reconocer → Marcar en curso → Marcar mitigado / Aceptar riesgo / Reabrir**).
- **Cumplimiento** — una pestaña por regulación con una puntuación global y un listado en estilo tarjeta que muestra estado, artículo, categoría, requisito, descripción de la brecha, remediación y evidencias. Un pequeño chip **Detectado por IA** resalta las fichas marcadas como portadoras de IA por el detector semántico, aunque no estén etiquetadas como subtipos de IA.
- **Exportar CSV** — descarga los hallazgos CVE en un orden de columnas al estilo OWASP/NIST (Ficha, Tipo, CVE, CVSS, Severidad, Vector de Ataque, Probabilidad, Prioridad, Parche, Publicada, Última Modificación, Estado, Proveedor, Producto, Versión, Impacto de Negocio, Remediación, Descripción).

### Promover un hallazgo al Registro de Riesgos

Cada panel CVE y cada tarjeta de hallazgo de cumplimiento incluye una acción primaria **Crear riesgo**. Al pulsarla se abre el diálogo compartido de creación de riesgo con el título, descripción, categoría, probabilidad, impacto, mitigación y ficha afectada **precargados desde el hallazgo**. Puede editar cualquier campo antes de enviarlo, asignar un **propietario** y elegir una **fecha objetivo de resolución**. Al enviar, la fila del hallazgo pasa a **Abrir riesgo R-000123** para mantener el enlace visible — las promociones son idempotentes en el servidor. Consulte el [Registro de Riesgos](risks.md) para el ciclo completo alineado con TOGAF y cómo la asignación del propietario crea una tarea de seguimiento + notificación en la campanita.

### Detección semántica de la Ley de IA de la UE

Las funciones de IA suelen estar embebidas dentro de aplicaciones de propósito general. La pasada de Ley de IA de la UE **no se basa sólo en el filtrado por subtipo**: pide al LLM que marque cada ficha cuyo nombre, descripción, proveedor o interfaces relacionadas sugieran capacidades de IA / ML — LLM, motores de recomendación, visión por computador, puntuación de fraude o crediticia, chatbots, analítica predictiva, detección de anomalías. Los hallazgos producidos por esta pasada semántica se marcan como **Detectado por IA** para distinguirlos de fichas ya clasificadas como `AI Agent` / `AI Model`.

### Progreso y reanudación

Cada análisis escribe el progreso por fases (cargar fichas → consultar NVD → priorización IA → guardar, o cargar fichas → detección semántica de IA → comprobación por regulación) en su registro de ejecución. La interfaz muestra una barra de progreso en vivo por análisis. **Refrescar la página no interrumpe un análisis** — la tarea en segundo plano continúa en el servidor, y al montarse, la pestaña Seguridad consulta `/turbolens/security/active-runs` y vuelve a engancharse al bucle de sondeo.

### Clave de API del NVD (opcional)

Sin clave, el NVD sólo permite 5 peticiones cada 30 segundos, lo que puede ralentizar análisis de paisajes grandes. Solicite una clave gratuita en <https://nvd.nist.gov/developers/request-an-api-key> y configúrela en la variable de entorno `NVD_API_KEY` para elevar el límite a 50 peticiones cada 30 segundos.

### Flujo de estado

Cada hallazgo CVE recorre: **abierto** → **reconocido** → **en curso** → **mitigado** (o **aceptado**, cuando el equipo ha aceptado formalmente el riesgo). La reapertura siempre está disponible. Los cambios de estado los realizan usuarios con `security_compliance.manage`. Para flujos de gobernanza (titularidad, evaluación residual, justificación de aceptación, tareas y notificaciones) promueva el hallazgo a un Riesgo — el ciclo completo vive en el [Registro de Riesgos](risks.md).

## Historial de Análisis

Todas las ejecuciones de análisis se rastrean en **TurboLens > History**, mostrando:

- Tipo de análisis (análisis de proveedores, resolución de proveedores, detección de duplicados, modernización, arquitecto, security_compliance)
- Estado (en ejecución, completado, fallido)
- Marcas de tiempo de inicio y finalización
- Mensajes de error (si los hubiera)

## Permisos

| Permiso | Descripción |
|---------|-------------|
| `turbolens.view` | Ver resultados de análisis (otorgado a admin, bpm_admin, member) |
| `turbolens.manage` | Activar análisis (otorgado a admin) |
| `security_compliance.view` | Ver hallazgos CVE y de cumplimiento (otorgado a admin, bpm_admin, member, viewer) |
| `security_compliance.manage` | Lanzar análisis de seguridad y actualizar el estado de los hallazgos (otorgado a admin) |
