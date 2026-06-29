# Informes Guardados

Turbo EA permite **guardar configuraciones de informes** para que pueda volver rápidamente a vistas específicas sin reconfigurar filtros y ejes cada vez.

## Guardar un Informe

Desde cualquier página de informe (Portafolio, Mapa de Capacidades, Ciclo de Vida, Dependencias, Costos, Matriz, Calidad de Datos o EOL):

1. Configure el informe con los filtros, agrupaciones y selecciones de ejes deseados
2. Haga clic en el botón **Guardar** en la barra de herramientas del informe
3. Ingrese un **nombre** para el informe guardado
4. Elija la **visibilidad**:

| Visibilidad | Quién puede verlo |
|-------------|-------------------|
| **Privado** | Solo usted |
| **Compartido** | Usted y usuarios específicos que seleccione |
| **Público** | Todos los usuarios de la plataforma |

Para informes compartidos, puede otorgar **permisos de edición** a usuarios específicos, permitiéndoles actualizar la configuración guardada.

5. Haga clic en **Guardar** — se captura automáticamente una miniatura de la visualización actual

## Galería de Informes Guardados

Navegue a **Informes > Informes Guardados** para explorar todos los informes guardados a los que tiene acceso. La galería muestra vistas previas en miniatura organizadas en pestañas:

- **Mis Informes** — Informes que usted creó
- **Compartidos Conmigo** — Informes que otros compartieron con usted
- **Públicos** — Informes visibles para todos

### Acciones

- **Abrir** — Haga clic en un informe para cargarlo con la configuración guardada
- **Editar** — Actualice el nombre, visibilidad o configuración de compartición
- **Duplicar** — Cree una copia con un nuevo nombre
- **Eliminar** — Elimine el informe guardado (solo el creador o usuarios con permisos de edición pueden eliminar)

## Informes personalizados con tu asistente de IA

Más allá de los tipos de informe integrados, Turbo EA puede crear **informes totalmente personalizados** a partir de una descripción en lenguaje natural, mediante un asistente de IA conectado a través del **servidor MCP**.

### Cómo funciona

1. Conecta el servidor MCP de Turbo EA a tu asistente de IA (por ejemplo, Claude Code) — consulta la guía **Integración MCP**.
2. Describe el informe que quieres en lenguaje natural, por ejemplo *«Contar aplicaciones por criticidad de negocio como gráfico circular»* o *«Coste anual total de componentes de TI agrupados por proveedor»*.
3. El asistente llama a `get_report_builder_schema` para leer tu metamodelo en vivo (tipos de tarjeta, campos, relaciones, etiquetas), ensambla una **especificación** de informe segura y la previsualiza con tus datos reales mediante `preview_custom_report`, de modo que ves resultados reales antes de guardar nada.
4. Cuando estés conforme, el asistente **publica** el informe con `create_saved_report`. Aparece en la galería de **Informes guardados** y se abre como un informe nativo e interactivo.

### Qué pueden hacer los informes personalizados

- **Conscientes del metamodelo**: tus tipos de tarjeta, subtipos, campos, relaciones y etiquetas se reflejan automáticamente, sin programación.
- **Agrupar y agregar**: agrupar por atributo, subtipo, fase del ciclo de vida, grupo de etiquetas o tarjeta relacionada, y medir con recuento, suma, promedio, mínimo o máximo.
- **Filtrar y recorrer**: filtrar las tarjetas de origen y, opcionalmente, seguir un salto de relación hacia tarjetas relacionadas.
- **Muchas visualizaciones**: mostrar como tabla, gráfico de barras/columnas/circular/anillo/dispersión/treemap/líneas, o como mosaicos de KPI.
- **Seguro y gobernado**: los informes son de solo lectura, funcionan totalmente con reglas declarativas (sin código, sin SQL), y los campos de coste permanecen detrás del permiso **Ver costes**, igual que cualquier otro informe.

Los informes personalizados se guardan como cualquier otro informe, por lo que se aplican las mismas opciones de visibilidad y uso compartido (privado / compartido / público).
