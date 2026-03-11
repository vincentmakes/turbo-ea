# Glosario de Términos

| Término | Definición |
|---------|------------|
| **ADR (Architecture Decision Record)** | Un documento formal que registra una decisión de arquitectura importante, incluyendo el contexto, la justificación, las consecuencias y las alternativas consideradas. Los ADR admiten un flujo de firma y una cadena de revisiones |
| **Estado de Aprobación** | El estado de revisión de una ficha: Borrador, Aprobado, Roto o Rechazado. Las fichas aprobadas cambian a Roto cuando se editan |
| **Marcador / Vista Guardada** | Una configuración guardada de filtros, columnas y ordenamiento en el Inventario que se puede recargar con un clic |
| **BPM** | Gestión de Procesos de Negocio — la disciplina de modelar, analizar y mejorar procesos de negocio |
| **BPMN** | Notación de Modelado de Procesos de Negocio — la notación estándar para modelar procesos de negocio (versión 2.0) |
| **Capacidad de Negocio** | Lo que una organización puede hacer, independientemente de cómo lo hace |
| **Cálculo** | Una fórmula definida por el administrador que calcula automáticamente el valor de un campo cuando se guarda una ficha |
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
| **Etiqueta / Grupo de Etiquetas** | Una etiqueta de clasificación organizada en grupos con modos de selección única o múltiple |
| **TOGAF** | The Open Group Architecture Framework — una metodología de EA ampliamente utilizada. La función SoAW de Turbo EA se alinea con TOGAF |
| **Informe de estado** | Un informe PPM mensual que rastrea la salud del proyecto mediante indicadores RAG para cronograma, costo y alcance |
| **Portal Web** | Una vista pública de solo lectura de fichas seleccionadas accesible sin autenticación a través de una URL única |
| **Estructura de Desglose del Trabajo (WBS)** | Una descomposición jerárquica del alcance del proyecto en paquetes de trabajo |
| **Paquete de trabajo** | Una agrupación lógica de tareas dentro de un cronograma Gantt que tiene sus propias fechas de inicio/fin y porcentaje de finalización |
| **Sugerencia IA** | Una descripción de ficha generada automáticamente combinando resultados de búsqueda web con un Modelo de Lenguaje Grande (LLM) |
