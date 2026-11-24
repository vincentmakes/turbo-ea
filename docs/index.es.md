# Introducción a Turbo EA

### ¿Qué es Turbo EA?

**Turbo EA** es una plataforma moderna y autoalojada para la **Gestión de Arquitectura Empresarial**. Permite a las organizaciones documentar, visualizar y gestionar todos los componentes de su arquitectura de negocio y tecnología en un solo lugar.

### ¿Para quién es esta guía?

Esta guía es para **todos los usuarios de Turbo EA** — arquitectos empresariales, gestores de TI, analistas de negocio, desarrolladores y administradores. Ya sea que esté evaluando la plataforma, gestionando el paisaje de TI de su organización en el día a día, o configurando el sistema como administrador, aquí encontrará la información que necesita. No se requiere conocimiento técnico avanzado para empezar.

### Beneficios Principales

- **Visibilidad completa**: Visualice todas las aplicaciones, procesos, capacidades y tecnologías de la organización en una sola plataforma.
- **Toma de decisiones informada**: Informes visuales (portafolio, mapas de capacidades, dependencias, ciclo de vida, costos y más) que facilitan la evaluación del estado actual de la infraestructura tecnológica.
- **Gestión del ciclo de vida**: Seguimiento del estado de cada componente tecnológico a través de cinco fases — desde la planificación hasta el retiro.
- **Colaboración**: Múltiples usuarios pueden trabajar simultáneamente, con roles configurables, asignaciones de partes interesadas, comentarios, tareas y notificaciones.
- **Descripciones con IA**: Genere descripciones de fichas con un solo clic. Turbo EA combina búsqueda web con un LLM local o comercial para producir resúmenes adaptados al tipo de ficha — con puntuación de confianza y enlaces a las fuentes. Funciona completamente en su infraestructura para máxima privacidad, o conéctese a proveedores comerciales (OpenAI, Google Gemini, Anthropic Claude y más). Totalmente configurable por el administrador: elija qué tipos de fichas reciben sugerencias de IA, seleccione su proveedor de búsqueda y escoja el modelo.
- **Diagramas visuales**: Cree diagramas de arquitectura con el editor DrawIO integrado, totalmente sincronizado con su inventario de fichas.
- **Modelado de procesos de negocio**: Editor de flujos de procesos BPMN 2.0 con vinculación de elementos, flujos de aprobación y evaluaciones de madurez.
- **Integración con ServiceNow**: Sincronización bidireccional con ServiceNow CMDB para mantener su paisaje de EA conectado con datos de operaciones de TI.
- **Multi-idioma**: Disponible en español, inglés, francés, alemán, italiano, portugués y chino.

### Conceptos Clave

| Término | Significado |
|---------|-------------|
| **Ficha (Card)** | El elemento básico de la plataforma. Representa cualquier componente de la arquitectura: una aplicación, un proceso, una capacidad de negocio, etc. |
| **Tipo de Ficha** | La categoría a la que pertenece una ficha (Aplicación, Proceso de Negocio, Organización, etc.) |
| **Relación** | Una conexión entre dos fichas que describe cómo se relacionan (ej: «utiliza», «depende de», «es parte de») |
| **Metamodelo** | La estructura que define qué tipos de fichas existen, qué campos tienen y cómo se relacionan entre sí. Totalmente configurable por el administrador |
| **Ciclo de Vida** | Las fases temporales de un componente: Plan, Fase de Entrada, Activo, Fase de Salida, Fin de Vida |
| **Inventario** | Lista buscable y filtrable de todas las cards de cualquier tipo. Edición en lote, importación-exportación Excel/CSV y vistas guardadas con compartición |
| **Informes** | Visualizaciones predefinidas: Portafolio, Mapa de Capacidades, Ciclo de Vida, Dependencias, Coste, Matriz, Calidad de Datos y Fin de Vida |
| **BPM** | Gestión de Procesos de Negocio — modele procesos con un editor BPMN 2.0, vincule elementos del diagrama a cards y evalúe madurez, riesgo y automatización |
| **PML** | Project Portfolio Management — gestione cards de Iniciativa como proyectos completos con informes de estado, Work Breakdown Structures, tableros kanban y Gantt, presupuestos, costes y un registro de riesgos por iniciativa |
| **TurboLens** | Inteligencia EA potenciada por IA — análisis de proveedores, detección de duplicados, evaluación de modernización, el asistente Architecture AI de 5 pasos y escaneos de Cumplimiento (EU AI Act / GDPR / NIS2 / DORA / SOC 2 / ISO 27001) |
| **EA Delivery** | La superficie de entrega alineada con TOGAF — Statements of Architecture Work, Architecture Decision Records y el Registro de Riesgos a nivel de paisaje |
| **SoAW** | Statement of Architecture Work — documento formal TOGAF que delimita el alcance de una iniciativa de arquitectura |
| **ADR** | Architecture Decision Record — captura el contexto, las alternativas y las consecuencias de una decisión, con flujo de estado y vinculación a cards |
| **Registro de Riesgos** | Registro de riesgos a nivel de paisaje (TOGAF Fase G), separado de los riesgos a nivel de iniciativa de PML. La asignación de propietario crea automáticamente un Todo |
| **Portal Web** | Vista pública, basada en slug y de solo lectura de parte del paisaje EA — compartible sin inicio de sesión |
| **Servidor MCP** | Acceso de IA en solo lectura mediante el Model Context Protocol — consulte datos EA desde Claude Desktop, Cursor, GitHub Copilot y otros clientes MCP |
| **RBAC** | Control de Acceso Basado en Roles — roles a nivel de aplicación más roles de stakeholder por card, con más de 50 permisos granulares |
