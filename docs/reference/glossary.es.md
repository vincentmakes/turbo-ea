# Glosario de Términos

| Término | Definición |
|---------|------------|
| **ADR (Architecture Decision Record)** | Un documento formal que registra una decisión de arquitectura importante, incluyendo el contexto, la justificación, las consecuencias y las alternativas consideradas. Los ADR admiten un flujo de firma y una cadena de revisiones |
| **Año Fiscal** | El período de 12 meses utilizado para la presupuestación y los informes financieros. Configurable en Administrador > Configuración — el mes de inicio (enero a diciembre) determina cómo se agrupan las líneas de presupuesto PPM |
| **Estado de Aprobación** | El estado de revisión de una ficha: Borrador, Aprobado, Roto o Rechazado. Las fichas aprobadas cambian a Roto cuando se editan |
| **Marcador / Vista Guardada** | Una configuración guardada de filtros, columnas y ordenamiento en el Inventario que se puede recargar con un clic |
| **BPM** | Gestión de Procesos de Negocio — la disciplina de modelar, analizar y mejorar procesos de negocio |
| **BPMN** | Notación de Modelado de Procesos de Negocio — la notación estándar para modelar procesos de negocio (versión 2.0) |
| **Capacidad de Negocio** | Lo que una organización puede hacer, independientemente de cómo lo hace |
| **Cálculo** | Una fórmula definida por el administrador que calcula automáticamente el valor de un campo cuando se guarda una ficha |
| **Feed OData** | Un feed de datos JSON disponible en las vistas guardadas del inventario (marcadores) para el consumo por herramientas externas como Power BI o Excel |
| **Ficha (Card)** | La unidad básica de información en Turbo EA que representa cualquier componente de arquitectura |
| **Tipo de Ficha** | La categoría a la que pertenece una ficha (ej., Aplicación, Proceso de Negocio, Organización) |
| **Puntuación de Confianza** | Una calificación de 0–100% que indica la fiabilidad de una descripción generada por IA |
| **Línea de costo** | Una entrada de presupuesto o costo real (CapEx/OpEx) en una iniciativa PPM, utilizada para rastrear el gasto financiero |
| **Calidad de Datos** | Una puntuación de completitud de 0–100% basada en campos completados y sus pesos configurados |
| **Archivo adjunto** | Un archivo binario (PDF, DOCX, XLSX, imágenes, hasta 10 MB) cargado directamente a una ficha mediante la pestaña Recursos |
| **Diagrama** | Un diagrama visual de arquitectura creado con el editor DrawIO integrado |
| **DrawIO** | La herramienta de diagramación de código abierto integrada utilizada para diagramas visuales de arquitectura |
| **Arquitectura Empresarial (EA)** | La disciplina que organiza y documenta la estructura de negocio y tecnología de una organización |
| **EOL (Fin de Vida)** | La fecha en que un producto tecnológico pierde soporte del proveedor. Rastreado mediante integración con endoflife.date |
| **Diagrama de Gantt** | Una línea de tiempo visual con barras horizontales que muestra el cronograma, duración y progreso del proyecto |
| **Iniciativa** | Un proyecto o programa que implica cambios en la arquitectura |
| **Ciclo de Vida** | Las cinco fases por las que pasa un componente: Plan, Fase de Entrada, Activo, Fase de Salida, Fin de Vida |
| **LLM** | Modelo de Lenguaje Grande — un modelo de IA que genera texto (ej., Ollama, OpenAI, Anthropic Claude, Google Gemini) |
| **MCP** | Model Context Protocol — un estándar abierto que permite a herramientas de IA (Claude, Copilot, Cursor) conectarse a fuentes de datos externas. El servidor MCP integrado de Turbo EA proporciona acceso de solo lectura a los datos de EA con RBAC por usuario |
| **Metamodelo** | El modelo basado en datos que define la estructura de la plataforma: tipos de fichas, campos, relaciones y roles |
| **Hito** | Un evento significativo o punto de finalización en el cronograma de un proyecto, mostrado como un indicador de diamante en el diagrama de Gantt |
| **Notificación** | Una alerta en la aplicación o por correo electrónico activada por eventos del sistema (tarea asignada, ficha actualizada, comentario agregado, etc.) |
| **Ollama** | Una herramienta de código abierto para ejecutar LLMs localmente en su propio hardware |
| **Orden de Filas BPM** | El orden de visualización de las filas de tipos de proceso (Básico, Soporte, Gestión) en el navegador de procesos BPM, configurable arrastrando filas |
| **Portafolio** | Un conjunto de aplicaciones o tecnologías gestionadas como un grupo |
| **PPM** | Gestión de Cartera de Proyectos — la disciplina de gestionar un portafolio de proyectos e iniciativas con presupuestos, riesgos, tareas e informes de estado |
| **Número de referencia** | Un identificador secuencial generado automáticamente para los ADR (ej., ADR-001, ADR-002) que proporciona una etiqueta única y legible |
| **Relación** | Una conexión entre dos fichas que describe cómo se relacionan (ej., «utiliza», «depende de», «se ejecuta en») |
| **Pestaña Recursos** | Una pestaña en el detalle de ficha que consolida Decisiones de Arquitectura, archivos adjuntos y enlaces a documentos en un solo lugar |
| **Revisión (ADR)** | Una nueva versión de un ADR firmado que hereda el contenido y los vínculos de fichas de la versión anterior, con un número de revisión incrementado |
| **Estado RAG** | Indicador de salud Rojo-Ámbar-Verde utilizado en informes de estado PPM para cronograma, costo y alcance |
| **Puntuación de riesgo** | Un valor calculado automáticamente (probabilidad x impacto) que cuantifica la gravedad de un riesgo del proyecto |
| **Informe Guardado** | Una configuración de informe persistida con filtros, ejes y ajustes de visualización que se puede recargar |
| **Sección** | Un área agrupable de la página de detalle de ficha que contiene campos relacionados, configurable por tipo de ficha |
| **Signatario** | Un usuario designado para revisar y firmar un documento ADR o SoAW. El flujo de firma rastrea las firmas pendientes y completadas |
| **SoAW** | Declaración de Trabajo de Arquitectura — un documento formal TOGAF que define el alcance y entregables de una iniciativa |
| **SSO** | Inicio de Sesión Único — acceso con credenciales corporativas a través de un proveedor de identidad (Microsoft, Google, Okta, OIDC) |
| **Subtipo** | Una clasificación secundaria dentro de un tipo de ficha (ej., Aplicación tiene subtipos: Aplicación de Negocio, Microservicio, Agente IA, Despliegue). Cada subtipo actúa como una subplantilla que puede controlar la visibilidad de campos |
| **Plantilla de Subtipo** | La configuración de qué campos son visibles u ocultos para un subtipo específico. Los administradores configuran esto en la administración del metamodelo haciendo clic en un chip de subtipo |
| **Parte Interesada (Stakeholder)** | Una persona con un rol específico en una ficha (ej., Propietario de Aplicación, Propietario Técnico) |
| **Encuesta** | Un cuestionario de mantenimiento de datos dirigido a tipos específicos de fichas para recopilar información de las partes interesadas |
| **Etiqueta / Grupo de Etiquetas** | Una etiqueta de clasificación organizada en grupos con modos de selección única o múltiple, restricciones de tipo opcionales y un indicador opcional de obligatoriedad que bloquea la aprobación y alimenta el puntaje de calidad de datos |
| **Grupo de Etiquetas Obligatorio** | Un grupo de etiquetas marcado como requerido. Las fichas aplicables no pueden aprobarse hasta que se adjunte al menos una etiqueta del grupo; su cumplimiento contribuye al puntaje de calidad de datos de la ficha |
| **Detección semántica de la Ley de IA de la UE** | Pasada de cumplimiento de TurboLens que pide al LLM marcar fichas que incrustan capacidades de IA / ML (LLM, motores de recomendación, visión por computador, scoring, chatbots, …) aunque no estén explícitamente clasificadas como `AI Agent` / `AI Model`. Estos hallazgos quedan marcados como **Detectado por IA** |
| **Riesgo Inicial vs. Residual** | Dos evaluaciones capturadas en cada riesgo del Registro de Riesgos. `Inicial` es probabilidad × impacto sin mitigar; `Residual` es probabilidad × impacto tras la mitigación, editable una vez exista un plan de mitigación. Ambas derivan un nivel vía la matriz 4×4 |
| **Referencia de Riesgo** | Un identificador monótono y legible (`R-000123`) asignado al crear el riesgo. Permanece visible en los botones de hallazgos promovidos (**Abrir riesgo R-000123**) y en la descripción del Todo vinculado del propietario |
| **TOGAF** | The Open Group Architecture Framework — una metodología de EA ampliamente utilizada. La función SoAW de Turbo EA se alinea con TOGAF |
| **Informe de estado** | Un informe PPM mensual que rastrea la salud del proyecto mediante indicadores RAG para cronograma, costo y alcance |
| **Portal Web** | Una vista pública de solo lectura de fichas seleccionadas accesible sin autenticación a través de una URL única |
| **Estructura de Desglose del Trabajo (WBS)** | Una descomposición jerárquica del alcance del proyecto en paquetes de trabajo |
| **Paquete de trabajo** | Una agrupación lógica de tareas dentro de un cronograma Gantt que tiene sus propias fechas de inicio/fin y porcentaje de finalización |
| **Sugerencia IA** | Una descripción de ficha generada automáticamente combinando resultados de búsqueda web con un Modelo de Lenguaje Grande (LLM) |
| **Veredicto IA** | Confirmación o rechazo por parte del usuario de la clasificación de IA del LLM sobre una ficha (`hasAiFeatures = true / false`). Persiste entre rescaneos para que la deriva del LLM no altere silenciosamente el alcance del Reglamento de IA de la UE |
| **GRC** | Gobernanza, Riesgo y Cumplimiento — el espacio de trabajo unificado en `/grc` con tres pestañas (Gobernanza, Riesgo, Cumplimiento) que consolida los Principios EA, ADR, el Registro de Riesgos y el escáner de Seguridad y Cumplimiento |
| **Fase G** | Fase ADM «Implementation Governance» de TOGAF. Fuente del vocabulario y ciclo de vida del Registro de Riesgos |
| **Registro de Riesgos** | Registro a nivel de paisaje de los riesgos de arquitectura alineado con TOGAF Fase G. Vive en `/grc?tab=risk`. Distinto de los riesgos a nivel de iniciativa capturados en PPM |
| **Propietario del Riesgo** | El usuario responsable de un riesgo. La asignación crea automáticamente una tarea del sistema en la página de Tareas del propietario y dispara una notificación `risk_assigned` |
| **Tarea de Mitigación** | Elemento de trabajo con dueño asociado a un Riesgo que captura la actividad concreta de mitigación. Puede ser one-shot o recurrente (diaria / semanal / mensual / anual). Las tareas recurrentes avanzan calendárialmente correctamente al cierre |
| **Ciclo de Tarea de Mitigación** | Una instancia programada de una Tarea de Mitigación. Pasa por `scheduled` → `open` → `done` / `skipped`. Captura una instantánea del destinatario al abrirse y del propietario al cerrarse, para que las respuestas de auditoría sobrevivan a la rotación de propietarios |
| **Tiempo de antelación (Tarea de Mitigación)** | Días antes de `due_date` en que un ciclo programado se promueve a `open` y aterriza en los Todos del destinatario. Valores por defecto inteligentes por unidad (1 / 2 / 7 / 14 para diaria / semanal / mensual / anual), limitados a la mitad de la duración del ciclo |
| **Hallazgo de Cumplimiento** | Una fila del registro de Cumplimiento contra una regulación × artículo. Redactado manualmente por un revisor o producido por un escaneo IA TurboLens; ambos tipos comparten el mismo ciclo de vida y pueden promoverse a un Riesgo |
| **Capacidad Macro** | Agrupación de Nivel 0 por encima de L1 en el Catálogo de Capacidades. Aterriza como una tarjeta `BusinessCapability` con `attributes.capabilityLevel = "Macro"` y un `catalogueId` prefijado `MC-`. Relaja el límite de profundidad de jerarquía a 6 |
| **Vista de Dependencias en Capas (LDV)** | Notación de la casa de Turbo EA para diagramas de dependencias: tarjetas agrupadas en las cuatro capas EA como carriles de nado, coloreadas por tipo de tarjeta, con las tarjetas propuestas renderizadas como nodos con borde discontinuo y una insignia verde «NEW». Usada por el informe de Dependencias, la sección de dependencias del detalle de tarjeta y la arquitectura objetivo de TurboLens Architect |
| **TIME (Tolerate / Invest / Migrate / Eliminate)** | Un marco de clasificación de cartera en cuatro disposiciones para aplicaciones, popularizado por Gartner. A cada aplicación se le asigna una disposición — Tolerate (mantener), Invest (financiar mejoras), Migrate (sustituir o rehospedar) o Eliminate (retirar). En Turbo EA se añade habitualmente como campo `single_select` en el tipo Aplicación y se usa como eje de color del Informe de Cartera |
| **Racionalización del portafolio de aplicaciones** | La iniciativa EA inicial más común sobre Turbo EA: inventariar las aplicaciones del alcance, clasificarlas por valor de negocio y adecuación técnica y asignar una disposición TIME que impulse las decisiones de consolidación, sustitución o retirada |
| **Crawl-Walk-Run** | El patrón de despliegue por fases recomendado en la Guía para principiantes EA. Crawl = alcance reducido, solo Aplicaciones, cinco campos por ficha. Walk = añadir el mapeo de capacidades y un primer análisis de cartera. Run = ampliar a procesos, interfaces, datos y a los módulos avanzados |
