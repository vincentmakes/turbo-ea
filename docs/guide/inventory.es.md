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

Su selección de columnas, filtros activos y orden de clasificación se **guardan automáticamente** en su navegador. Al volver a la página de inventario, se restaura su configuración anterior. Las vistas guardadas (marcadores) también conservan la selección completa de columnas, de modo que al cambiar entre vistas se restauran exactamente las columnas que había configurado.

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

## Importación desde Excel { #excel-import }

Haga clic en **Importar** en la barra de herramientas para crear o actualizar fichas de forma masiva desde un archivo Excel.

1. **Seleccionar un archivo** — Arrastre y suelte un archivo `.xlsx` o haga clic para explorar
2. **Elegir el tipo de ficha** — Opcionalmente, restrinja la importación a un tipo específico
3. **Validación** — El sistema analiza el archivo y muestra un informe de validación:
   - Filas que crearán nuevas fichas
   - Filas que actualizarán fichas existentes (emparejadas por nombre o ID)
   - Advertencias y errores
4. **Importar** — Haga clic para continuar. Una barra de progreso muestra el estado en tiempo real
5. **Resultados** — Un resumen muestra cuántas fichas fueron creadas, actualizadas o fallaron

## Exportación a Excel

Haga clic en **Exportar** para descargar la vista actual del inventario como un archivo Excel:

- **Exportación multi-tipo** — Exporta todas las fichas visibles con columnas principales (nombre, tipo, descripción, subtipo, ciclo de vida, estado de aprobación)
- **Exportación de tipo único** — Cuando se filtra por un solo tipo, la exportación incluye columnas expandidas de atributos personalizados (una columna por campo)
- **Expansión del ciclo de vida** — Columnas separadas para cada fecha de fase del ciclo de vida (Plan, Fase de Entrada, Activo, Fase de Salida, Fin de Vida)
- **Nombre de archivo con fecha** — El archivo se nombra con la fecha de exportación para facilitar la organización
