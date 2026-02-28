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

Una vez que un SoAW es aprobado, puede solicitar firmas de las partes interesadas. El sistema rastrea quién ha firmado y envía notificaciones a los firmantes pendientes.

### Vista Previa y Exportación

- **Modo de vista previa** — Vista de solo lectura del documento SoAW completo
- **Exportación DOCX** — Descargue el SoAW como un documento Word formateado para compartir o imprimir sin conexión
