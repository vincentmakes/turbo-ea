# Entrega EA

El módulo de **Entrega EA** gestiona las **iniciativas de arquitectura y sus artefactos** — diagramas, Declaraciones de Trabajo de Arquitectura (SoAW) y Registros de Decisiones de Arquitectura (ADR). Proporciona una vista única de todos los proyectos de arquitectura en curso y sus entregables.

Cuando PPM está habilitado — la configuración habitual — Entrega EA vive **dentro del módulo PPM**: abra **PPM** en la navegación superior y cambie a la pestaña **EA Delivery** (`/ppm?tab=ea-delivery`). Cuando PPM está deshabilitado, **EA Delivery** aparece en el menú **IT Governance** con el nombre **EA Governance** (enlazando a `/reports/ea-delivery`); si GRC está desactivado, o su rol no puede abrir IT Governance, aparece en su lugar como un elemento de nivel superior **Entrega EA**. La URL legada `/ea-delivery` sigue funcionando como redirección en ambos casos, de modo que los marcadores existentes se resuelven.

![Gestión de Entrega EA](../assets/img/es/17_entrega_ea.png)

## Espacio de trabajo de Iniciativas

Entrega EA es un **espacio de trabajo en dos paneles** (sin pestañas internas):

- **Barra lateral izquierda** — un árbol indentado y filtrable de todas las iniciativas (con sus iniciativas hijas anidadas). Busque por nombre, filtre por Estado / Subtipo / Artefactos o marque sus favoritos.
- **Espacio de trabajo a la derecha** — los entregables, iniciativas hijas y detalles de la iniciativa que seleccione a la izquierda. Al elegir otra fila, el espacio de trabajo se redibuja.

La selección forma parte de la URL (`?initiative=<id>`), por lo que puede compartir un enlace directo a una iniciativa o recargar la página sin perder el contexto.

Un único botón principal **+ Nuevo artefacto ▾** en la parte superior de la página permite crear un nuevo SoAW, diagrama o ADR — automáticamente vinculado a la iniciativa seleccionada (o sin vincular si no hay selección). Los grupos de entregables vacíos en el espacio de trabajo también muestran un botón **+ Añadir …**, de modo que la creación siempre está a un clic.

Cada fila del árbol muestra:

| Elemento | Significado |
|----------|-------------|
| **Nombre** | Nombre de la iniciativa |
| **Chip de recuento** | Total de artefactos vinculados (SoAW + diagramas + ADRs) |
| **Punto de estado** | Punto coloreado para En Curso / En Riesgo / Fuera de Curso / En Espera / Completado |
| **Estrella** | Conmutador de favorito — los favoritos suben al principio |

La fila sintética **Artefactos no vinculados** en la parte superior del árbol aparece cuando hay SoAWs, diagramas o ADRs aún no vinculados a una iniciativa. Ábrala para volver a vincularlos.

### Quién ve qué

Entrega EA se abre para cualquier rol que tenga **Ver documentos SoAW** (`soaw.view`) o **Ver registros de decisiones de arquitectura** (`adr.view`). Cada tipo de artefacto sigue entonces su propio permiso:

| Artefacto | Se lista con | Se crea con |
|----------|-------------|--------------|
| **SoAW** | `soaw.view` | `soaw.manage` |
| **Diagrama** | `diagrams.view` | `diagrams.manage` (también necesario para vincular o desvincular un diagrama) |
| **ADR** | `adr.view` | `adr.manage` |

Un grupo que no puede ver queda fuera del espacio de trabajo, y **+ Nuevo artefacto** y **+ Añadir …** solo ofrecen los tipos que puede crear — un rol que solo puede leer no ve ninguno de los dos botones. Así, un rol con solo `adr.view` obtiene la página con las decisiones de cada iniciativa y nada sobre SoAW.

## Declaración de Trabajo de Arquitectura (SoAW)

Una **Declaración de Trabajo de Arquitectura (SoAW)** es un documento formal definido por el [estándar TOGAF](https://pubs.opengroup.org/togaf-standard/) (The Open Group Architecture Framework). Establece el alcance, enfoque, entregables y gobernanza para un compromiso de arquitectura. En TOGAF, el SoAW se produce durante la **Fase Preliminar** y la **Fase A (Visión de Arquitectura)** y sirve como acuerdo entre el equipo de arquitectura y sus partes interesadas.

Turbo EA proporciona un editor SoAW integrado con plantillas de secciones alineadas con TOGAF, edición de texto enriquecido y capacidades de exportación — para que pueda crear y gestionar documentos SoAW directamente junto con sus datos de arquitectura.

### Crear un SoAW

1. Seleccione la iniciativa a la izquierda (opcional — también puede crear un SoAW no vinculado).
2. Haga clic en **+ Nuevo artefacto ▾** en la parte superior de la página (o en el botón **+ Añadir** dentro de la sección *Entregables*) y elija **Nuevo Statement of Architecture Work**.
3. Ingrese el título del documento.
4. El editor se abre con **plantillas de secciones predefinidas** basadas en el estándar TOGAF.

### El Editor de SoAW

El editor proporciona:

- **Edición de texto enriquecido** — Barra de herramientas completa de formato (encabezados, negrita, cursiva, listas, enlaces) impulsada por el editor TipTap
- **Enlaces** — Una URL escrita o pegada se convierte en enlace mientras escribe, y todos los enlaces de un documento se abren en una pestaña nueva. Las direcciones de los documentos redactados antes de que se admitieran los enlaces se convierten en enlaces al mostrarse
- **Plantillas de secciones** — Secciones predefinidas siguiendo estándares TOGAF (ej., Descripción del Problema, Objetivos, Enfoque, Partes Interesadas, Restricciones, Plan de Trabajo)
- **Tablas editables en línea** — Agregue y edite tablas dentro de cualquier sección
- **Menciones** — escriba **@** en el texto de una sección para mencionar una ficha o una decisión (consulte [Discusión, menciones e historial](#soaw-collaboration))
- **Historial de Versiones del Documento** — una tabla que los autores rellenan a mano (versión, fecha, revisado por, descripción). Forma parte del documento y no es la vista [Historial](#soaw-collaboration)
- **Flujo de estados** — Los documentos progresan a través de etapas definidas:

| Estado | Significado |
|--------|-------------|
| **Borrador** | En redacción, aún no listo para revisión |
| **En Revisión** | Enviado para firma — bloqueado hasta que se retiren las firmas |
| **Aprobado** | Revisado y aceptado |
| **Firmado** | Firmado formalmente |

### Flujo de Firma

A partir de un SoAW en borrador o aprobado, puede solicitar firmas de las partes interesadas. Haga clic en **Solicitar Firmas** y use el campo de búsqueda para encontrar y agregar firmantes por nombre o correo electrónico. El sistema rastrea quién ha firmado y envía notificaciones a los firmantes pendientes.

Un SoAW en revisión está **bloqueado**, para que los firmantes firmen exactamente lo que se les envió: solo su iniciativa puede cambiar todavía. Para editar el contenido, haga clic en **Retirar firmas**, lo que lo devuelve a borrador. Un firmante que hace clic en **Rechazar** también lo devuelve a borrador, con el mismo número de revisión. Solo un SoAW en borrador se puede eliminar.

### Revisiones

Un SoAW firmado es de solo lectura. Haga clic en **Nueva Revisión** para iniciar un nuevo borrador a partir de él, con el mismo nombre y el siguiente número de revisión. Solo hay una revisión abierta a la vez: mientras se redacta una revisión, el SoAW firmado lo indica y ofrece **Abrir la revisión** en lugar de iniciar otra. Solo se puede revisar la última revisión, y un rechazo no cambia el número de revisión.

Una revisión anterior muestra un banner con un enlace a la actual, y la franja **Revisiones** de cada revisión las enumera todas. Las listas de SoAW — los entregables de la iniciativa, la pestaña SoAW, el informe de Entrega EA — muestran la revisión actual de cada documento y cualquier revisión en redacción.

### Discusión, menciones e historial {: #soaw-collaboration }

Un SoAW tiene la misma discusión, las mismas menciones y el mismo historial que una decisión: la discusión en un panel junto a su editor y su vista previa, el historial tras el botón **Historial** de la parte superior de la página. El comportamiento común se describe una sola vez, en la guía de GRC: [Discusión](grc.md#decision-discussion), [Menciones](grc.md#decision-mentions), [Historial](grc.md#decision-history) y [Limitaciones conocidas](grc.md#collaboration-limits). Lo que cambia en un SoAW:

- **Quién puede publicar.** Publicar, responder, resolver y reabrir requieren el permiso `soaw.comment`, que los miembros y administradores tienen por defecto y los visores no; la lectura de la discusión sigue a `soaw.view`. Los firmantes del SoAW siempre pueden comentarlo. Cualquiera que pueda editar SoAW (`soaw.manage`) puede eliminar cualquier comentario.
- **Secciones.** Un hilo se asocia a una de las secciones propias del SoAW con una etiqueta de sección, o a ninguna (un hilo general). Un SoAW tiene muchas secciones, así que el cuadro de redacción muestra una etiqueta para cada sección ya discutida y para la elegida; **Más…** abre una lista con búsqueda de las demás. Las etiquetas de la parte superior de la discusión la filtran por sección, como en una decisión. Un hilo asociado a una sección personalizada que se ha eliminado después muestra *Sección eliminada*. Cada sección lleva junto a su encabezado el mismo icono de chat que la de una decisión, en el editor y en la vista previa, con el número de hilos abiertos cuando hay discusión; haga clic en él para abrir la discusión sobre esa sección con la sección ya seleccionada para un nuevo comentario.
- **Rechazo.** Cualquier firmante que tenga el permiso de firma (`soaw.sign`) —o el permiso de edición— puede rechazar un SoAW, como ocurre con las decisiones; hasta ahora, rechazar requería el permiso de edición. El motivo abre un hilo **Motivo del rechazo** en la discusión.
- **Menciones.** Un SoAW no tiene fichas vinculadas, así que, si no se escribe nada después de **@**, las fichas se listan por orden alfabético; en un comentario, los firmantes del SoAW aparecen primero entre las personas. **Examinar…** funciona como en una decisión.
- **Nota de firma.** **Firmar** abre ahora un cuadro de diálogo en el que el firmante puede añadir una nota opcional; aparece en la discusión como **Nota de firma** y en el Historial.
- **Historial.** Una versión contiene el nombre del SoAW, su información de documento, su tabla Historial de Versiones del Documento y todas las secciones; la iniciativa no forma parte de una versión. El Historial registra lo que le ocurre al documento; la tabla Historial de Versiones del Documento, dentro del documento, solo registra lo que sus autores escriben en ella. Un SoAW en estado **Aprobado** todavía puede editarse, así que, igual que con un borrador, sus guardados se conservan como versiones y se puede restaurar en él una versión anterior.

### Vista Previa y Exportación

- **Modo de vista previa** — Vista de solo lectura del documento SoAW completo
- **Exportación DOCX** — Descargue el SoAW como un documento Word formateado para compartir o imprimir sin conexión
- **Exportación PDF** — Abre una vista lista para imprimir en una pestaña nueva; use *Guardar como PDF* del navegador. Permita las ventanas emergentes para este sitio si no se abre nada.

### Pestaña SoAW en las fichas de Iniciativa

![Ficha de iniciativa — pestaña SoAW](../assets/img/es/55_iniciativa_soaw_tab.png)

Las iniciativas también exponen una pestaña **SoAW** dedicada directamente en su página de detalle. La pestaña lista la revisión actual de cada SoAW vinculado a esa iniciativa, más cualquier revisión en redacción (título, chip de estado, número de revisión, fecha de última modificación) con un botón **+ Nuevo SoAW** que preselecciona la iniciativa actual — para que puedas redactar o saltar a un SoAW sin salir de la ficha en la que estás trabajando. La creación reutiliza el mismo diálogo que la página de Entrega EA, y el nuevo documento aparece en ambos lugares. La pestaña se muestra a los roles que tienen **Ver documentos SoAW** (`soaw.view`); el botón **+ Nuevo SoAW** y la acción de eliminar un borrador requieren **Crear y editar documentos SoAW** (`soaw.manage`), pueda o no editar la propia iniciativa.

## Registros de Decisiones de Arquitectura (ADR)

Un **Registro de Decisión de Arquitectura (ADR)** captura una decisión de arquitectura importante junto con su contexto, consecuencias y alternativas consideradas. El espacio de trabajo de Entrega EA muestra los ADR **vinculados a la iniciativa seleccionada** en línea, bajo la sección de entregables *Decisiones de Arquitectura* — así puede leerlos y abrirlos sin salir de la vista de la iniciativa. Use el split-button **+ Nuevo artefacto ▾** (o **+ Añadir** en la sección) para crear un nuevo ADR pre-vinculado a la iniciativa seleccionada.

El **registro maestro de ADR** — donde cada ADR del paisaje se filtra, busca, firma, revisa y previsualiza — vive en el módulo GRC en **GRC → Gobernanza → [Decisiones](grc.md#governance)**. Consulte la guía de GRC para el ciclo de vida completo del ADR (columnas de la cuadrícula, barra lateral de filtros, flujo de firma, revisiones, vista previa).

## Pestaña de Recursos

![Pestaña de Recursos](../assets/img/es/17c_ficha_recursos.png)

Las tarjetas ahora incluyen una pestaña de **Recursos** que consolida:

- **Decisiones de Arquitectura** — los ADR ya no se listan aquí. Ahora cada ficha tiene su propia pestaña **ADR**; consulte [Detalle de la ficha](card-details.md) para ver qué muestra y cómo vincular, crear o desvincular decisiones desde una ficha.
- **Archivos Adjuntos** — Cargue y gestione archivos (documentos, hojas de cálculo, presentaciones, archivos OpenDocument y de Office heredados, imágenes, archivos comprimidos, mensajes de Outlook y correo electrónico, CSV, Markdown, JSON y XML: hasta 20 MB). Al cargar, seleccione una **categoría de documento** entre: Arquitectura, Seguridad, Compliance, Operaciones, Notas de Reunión, Diseño u Otro. La categoría aparece como un chip junto a cada archivo.
- **Enlaces de Documentos** — Referencias de documentos basadas en URL. Al agregar un enlace, seleccione un **tipo de enlace** entre: Documentación, Seguridad, Compliance, Arquitectura, Operaciones, Soporte u Otro. El tipo de enlace aparece como un chip junto a cada enlace, y el icono cambia según el tipo seleccionado.
