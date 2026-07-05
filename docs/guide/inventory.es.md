# Inventario

El **Inventario** es el corazón de Turbo EA. Aquí se listan todas las **fichas** (componentes) de la arquitectura empresarial: aplicaciones, procesos, capacidades de negocio, organizaciones, proveedores, interfaces y más.

![Vista del Inventario con panel de filtros](../assets/img/es/23_inventario_filtros.png)

## Estructura de la Pantalla de Inventario

### Panel de Filtros (Izquierda)

El panel lateral izquierdo permite **filtrar** las fichas por diferentes criterios:

- **Buscar** — Búsqueda de texto libre en los nombres de las fichas
- **Tipos** — Filtrar por uno o más tipos de ficha: Objetivo, Plataforma, Iniciativa, Organización, Capacidad de Negocio, Contexto de Negocio, Proceso de Negocio, Aplicación, Interfaz, Objeto de Datos, Componente TI, Categoría Tecnológica, Proveedor, Sistema
- **Subtipos** — Cuando se selecciona un tipo, permite filtrar por subtipo (por ejemplo, Aplicación → Aplicación de Negocio, Microservicio, Agente IA, Despliegue)
- **Estado de Aprobación** — Borrador, Aprobado, Roto o Rechazado
- **Ciclo de Vida** — Filtrar por fase del ciclo de vida: Plan, Fase de Entrada, Activo, Fase de Salida, Fin de Vida
- **Calidad de Datos** — Filtrado por umbral: Buena (80%+), Media (50–79%), Baja (menos del 50%)
- **Etiquetas** — Filtrar por etiquetas de cualquier grupo de etiquetas
- **Relaciones** — Filtrar por fichas relacionadas a través de tipos de relación
- **Atributos personalizados** — Filtrar por valores en campos personalizados (búsqueda de texto, opciones de selección)
- **Mostrar solo archivados** — Alternar para ver fichas archivadas (eliminadas temporalmente)
- **Limpiar todo** — Restablecer todos los filtros activos de una vez

> **Encontrar fichas sin valor.** Los filtros de Subtipo, Ciclo de vida, Etiquetas, Relaciones y atributos personalizados de selección incluyen cada uno una opción **(vacío)**. Selecciónela para mostrar solo las fichas que *no* tienen valor en ese campo, por ejemplo todas las fichas sin ciclo de vida definido. Se puede combinar con valores normales (coincide con cualquiera) y entre varios filtros (coincide con todos).

Un **contador de filtros activos** muestra cuántos filtros están aplicados actualmente.

### Pestaña Columnas

La pestaña **Columnas** en el panel lateral le permite elegir qué columnas adicionales mostrar en la cuadrícula. Las columnas disponibles cambian dinámicamente según los tipos de tarjetas seleccionados:

- **Un solo tipo seleccionado** — Todos los campos de atributos definidos para ese tipo están disponibles, además de columnas de relaciones y metadatos
- **Varios tipos seleccionados** — Solo los campos que son **comunes a todos los tipos seleccionados** están disponibles
- **Ningún tipo seleccionado** — Un mensaje de ayuda le solicita seleccionar primero un tipo de tarjeta

Las columnas se agrupan en cuatro categorías:

| Categoría | Descripción |
|-----------|-------------|
| **Columnas predeterminadas** | Columnas siempre visibles: Tipo, Nombre, Ruta, Descripción, Subtipo, Ciclo de vida, Estado de aprobación, Calidad de datos. Desmárquelas para ocultarlas de la cuadrícula — útil para ajustar una vista guardada solo a las columnas que realmente utiliza. |
| **Metadatos** | Creado, Modificado, Creado por, Modificado por |
| **Atributos** | Campos personalizados definidos en el metamodelo (texto, número, coste, fecha, selección, etc.) |
| **Relaciones** | Tipos de tarjetas relacionados (p. ej., Aplicaciones vinculadas a una Capacidad de Negocio) |

La columna **Ruta** muestra la jerarquía de la ficha (p. ej. «América del Norte / Ventas / Ventas internas») sin incluir el nombre de la propia ficha, para que pueda ver Nombre y Ruta a la vez.

Cada categoría tiene una casilla **Seleccionar todo** para activar o desactivar rápidamente todas las columnas de ese grupo. Un campo de búsqueda en la parte superior permite encontrar columnas específicas por nombre. La insignia en cada encabezado de sección muestra cuántas columnas de ese grupo están actualmente visibles.

Cuando se selecciona un tipo de tarjeta por primera vez, **todas las columnas de atributos y relaciones se activan por defecto**. Luego puede desmarcar las columnas que no necesite. Un botón **Restablecer** en la parte inferior de la pestaña «Columnas» restaura la selección de columnas predeterminada.

Un **punto indicador de cambio** aparece en el encabezado de la pestaña «Columnas» cuando la selección de columnas difiere de los valores predeterminados. El mismo indicador aparece en la pestaña **Filtros** cuando hay filtros activos, lo que facilita ver de un vistazo qué configuraciones han sido modificadas.

Su selección de columnas, el **diseño de columnas** (orden de izquierda a derecha, anchos y columnas fijadas), los filtros activos y el orden de clasificación se **guardan automáticamente** en su navegador. Al volver a la página de inventario, se restaura su configuración anterior. Las vistas guardadas (marcadores) también conservan este diseño completo, de modo que al cambiar entre vistas se restauran exactamente las columnas que había configurado, y en la misma disposición, lo que importa al compartir una vista organizada con las partes interesadas.

### Tabla Principal

El inventario utiliza una tabla de datos **AG Grid** con funciones avanzadas:

| Columna | Descripción |
|---------|-------------|
| **Tipo** | Tipo de ficha con icono de color |
| **Nombre** | Nombre del componente (haga clic para abrir el detalle de la ficha) |
| **Descripción** | Descripción breve |
| **Ciclo de Vida** | Estado actual del ciclo de vida |
| **Estado de Aprobación** | Insignia de estado de revisión |
| **Calidad de Datos** | Porcentaje de completitud con anillo visual |
| **Relaciones** | Conteo de relaciones con popover interactivo que muestra las fichas relacionadas |

**Funciones de la tabla:**

- **Ordenamiento** — Haga clic en cualquier encabezado de columna para ordenar de forma ascendente/descendente
- **Edición en línea** — En modo de edición en cuadrícula, edite los valores de los campos directamente en la tabla
- **Selección múltiple** — Seleccione múltiples filas para operaciones masivas
- **Vista jerárquica** — Las relaciones padre/hijo se muestran como rutas de navegación
- **Configuración de columnas** — Mostrar, ocultar y reordenar columnas

### Barra de Herramientas

- **Edición en Cuadrícula** — Alternar el modo de edición en línea para editar múltiples fichas en la tabla
- **Exportar** — Descargar datos como archivo Excel (.xlsx)
- **Importar** — Carga masiva de datos desde archivos Excel
- **+ Crear** — Crear una nueva ficha

![Diálogo de Creación de Ficha](../assets/img/es/22_crear_ficha.png)

## Cómo Crear una Nueva Ficha

1. Haga clic en el botón **+ Crear** (azul, esquina superior derecha)
2. En el diálogo que aparece:
   - Seleccione el **Tipo** de ficha (Aplicación, Proceso, Objetivo, etc.)
   - Ingrese el **Nombre** del componente
   - Opcionalmente, agregue una **Descripción**
3. Opcionalmente, haga clic en **Sugerir con IA** para generar una descripción automáticamente (consulte [Sugerencias de Descripción con IA](#sugerencias-de-descripcion-con-ia) a continuación)
4. Haga clic en **CREAR**

## Sugerencias de Descripción con IA { #ai-description-suggestions }

Turbo EA puede usar **IA para generar una descripción** para cualquier ficha. Esto funciona tanto en el diálogo de creación de fichas como en las páginas de detalle de fichas existentes.

**Cómo funciona:**

1. Ingrese un nombre de ficha y seleccione un tipo
2. Haga clic en el **icono de destello** en el encabezado de la ficha, o en el botón **Sugerir con IA** en el diálogo de creación
3. El sistema realiza una **búsqueda web** del nombre del elemento (usando contexto según el tipo — por ejemplo, «SAP S/4HANA software application»), y luego envía los resultados a un **LLM** para generar una descripción concisa y factual
4. Aparece un panel de sugerencias con:
   - **Descripción editable** — revise y modifique el texto antes de aplicarlo
   - **Puntuación de confianza** — indica qué tan segura está la IA (Alta / Media / Baja)
   - **Enlaces a fuentes** — las páginas web de las que se extrajo la descripción
   - **Nombre del modelo** — qué LLM generó la sugerencia
5. Haga clic en **Aplicar descripción** para guardar, o **Ignorar** para descartar

**Características principales:**

- **Consciente del tipo**: La IA entiende el contexto del tipo de ficha. Una búsqueda de «Aplicación» agrega «software application», una búsqueda de «Proveedor» agrega «technology vendor», etc.
- **Privacidad primero**: Cuando se utiliza Ollama, el LLM se ejecuta localmente — sus datos nunca salen de su infraestructura. También se admiten proveedores comerciales (OpenAI, Google Gemini, Anthropic Claude, etc.)
- **Controlado por administradores**: Las sugerencias de IA deben ser habilitadas por un administrador en [Configuración > Sugerencias de IA](../admin/ai.es.md). Los administradores eligen qué tipos de fichas muestran el botón de sugerencia, configuran el proveedor de LLM y seleccionan el proveedor de búsqueda web
- **Basado en permisos**: Solo los usuarios con el permiso `ai.suggest` pueden usar esta función (habilitado por defecto para los roles Admin, BPM Admin y Miembro)

## Vistas Guardadas (Marcadores)

Puede guardar su configuración actual de filtros, columnas y ordenamiento como una **vista con nombre** para reutilizarla rápidamente.

### Crear una Vista Guardada

1. Configure el inventario con los filtros, columnas y ordenamiento deseados
2. Haga clic en el icono de **marcador** en el panel de filtros
3. Ingrese un **nombre** para la vista
4. Elija la **visibilidad**:
   - **Privada** — Solo usted puede verla
   - **Compartida** — Visible para usuarios específicos (con permisos de edición opcionales)
   - **Pública** — Visible para todos los usuarios

### Usar Vistas Guardadas

Las vistas guardadas aparecen en el panel lateral de filtros. Haga clic en cualquier vista para aplicar su configuración instantáneamente. Las vistas se organizan en:

- **Mis Vistas** — Vistas que usted creó
- **Compartidas conmigo** — Vistas que otros compartieron con usted
- **Vistas Públicas** — Vistas disponibles para todos

## Importación / Exportación Excel { #excel-import }

Las importaciones y exportaciones del inventario usan un **libro Excel multi-hoja** que restituye un sub-paisaje completo — fichas de cualquier número de tipos más las relaciones entre ellas — sin necesidad de copiar nunca un UUID.

### Estructura del libro

- **Una hoja por tipo de ficha** (Application, Business Capability, IT Component, …) con sus columnas principales, sus columnas `attr_<campo>`, las columnas de ciclo de vida y las columnas de relaciones `rel:<tipo_de_relación>`.
- **Una hoja `Relations`** para los tipos de relación que llevan atributos (coste, descripción…). Las relaciones simples permanecen en línea en la hoja de la ficha origen.
- **Una hoja `_Meta`** con la versión del formato del libro.

### Identificación sin GUIDs

Las fichas se identifican por **nombre** cuando es único dentro de su tipo, y en caso contrario por el **`parent_path`** completo. Una celda de relación puede contener `NexaCore ERP` directamente si solo una Application tiene ese nombre; en caso de ambigüedad se usa `Sales / Customer Mgmt / CRM`.

#### Unicidad entre hermanos

Como las fichas se identifican por nombre + ruta, **dos fichas del mismo tipo no pueden compartir a la vez el mismo padre y el mismo nombre**. Las fichas nuevas que provocarían una colisión se rechazan al crearse (en el diálogo Crear ficha, al renombrar en línea y durante la importación de Excel). Los duplicados ya existentes en la base de datos, heredados de importaciones o seeds antiguos, se mantienen intactos: puede editar cualquier campo, pero crear un tercer duplicado o renombrar una ficha de vuelta a la colisión está bloqueado. La comprobación es insensible a mayúsculas y espacios, igual que el resolutor del importador.

### Celdas de relación en línea

Cada columna `rel:<tipo_de_relación>` expresa las relaciones salientes como una lista **separada por punto y coma** (por ejemplo `NexaCore ERP; BillingApp`). Punto y coma en lugar de coma, porque los nombres de las fichas suelen contener comas (`Acme, Inc.`). Dentro de un nombre, `/` y `\` se escapan como `\/` y `\\` — el exportador lo hace automáticamente (p. ej. `SAP S/4HANA` → `SAP S\/4HANA`). Las celdas son **declarativas**: su contenido reemplaza el conjunto de relaciones salientes de ese tipo desde el origen. Eliminar un destino elimina la relación correspondiente; vaciar la celda elimina todas. Por compatibilidad, las celdas separadas por comas (formato antiguo) también se aceptan.

### Hoja `Relations`

Para relaciones con atributos, use la hoja dedicada con las columnas `relation_type`, `source_ref`, `target_ref`, `action` (por defecto `upsert`, alternativamente `delete`), `attr_<campo>` y `description`.

### Importar

Haga clic en **Importar** en la barra de herramientas, suelte el libro y revise la vista previa antes de aplicar. Verá tanto las fichas a crear / actualizar como las relaciones a añadir / eliminar. Los errores (por ejemplo, un destino ambiguo con sus rutas candidatas) bloquean la aplicación.

### Exportar

Haga clic en **Exportar**. El filtro activo determina el contenido: con un filtro de tipo único, una hoja para ese tipo; sin filtro, una hoja por tipo presente. En todos los casos el libro incluye `Relations` y `_Meta` y puede reimportarse sin perder atributos específicos del tipo.

También puede elegir **Exportar vista actual** en el menú Exportar: una instantánea plana de una sola hoja que refleja lo que está en pantalla (solo las columnas visibles, en su orden actual, para las filas filtradas). Está pensada para compartir y **no es apta para reimportar**.
