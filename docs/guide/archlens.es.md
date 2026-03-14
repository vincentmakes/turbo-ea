# ArchLens Inteligencia Artificial

El módulo **ArchLens** proporciona análisis impulsados por IA de su paisaje de arquitectura empresarial. Utiliza su proveedor de IA configurado para realizar análisis de proveedores, detección de duplicados, evaluación de modernización y recomendaciones de arquitectura.

!!! note
    ArchLens requiere un proveedor de IA comercial (Anthropic Claude, OpenAI, DeepSeek o Google Gemini) configurado en [Configuración de IA](../admin/ai.md). El módulo está disponible automáticamente cuando la IA está configurada.

!!! info "Credits"
    ArchLens se basa en el proyecto de código abierto [ArchLens](https://github.com/vinod-ea/archlens) de [Vinod](https://github.com/vinod-ea), publicado bajo la licencia MIT. La lógica de análisis ha sido portada de Node.js a Python e integrada nativamente en Turbo EA.

## Panel de control

El panel de control de ArchLens proporciona una visión general de su análisis de paisaje:

| Indicador | Descripción |
|-----------|-------------|
| **Total de tarjetas** | Número de tarjetas activas en su portafolio |
| **Calidad promedio** | Puntuación promedio de calidad de datos en todas las tarjetas |
| **Proveedores** | Número de proveedores de tecnología analizados |
| **Clústeres de duplicados** | Número de grupos de duplicados identificados |
| **Modernizaciones** | Número de oportunidades de modernización encontradas |

El panel de control también muestra tarjetas agrupadas por tipo y destaca los principales problemas de calidad.

## Análisis de proveedores

El análisis de proveedores utiliza IA para categorizar sus proveedores de tecnología en más de 45 categorías industriales (por ejemplo, CRM, ERP, infraestructura en la nube, seguridad).

**Cómo usarlo:**

1. Navegue a **ArchLens > Proveedores**
2. Haga clic en **Ejecutar análisis**
3. La IA procesa su portafolio de proveedores en lotes, categorizando cada proveedor con razonamiento
4. Los resultados muestran un desglose por categorías y una tabla detallada de proveedores

Cada entrada de proveedor incluye la categoría, subcategoría, número de aplicaciones asociadas, costo anual total y el razonamiento de la IA para la categorización.

## Resolución de proveedores

La resolución de proveedores construye una jerarquía canónica de proveedores resolviendo alias e identificando relaciones padre-hijo.

**Cómo usarlo:**

1. Navegue a **ArchLens > Resolución**
2. Haga clic en **Resolver proveedores**
3. La IA identifica alias de proveedores (por ejemplo, «MSFT» = «Microsoft»), empresas matrices y agrupaciones de productos
4. Los resultados muestran la jerarquía resuelta con puntuaciones de confianza

## Detección de duplicados

La detección de duplicados identifica solapamientos funcionales en su portafolio — tarjetas que cumplen el mismo o similar propósito de negocio.

**Cómo usarlo:**

1. Navegue a **ArchLens > Duplicados**
2. Haga clic en **Detectar duplicados**
3. La IA analiza tarjetas de Application, IT Component e Interface en lotes
4. Los resultados muestran clústeres de posibles duplicados con evidencias y recomendaciones

Para cada clúster, puede:

- **Confirmar** — Marcar el duplicado como confirmado para seguimiento
- **Investigar** — Marcar para investigación adicional
- **Descartar** — Descartar si no es un duplicado real

## Evaluación de modernización

La evaluación de modernización evalúa tarjetas para oportunidades de actualización basándose en las tendencias tecnológicas actuales.

**Cómo usarlo:**

1. Navegue a **ArchLens > Duplicados** (sección Modernización)
2. Seleccione un tipo de tarjeta objetivo (Application, IT Component o Interface)
3. Haga clic en **Evaluar modernización**
4. Los resultados muestran cada tarjeta con tipo de modernización, recomendación, nivel de esfuerzo y prioridad

## Architecture AI

La Architecture AI es un asistente conversacional de 3 fases que genera recomendaciones de arquitectura basándose en su paisaje existente.

**Cómo usarlo:**

1. Navegue a **ArchLens > Arquitecto**
2. **Fase 1** — Describa su requisito de negocio (por ejemplo, «Necesitamos un portal de autoservicio para clientes»). La IA genera preguntas de clarificación de negocio.
3. **Fase 2** — Responda las preguntas de la Fase 1. La IA genera preguntas técnicas de profundización.
4. **Fase 3** — Responda las preguntas de la Fase 2. La IA genera una recomendación de arquitectura completa que incluye:

| Sección | Descripción |
|---------|-------------|
| **Diagrama de arquitectura** | Diagrama Mermaid interactivo con zoom, descarga SVG y copia de código |
| **Capas de componentes** | Organizadas por capa de arquitectura con clasificación existente/nuevo/recomendado |
| **Brechas y recomendaciones** | Brechas de capacidad con recomendaciones de productos del mercado clasificadas por ajuste |
| **Integraciones** | Mapa de integración que muestra flujos de datos, protocolos y direcciones |
| **Riesgos y próximos pasos** | Evaluación de riesgos con mitigaciones y pasos de implementación priorizados |

## Historial de análisis

Todas las ejecuciones de análisis se registran en **ArchLens > Historial**, mostrando:

- Tipo de análisis (análisis de proveedores, resolución de proveedores, detección de duplicados, modernización, arquitecto)
- Estado (en ejecución, completado, fallido)
- Marcas de tiempo de inicio y finalización
- Mensajes de error (si los hay)

## Permisos

| Permiso | Descripción |
|---------|-------------|
| `archlens.view` | Ver resultados de análisis (otorgado a admin, bpm_admin, member) |
| `archlens.manage` | Ejecutar análisis (otorgado a admin) |
