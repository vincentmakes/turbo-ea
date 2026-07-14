# Detalle de Fichas

Al hacer clic en cualquier ficha del inventario, se abre la **vista de detalle** donde puede ver y editar toda la información del componente.

![Vista de Detalle de una Ficha](../assets/img/es/04_detalle_ficha.png)

## Encabezado de la Ficha

La parte superior de la ficha muestra:

- **Icono y etiqueta del tipo** — Indicador del tipo de ficha con código de color
- **Nombre de la ficha** — Editable en línea
- **Subtipo** — Clasificación secundaria (si aplica)
- **Insignia de estado de aprobación** — Borrador, Aprobado, Roto o Rechazado
- **Botón de sugerencia IA** — Haga clic para generar una descripción con IA (visible cuando la IA está habilitada para este tipo de ficha y el usuario tiene permiso de edición)
- **Anillo de calidad de datos** — Indicador visual de la completitud de la información (0–100%)
- **Menú de acciones** — Archivar, eliminar y acciones de aprobación. También incluye una acción de un clic **Observar esta ficha** (cuando el tipo de ficha define un rol Observador), para que cualquier usuario con permiso de lectura pueda seguir la ficha sin pasar por la pestaña de Partes interesadas.

### Flujo de Aprobación

Las fichas pueden pasar por un ciclo de aprobación:

| Estado | Significado |
|--------|-------------|
| **Borrador** | Estado predeterminado, aún no revisado |
| **Aprobado** | Revisado y aceptado por una parte responsable |
| **Roto** | Fue aprobado, pero ha sido editado desde entonces — necesita re-revisión |
| **Rechazado** | Revisado y rechazado, necesita correcciones |

Cuando una ficha aprobada es editada, su estado cambia automáticamente a **Roto** para indicar que necesita re-revisión.

## Pestaña Detalle (Principal)

La pestaña de detalle está organizada en **secciones** que pueden ser reordenadas y configuradas por un administrador para cada tipo de ficha (consulte [Editor de Disposición de Fichas](../admin/metamodel.es.md#editor-de-disposicion-de-fichas)).

### Sección de Descripción

- **Descripción** — Descripción en texto enriquecido del componente. Soporta la función de sugerencia con IA para generación automática
- **Campos de descripción adicionales** — Algunos tipos de ficha incluyen campos extra en la sección de descripción (por ejemplo, alias, ID externo)

### Sección de Ciclo de Vida

El modelo de ciclo de vida rastrea un componente a través de cinco fases:

| Fase | Descripción |
|------|-------------|
| **Plan** | En consideración, aún no iniciado |
| **Fase de Entrada** | En proceso de implementación o despliegue |
| **Activo** | Actualmente operativo |
| **Fase de Salida** | En proceso de retirada |
| **Fin de Vida** | Ya no está en uso ni tiene soporte |

Cada fase tiene un **selector de fecha** para registrar cuándo el componente entró o entrará en esa fase. Una barra de línea temporal visual muestra la posición del componente en su ciclo de vida.

### Secciones de Atributos Personalizados

Dependiendo del tipo de ficha, verá secciones adicionales con **campos personalizados** configurados en el metamodelo. Los tipos de campo incluyen:

- **Texto** — Entrada de texto libre
- **Texto multilínea** — Entrada de texto libre que preserva los saltos de línea, mostrada como un área de texto que crece automáticamente
- **Número** — Valor numérico
- **Costo** — Valor numérico mostrado con la moneda configurada en la plataforma
- **Booleano** — Interruptor de activar/desactivar
- **Fecha** — Selector de fecha
- **URL** — Enlace interactivo (validado para http/https/mailto)
- **Selección única** — Desplegable con opciones predefinidas
- **Selección múltiple** — Selección múltiple con visualización de chips

Los campos marcados como **calculados** muestran una insignia y no pueden editarse manualmente — sus valores son calculados por [fórmulas definidas por el administrador](../admin/calculations.es.md).

### Sección de Jerarquía

Para tipos de ficha que soportan jerarquía (por ejemplo, Organización, Capacidad de Negocio, Aplicación):

- **Padre** — La ficha padre en la jerarquía (haga clic para navegar)
- **Hijos** — Lista de fichas hijas (haga clic en cualquiera para navegar)
- **Ruta jerárquica** — Muestra la ruta completa desde la raíz hasta la ficha actual

### Sección de Relaciones

Muestra todas las conexiones con otras fichas, agrupadas por tipo de relación. Para cada relación:

- **Nombre de la ficha relacionada** — Haga clic para navegar a la ficha relacionada
- **Tipo de relación** — La naturaleza de la conexión (por ejemplo, «utiliza», «se ejecuta en», «depende de»)
- **Agregar relación** — Haga clic en **+** para crear una nueva relación; el selector muestra las fichas coincidentes en cuanto se abre (ordenadas por nombre, se cargan más al desplazarse) y al escribir se filtra la lista
- **Eliminar relación** — Haga clic en el icono de eliminar para quitar una relación
- **Agrupar por subtipo** — Cuando una sección de relaciones tiene muchas fichas relacionadas, se agrupan automáticamente en grupos de subtipo plegables (cada uno con un recuento), con un grupo final **Sin subtipo** para las fichas sin clasificar. Utilice el botón de alternancia en el encabezado de la sección para cambiar entre la vista agrupada y la vista de lista.

### Sección de Etiquetas

Aplique etiquetas de los [grupos de etiquetas](../admin/tags.es.md) configurados. Dependiendo del modo del grupo, puede seleccionar una etiqueta (selección única) o múltiples etiquetas (selección múltiple).

### Pestaña de Recursos

La pestaña de **Recursos** consolida todos los materiales de apoyo de una ficha:

- **Decisiones de Arquitectura** — ADR vinculados a esta ficha, mostrados como píldoras de color que coinciden con los colores del tipo de tarjeta (ej., azul para Aplicación, morado para Objeto de Datos). Puede vincular ADR existentes o crear uno nuevo directamente desde la pestaña de Recursos — el nuevo ADR se vincula automáticamente a la ficha.
- **Archivos Adjuntos** — Cargue y gestione archivos (PDF, DOCX, XLSX, imágenes, hasta 10 MB). Al cargar, seleccione una **categoría de documento** entre: Arquitectura, Seguridad, Compliance, Operaciones, Notas de Reunión, Diseño u Otro. La categoría aparece como un chip junto a cada archivo.
- **Enlaces de Documentos** — Referencias de documentos basadas en URL. Al agregar un enlace, seleccione un **tipo de enlace** entre: Documentación, Seguridad, Compliance, Arquitectura, Operaciones, Soporte u Otro. El tipo de enlace aparece como un chip junto a cada enlace, y el icono cambia según el tipo seleccionado.
- **Diagramas** — Vincule [diagramas](diagrams.es.md) existentes a esta ficha. Los diagramas vinculados se muestran como vistas previas en miniatura que puede hacer clic para abrir en el editor de diagramas. Use el botón **Vincular Diagrama** para buscar y adjuntar un diagrama existente, o haga clic en el icono de desvincular para eliminar la asociación.

### Sección EOL

Si la ficha está vinculada a un producto de [endoflife.date](https://endoflife.date/) (a través de la [Administración de EOL](../admin/eol.es.md)):

- **Nombre del producto y versión**
- **Estado de soporte** — Codificado por colores: Con Soporte, Próximo a EOL, Fin de Vida
- **Fechas clave** — Fecha de lanzamiento, fin de soporte activo, fin de soporte de seguridad, fecha EOL

## Pestaña de Comentarios

![Sección de Comentarios de una Ficha](../assets/img/es/05_ficha_comentarios.png)

- **Agregar comentarios** — Deje notas, preguntas o decisiones sobre el componente
- **Respuestas en hilo** — Responda a comentarios específicos para crear hilos de conversación
- **Marcas de tiempo** — Vea cuándo se publicó cada comentario y por quién

## Pestaña de Tareas

![Tareas Asociadas a una Ficha](../assets/img/es/06_ficha_tareas.png)

- **Crear tareas** — Agregue tareas vinculadas a esta ficha específica
- **Asignar** — Establezca una persona responsable para cada tarea
- **Fecha límite** — Establezca plazos
- **Estado** — Alterne entre Abierta y Completada
- **Recurrente** — Active **Repetir** para que una tarea se repita según un calendario (cada N días, semanas, meses o años); al completarla se crea automáticamente la siguiente repetición

## Pestaña de Partes Interesadas

![Partes Interesadas de una Ficha](../assets/img/es/07_ficha_partes_interesadas.png)

Las partes interesadas son personas con un **rol** específico en esta ficha. Los roles disponibles dependen del tipo de ficha (configurados en el [metamodelo](../admin/metamodel.es.md)). Los roles comunes incluyen:

- **Propietario de Aplicación** — Responsable de las decisiones de negocio
- **Propietario Técnico** — Responsable de las decisiones técnicas
- **Roles personalizados** — Roles adicionales definidos por su administrador

Las asignaciones de partes interesadas afectan los **permisos**: los permisos efectivos de un usuario en una ficha son la combinación de su rol a nivel de aplicación y cualquier rol de parte interesada que tenga en esa ficha.

### Búsqueda e invitación

Elige a una parte interesada mediante el **autocompletar buscable** — empieza a escribir y el desplegable filtra tanto por nombre como por correo (el correo aparece como línea secundaria, de modo que dos usuarios con el mismo nombre puedan distinguirse de un vistazo).

Si el correo que escribes no coincide con un usuario existente, aparece una opción **«Invitar a «email» como nuevo usuario»** al final del desplegable. Al seleccionarla se expande un mini-formulario en línea dentro del propio selector — elige un rol (Miembro o Visualizador por defecto), edita opcionalmente el nombre mostrado y envía. El nuevo usuario es invitado mediante el correo de invitación estándar **y** asignado al rol de parte interesada elegido en la ficha en una sola acción, así nunca tienes que abandonar la ficha para incorporar a un colaborador.

La ruta de invitación requiere el permiso **`users.invite`**, una forma delegada de `admin.users` que los administradores pueden conceder a miembros de confianza. Un guardián anti-escalada de privilegios impide que los no administradores inviten usuarios a roles de administrador — el desplegable de roles filtra silenciosamente a los roles que el invitador tiene permitido delegar.

## Pestaña de Historial

![Historial de Cambios de una Ficha](../assets/img/es/08_ficha_historial.png)

Muestra el **registro completo de auditoría** de los cambios realizados en la ficha: **quién** hizo el cambio, **cuándo** se realizó y **qué** se modificó (valor anterior vs. valor nuevo). Esto permite la trazabilidad completa de todas las modificaciones a lo largo del tiempo.

## Pestaña de Riesgos (GRC activado, cuando aplique)

Cuando el [módulo GRC](grc.md) está habilitado **y** la ficha tiene al menos un riesgo vinculado, aparece una pestaña **Riesgos** que lista todos los riesgos vinculados a la ficha con una ruta de un clic de vuelta al [Registro de riesgos](risks.md). La pestaña se oculta automáticamente cuando no hay riesgos vinculados, de modo que las fichas sin actividad GRC no arrastran una pestaña vacía.

## Pestaña de Cumplimiento (GRC activado, cuando aplique)

Cuando el [módulo GRC](grc.md) está habilitado **y** la ficha tiene al menos un hallazgo de cumplimiento vinculado, aparece una pestaña **Cumplimiento** que lista cada hallazgo actualmente vinculado a la ficha. Las mismas acciones Reconocer / Aceptar / **Crear riesgo** / **Abrir riesgo** que en la [cuadrícula de Cumplimiento GRC](compliance.md) están disponibles, de modo que el propietario de la ficha pueda triagiar sus propios hallazgos sin salir de la ficha. Auto-ocultada cuando no hay hallazgos vinculados.

## Pestaña de Flujo de Proceso (solo para fichas de Proceso de Negocio)

Para las fichas de **Proceso de Negocio**, aparece una pestaña adicional de **Flujo de Proceso** con un visor/editor de diagramas BPMN integrado. Consulte [BPM](bpm.es.md) para más detalles sobre la gestión de flujos de proceso.

## Pestaña PPM (solo para fichas de Iniciativa)

Cuando el [módulo PPM](ppm.md) está activado, las fichas de **Iniciativa** muestran una pestaña **PPM** adicional como última pestaña. Al hacer clic en esta pestaña, se navega a la vista detallada PPM de la iniciativa, donde puede gestionar informes de estado, presupuestos, riesgos, tareas y diagramas de Gantt.

## Archivado

Las fichas pueden ser **archivadas** (eliminación temporal) a través del menú de acciones. Las fichas archivadas:

- Se ocultan de la vista predeterminada del inventario (visibles solo con el filtro «Mostrar archivados»)
- Se **eliminan permanentemente de forma automática después de 30 días**
- Pueden ser restauradas antes de que expire el período de 30 días
