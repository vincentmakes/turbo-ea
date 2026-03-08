# Entrega EA

El módulo de **Entrega EA** gestiona las **iniciativas de arquitectura y sus artefactos** — diagramas y Declaraciones de Trabajo de Arquitectura (SoAW). Proporciona una vista única de todos los proyectos de arquitectura en curso y sus entregables.

![Gestión de Entrega EA](../assets/img/es/17_entrega_ea.png)

## Resumen de Iniciativas

La página se organiza en torno a fichas de **Iniciativa**. Cada iniciativa muestra:

| Campo | Descripción |
|-------|-------------|
| **Nombre** | Nombre de la iniciativa |
| **Subtipo** | Idea, Programa, Proyecto o Épica |
| **Estado** | En Curso, En Riesgo, Fuera de Curso, En Espera o Completado |
| **Artefactos** | Cantidad de diagramas y documentos SoAW vinculados |

Puede alternar entre una vista de **galería de tarjetas** y una vista de **lista**, y filtrar iniciativas por estado (Activas o Archivadas).

Al hacer clic en una iniciativa se expande para mostrar todos sus **diagramas** y **documentos SoAW** vinculados.

## Declaración de Trabajo de Arquitectura (SoAW)

Una **Declaración de Trabajo de Arquitectura (SoAW)** es un documento formal definido por el [estándar TOGAF](https://pubs.opengroup.org/togaf-standard/) (The Open Group Architecture Framework). Establece el alcance, enfoque, entregables y gobernanza para un compromiso de arquitectura. En TOGAF, el SoAW se produce durante la **Fase Preliminar** y la **Fase A (Visión de Arquitectura)** y sirve como acuerdo entre el equipo de arquitectura y sus partes interesadas.

Turbo EA proporciona un editor SoAW integrado con plantillas de secciones alineadas con TOGAF, edición de texto enriquecido y capacidades de exportación — para que pueda crear y gestionar documentos SoAW directamente junto con sus datos de arquitectura.

### Crear un SoAW

1. Haga clic en **+ Nuevo SoAW** desde dentro de una iniciativa
2. Ingrese el título del documento
3. El editor se abre con **plantillas de secciones predefinidas** basadas en el estándar TOGAF

### El Editor de SoAW

El editor proporciona:

- **Edición de texto enriquecido** — Barra de herramientas completa de formato (encabezados, negrita, cursiva, listas, enlaces) impulsada por el editor TipTap
- **Plantillas de secciones** — Secciones predefinidas siguiendo estándares TOGAF (ej., Descripción del Problema, Objetivos, Enfoque, Partes Interesadas, Restricciones, Plan de Trabajo)
- **Tablas editables en línea** — Agregue y edite tablas dentro de cualquier sección
- **Flujo de estados** — Los documentos progresan a través de etapas definidas:

| Estado | Significado |
|--------|-------------|
| **Borrador** | En redacción, aún no listo para revisión |
| **En Revisión** | Enviado para revisión de partes interesadas |
| **Aprobado** | Revisado y aceptado |
| **Firmado** | Firmado formalmente |

### Flujo de Firma

Una vez que un SoAW es aprobado, puede solicitar firmas de las partes interesadas. Haga clic en **Solicitar Firmas** y use el campo de búsqueda para encontrar y agregar firmantes por nombre o correo electrónico. El sistema rastrea quién ha firmado y envía notificaciones a los firmantes pendientes.

### Vista Previa y Exportación

- **Modo de vista previa** — Vista de solo lectura del documento SoAW completo
- **Exportación DOCX** — Descargue el SoAW como un documento Word formateado para compartir o imprimir sin conexión

## Registros de Decisiones de Arquitectura (ADR)

Un **Registro de Decisión de Arquitectura (ADR)** documenta decisiones de arquitectura importantes junto con su contexto, consecuencias y alternativas consideradas. Los ADR proporcionan un historial trazable de por qué se tomaron decisiones de diseño clave.

### Resumen de ADR

La página de Entrega EA tiene una pestaña dedicada de **Decisiones** que lista todos los ADR. Cada ADR muestra:

- Número de referencia (generado automáticamente: ADR-001, ADR-002, etc.)
- Título
- Estado (Borrador, En Revisión, Firmado)
- Iniciativas vinculadas (a través de la vinculación de tarjetas)
- Firmantes y su estado

Puede filtrar por estado y buscar por título o número de referencia.

### Crear un ADR

Los ADR se pueden crear desde tres lugares:

1. **Entrega EA → pestaña Decisiones**: Haga clic en **+ Nuevo ADR**, complete el título y opcionalmente vincule tarjetas (incluidas iniciativas).
2. **Botón «+» de iniciativa** (pestaña Iniciativas): Elija **Nueva Decisión de Arquitectura** del menú — la iniciativa se vincula automáticamente como enlace de tarjeta.
3. **Pestaña Recursos de la tarjeta**: Haga clic en **Crear ADR** — la tarjeta actual se vincula automáticamente.

En todos los casos, puede buscar y vincular tarjetas adicionales durante la creación. Las iniciativas se vinculan a través del mismo mecanismo de vinculación de tarjetas que cualquier otra tarjeta, lo que significa que un ADR puede vincularse a múltiples iniciativas. El editor se abre con secciones para Contexto, Decisión, Consecuencias y Alternativas Consideradas.

### El Editor de ADR

El editor proporciona:

- Edición de texto enriquecido para cada sección (Contexto, Decisión, Consecuencias, Alternativas Consideradas)
- Vinculación de tarjetas — conecte el ADR a tarjetas relevantes (aplicaciones, componentes TI, iniciativas, etc.). Las iniciativas se vinculan a través de la funcionalidad estándar de vinculación de tarjetas, no mediante un campo dedicado, por lo que un ADR puede referenciar múltiples iniciativas
- Decisiones relacionadas — referencie otros ADR

### Flujo de Firma

Los ADR soportan un proceso formal de firma:

1. Cree el ADR en estado **Borrador**
2. Haga clic en **Solicitar Firmas** y busque firmantes por nombre o correo electrónico
3. El ADR pasa a **En Revisión** — cada firmante recibe una notificación y una tarea
4. Los firmantes revisan y hacen clic en **Firmar**
5. Cuando todos los firmantes han firmado, el ADR pasa automáticamente al estado **Firmado**

Los ADR firmados están bloqueados y no pueden editarse. Para hacer cambios, cree una **nueva revisión**.

### Revisiones

Los ADR firmados pueden revisarse:

1. Abra un ADR firmado
2. Haga clic en **Revisar** para crear un nuevo borrador basado en la versión firmada
3. La nueva revisión hereda el contenido y los vínculos de tarjetas
4. Cada revisión tiene un número de revisión incremental

### Vista Previa de ADR

Haga clic en el icono de vista previa para ver una versión de solo lectura y formateada del ADR — útil para revisar antes de firmar.

## Pestaña de Recursos

Las tarjetas ahora incluyen una pestaña de **Recursos** que consolida:

- **Decisiones de Arquitectura** — ADR vinculados a esta tarjeta. Puede vincular ADR existentes o crear uno nuevo directamente desde la pestaña de Recursos — el nuevo ADR se vincula automáticamente a la tarjeta.
- **Archivos Adjuntos** — Cargue y gestione archivos (PDF, DOCX, XLSX, imágenes, hasta 10 MB)
- **Enlaces de Documentos** — Referencias de documentos basadas en URL
