# Inteligencia AI de ArchLens

El módulo **ArchLens** proporciona análisis impulsado por IA de su paisaje de arquitectura empresarial. Utiliza el proveedor de IA configurado para realizar análisis de proveedores, detección de duplicados, evaluación de modernización y recomendaciones de arquitectura.

!!! note
    ArchLens requiere un proveedor de IA comercial (Anthropic Claude, OpenAI, DeepSeek o Google Gemini) configurado en [Configuración de IA](../admin/ai.md). El módulo está disponible automáticamente cuando la IA está configurada.

!!! info "Créditos"
    ArchLens está basado en el proyecto de código abierto [ArchLens](https://github.com/vinod-ea/archlens) de [Vinod](https://github.com/vinod-ea), publicado bajo la Licencia MIT. La lógica de análisis ha sido portada de Node.js a Python e integrada de forma nativa en Turbo EA.

## Panel de Control

El panel de control de ArchLens proporciona una visión general de un vistazo del análisis de su paisaje.

![Panel de ArchLens](../assets/img/es/48_archlens_panel.png)

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

![Análisis de Proveedores](../assets/img/es/49_archlens_proveedores.png)

**Cómo usar:**

1. Navegue a **ArchLens > Vendors**
2. Haga clic en **Run Analysis**
3. La IA procesa su portafolio de proveedores en lotes, categorizando cada proveedor con razonamiento
4. Los resultados muestran un desglose por categorías y una tabla detallada de proveedores

Cada entrada de proveedor incluye la categoría, subcategoría, número de aplicaciones asociadas, coste anual total y el razonamiento de la IA para la categorización. Alterne entre las vistas de cuadrícula y tabla usando el selector de vista.

## Resolución de Proveedores

La resolución de proveedores construye una jerarquía canónica de proveedores resolviendo alias e identificando relaciones padre-hijo.

![Resolución de Proveedores](../assets/img/es/50_archlens_resolucion.png)

**Cómo usar:**

1. Navegue a **ArchLens > Resolution**
2. Haga clic en **Resolve Vendors**
3. La IA identifica alias de proveedores (p. ej., «MSFT» = «Microsoft»), empresas matrices y agrupaciones de productos
4. Los resultados muestran la jerarquía resuelta con puntuaciones de confianza

La jerarquía organiza los proveedores en cuatro niveles: proveedor, producto, plataforma y módulo. Cada entrada muestra el número de aplicaciones y componentes de TI vinculados, el coste total y un porcentaje de confianza.

## Detección de Duplicados

La detección de duplicados identifica solapamientos funcionales en su portafolio — tarjetas que sirven el mismo propósito empresarial o uno similar.

![Detección de Duplicados](../assets/img/es/51_archlens_duplicados.png)

**Cómo usar:**

1. Navegue a **ArchLens > Duplicates**
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

1. Navegue a **ArchLens > Duplicates** (pestaña Modernization)
2. Seleccione un tipo de tarjeta de destino (Application, IT Component o Interface)
3. Haga clic en **Assess Modernization**
4. Los resultados muestran cada tarjeta con el tipo de modernización, recomendación, nivel de esfuerzo (bajo/medio/alto) y prioridad (baja/media/alta/crítica)

Los resultados se agrupan por prioridad para que pueda centrarse primero en las oportunidades de modernización de mayor impacto.

## IA de Arquitectura

La IA de Arquitectura es un asistente guiado de 5 pasos que genera recomendaciones de arquitectura basadas en su paisaje existente. Vincula sus objetivos empresariales y capacidades con propuestas de soluciones concretas, análisis de brechas, mapeo de dependencias y un diagrama de arquitectura objetivo.

![IA de Arquitectura](../assets/img/es/52_archlens_arquitecto.png)

Un indicador de progreso en la parte superior rastrea su avance a través de las cinco etapas: Requirements, Business Fit, Technical Fit, Solution y Target Architecture. Su progreso se guarda automáticamente en la sesión del navegador, por lo que puede navegar a otro lugar y regresar sin perder su trabajo. Haga clic en **New Assessment** para comenzar un análisis nuevo en cualquier momento.

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

Haga clic en **Select** en la opción que desea seguir.

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

## Historial de Análisis

Todas las ejecuciones de análisis se rastrean en **ArchLens > History**, mostrando:

![Historial de Análisis](../assets/img/es/53_archlens_historial.png)

- Tipo de análisis (análisis de proveedores, resolución de proveedores, detección de duplicados, modernización, arquitecto)
- Estado (en ejecución, completado, fallido)
- Marcas de tiempo de inicio y finalización
- Mensajes de error (si los hubiera)

## Permisos

| Permiso | Descripción |
|---------|-------------|
| `archlens.view` | Ver resultados de análisis (otorgado a admin, bpm_admin, member) |
| `archlens.manage` | Activar análisis (otorgado a admin) |
