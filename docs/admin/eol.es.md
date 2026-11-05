# Gestión de Fin de Vida (EOL)

La página de administración de **EOL** (**Administrador > Configuración > EOL**) le ayuda a realizar el seguimiento de los ciclos de vida de productos tecnológicos vinculando sus fichas a la base de datos pública [endoflife.date](https://endoflife.date/).

![Configuración EOL](../assets/img/es/29_admin_config_eol.png)

## ¿Por Qué Realizar el Seguimiento de EOL?

Saber cuándo los productos tecnológicos alcanzan el fin de vida o el fin de soporte es fundamental para:

- **Gestión de riesgos** — El software sin soporte es un riesgo de seguridad
- **Planificación presupuestaria** — Planifique migraciones y actualizaciones antes de que finalice el soporte
- **Cumplimiento normativo** — Muchas regulaciones exigen software con soporte vigente

## Búsqueda Masiva

La función de búsqueda masiva analiza las fichas de un tipo que realiza el seguimiento del fin de vida (**Aplicación** y **Componente TI** por defecto, véase [Fin de vida en otros tipos de ficha](#fin-de-vida-en-otros-tipos-de-ficha)) y encuentra automáticamente productos coincidentes en la base de datos endoflife.date.

### Ejecución de una Búsqueda Masiva

1. Navegue a **Administrador > Configuración > EOL**
2. Seleccione el tipo de ficha a analizar (cualquier tipo que realice el seguimiento del fin de vida)
3. Haga clic en **Buscar**
4. El sistema realiza una **coincidencia difusa** contra el catálogo de productos de endoflife.date

### Revisión de Resultados

Para cada ficha, la búsqueda devuelve:

- **Puntuación de coincidencia** (0-100%) — Qué tan estrechamente coincide el nombre de la ficha con un producto conocido
- **Nombre del producto** — El producto coincidente de endoflife.date
- **Versiones/ciclos disponibles** — Las versiones del producto con sus fechas de soporte

### Filtrado de Resultados

Utilice los controles de filtro para centrarse en:

- **Todos los elementos** — Todas las fichas que fueron analizadas
- **Solo sin vincular** — Fichas que aún no están vinculadas a un producto EOL
- **Ya vinculadas** — Fichas que ya tienen un vínculo EOL

Un resumen estadístico muestra: total de fichas analizadas, ya vinculadas, sin vincular y coincidencias encontradas.

### Vinculación de Fichas a Productos

1. Revise la coincidencia sugerida para cada ficha
2. Seleccione la **versión/ciclo del producto** correcta en el menú desplegable
3. Haga clic en **Vincular** para guardar la asociación

Una vez vinculada, la página de detalle de la ficha muestra una **sección EOL** con:

- **Nombre del producto y versión** — un producto personalizado se marca como **Personalizado**
- **Estado de soporte** — Codificado por colores, con la misma regla que el informe EOL: Con soporte (verde), Próximo a EOL (naranja, a menos de seis meses de la fecha EOL o una vez finalizado el soporte activo), Fin de Vida (rojo)
- **Fechas clave** — Fecha de lanzamiento, fin de soporte activo, fecha EOL, la última versión y su fecha de lanzamiento
- **Notas de la versión** — un enlace a la página del producto en endoflife.date, o la **Página del proveedor** de un producto personalizado

Solo los usuarios que pueden editar la ficha ven **Vincular**, **Cambiar** y **Desvincular**; el resto ve únicamente los detalles. Un gestor de EOL dispone además de un acceso directo a **Gestionar productos personalizados** cuando hay un producto personalizado vinculado.

## Fin de vida en otros tipos de ficha

El fin de vida se sigue por defecto en las **Aplicaciones** y los **Componentes TI**. Cualquier otro tipo de ficha, integrado o personalizado, también puede seguirlo: abra **Administrador > Metamodelo**, elija el tipo y, en su **Diseño de ficha**, desactive **Oculta del detalle de ficha** en la sección **Fin de vida**. Ese mismo interruptor oculta el fin de vida en Aplicaciones o Componentes TI si no lo sigue allí.

Ese único interruptor decide todo lo relativo al fin de vida del tipo:

- la sección **Fin de vida** de sus fichas (y la opción de vinculación al crear una ficha),
- el lugar del tipo en el [Informe EOL](../guide/reports.md), en el gráfico **Cobertura de fin de vida** del informe de Calidad de datos y en los filtros y agrupaciones de fin de vida de los paneles,
- la columna y el filtro **Fin de vida** del [Inventario](../guide/inventory.md),
- el selector de tipo de la **Búsqueda masiva** de esta página.

Ocultar la sección nunca elimina nada: las fichas conservan sus vínculos y sus fechas de ciclo de vida, y vuelven a aparecer en todos los informes cuando la sección se muestra de nuevo.

## Productos EOL personalizados

endoflife.date rastrea el software más popular, pero no todo lo que usted ejecuta: una plataforma propia, una herramienta especializada de un proveedor o un equipo con licencia a menudo no tienen entrada allí. Para ellos, defina un **producto EOL personalizado** (su propio producto con sus propios ciclos de lanzamiento) y vincule fichas a él exactamente como lo haría con un producto de endoflife.date. Los productos personalizados alimentan el mismo estado de la ficha, la columna **Fin de vida** del inventario, el [Informe EOL](../guide/reports.es.md) y las cifras de calidad de datos.

Los productos personalizados se listan en la pestaña **Productos personalizados** de **Admin > Configuración > EOL**, una fila por producto. Haga clic en un producto para abrir su panel, donde se editan sus detalles y ciclos de lanzamiento. Crearlos y editarlos requiere el permiso **Gestionar EOL** (`eol.manage`); cualquiera que pueda ver los datos EOL puede verlos, así como su panel.

![Productos EOL personalizados](../assets/img/es/29b_admin_config_eol_personalizados.png)

### Crear un producto personalizado

Hay dos formas de crearlo:

- **Desde una ficha**: en la sección **Fin de vida** de la ficha, una línea discreta bajo la búsqueda de producto dice *¿No está en endoflife.date?* con un enlace **Definirlo como producto personalizado…**, presente mientras no haya ningún producto seleccionado. El formulario se abre con el nombre del producto ya rellenado: lo que escribió en la búsqueda o, si no escribió nada, el nombre de la ficha. Añada sus primeros ciclos y guarde: la ficha queda vinculada al nuevo producto y ciclo de una sola vez.
- **Desde la pestaña Productos personalizados**: haga clic en **Añadir producto**.

Cada producto tiene:

- **Nombre del producto**: cómo se muestra en todas partes. Turbo EA deriva de él un identificador para los vínculos de las fichas (dos productos con el mismo nombre reciben identificadores numerados); usted nunca lo escribe, y solo aparece como nombre de archivo cuando propone el producto a endoflife.date.
- **Enlace del proveedor o de la política de lanzamientos** y **Descripción**: opcionales. Cuando las [sugerencias de IA](ai.md) están activadas, **Sugerir con IA** redacta la descripción a partir del nombre del producto y del enlace del proveedor, para que la edite antes de aplicarla.
- **Ciclos de lanzamiento**: cada uno con un nombre (por ejemplo `2.4`), una **Fecha de lanzamiento**, un fin de **Soporte activo**, un **Fin de vida** y, opcionalmente, la **Última versión** y su fecha de lanzamiento.

El soporte activo y el fin de vida admiten cada uno una fecha (**En una fecha…**), o una de dos respuestas cuando no se conoce ninguna fecha: *Aún con soporte* / *Soporte ya finalizado*, y *Sin fin de vida anunciado* / *Ya finalizado*. Como en endoflife.date, **el fin de vida es obligatorio** en cada ciclo —una fecha, *Sin fin de vida anunciado* o *Ya finalizado*—, mientras que el soporte activo puede quedar como *Desconocido*. El estado se calcula a partir de ellos con la misma regla que los productos de endoflife.date: **Fin de Vida** cuando se alcanza la fecha de fin de vida o el ciclo está marcado como *Ya finalizado*; **Próximo a EOL** dentro de los seis meses previos a esa fecha, o cuando el soporte activo ya ha terminado, ya sea por fecha o por *Soporte ya finalizado*; **Con soporte** en los demás casos. Un problema en un ciclo —sin nombre, sin fin de vida, un final anterior a su fecha de lanzamiento— se muestra en el campo afectado, y el producto no se puede guardar hasta corregirlo.

### La lista de productos y el panel del producto

La pestaña Productos personalizados muestra una fila por producto: su número de **Ciclos**, el **Último ciclo** y la **Última versión**, su **Estado** —el peor de sus ciclos, con el desglose por ciclo en la información emergente de la etiqueta— y las **Fichas vinculadas** que usted puede ver en todos sus ciclos. Funciona como las demás cuadrículas: fijar y reordenar columnas, mostrarlas u ocultarlas, y filtrar desde el panel izquierdo por estado (el del producto), uso o una búsqueda en los nombres de producto, los nombres de ciclo y las versiones. La **Descripción** y el **Enlace** del producto también están disponibles como columnas; al principio están ocultas, actívelas desde la pestaña **Columnas** del panel.

Haga clic en un producto para abrir su panel a la derecha. Su pestaña **Detalles** contiene el nombre, el enlace y la descripción del producto, que se guardan con **Guardar**, y sus ciclos de lanzamiento como filas, cada una con su estado, sus fechas y sus fichas vinculadas. **Editar** abre los campos de un ciclo en la propia fila; **Añadir ciclo** añade uno; **Eliminar** quita uno. Un ciclo guardado antes de que el fin de vida fuera obligatorio aparece marcado en la lista y debe recibir uno en su próxima edición. Al final del panel, **Cambiar a un producto de endoflife.date…** y **Eliminar producto** actúan sobre todo el producto. Sin el permiso Gestionar EOL, el panel es de solo lectura.

![Panel de un producto EOL personalizado](../assets/img/es/29c_admin_config_eol_personalizados_panel.png)

Un producto o un ciclo no se puede eliminar mientras haya fichas vinculadas a él, incluidas fichas que usted no puede ver. Para retirar un ciclo que usan fichas, cámbiele el nombre (el cambio de nombre arrastra consigo las fichas vinculadas) o vincule primero esas fichas a otro ciclo. El enlace de un producto se ofrece en sus fichas como enlace a la página del proveedor.

También puede añadir un ciclo que falte desde una ficha: una vez seleccionado un producto personalizado en la sección Fin de vida de la ficha, la lista de ciclos termina con **Añadir ciclo…**.

### Aportar un producto personalizado a endoflife.date

Si un producto personalizado es un producto público de un proveedor, considere proponerlo a endoflife.date para que todos se beneficien. Abra el panel del producto y su pestaña **Contribuir a endoflife.date**:

1. Lea la advertencia: proponer publica el nombre del producto y sus fechas. No proponga nunca productos internos o confidenciales.
2. Complete la **lista de comprobación de preparación**: al menos un ciclo, un fin de vida y una fecha de lanzamiento en cada ciclo, un enlace al proveedor o a la política de lanzamientos, una **categoría** de endoflife.date y una descripción de una línea. Cada punto pendiente indica dónde corregirlo. La categoría y el **resumen de la política de lanzamientos** (el párrafo bajo el front matter del archivo) se guardan en el producto, de modo que puede retomar un borrador más tarde.
3. Revise el archivo en el formato de endoflife.date (`products/<identifier>.md`) y haga clic en **Abrir en GitHub**. GitHub abre un archivo nuevo en el repositorio de endoflife.date con el contenido rellenado (crea un fork del repositorio en su cuenta si no puede escribir en él). Confírmelo en una rama y abra la pull request desde su propia cuenta de GitHub. Para archivos largos, use **Copiar archivo** y péguelo en un archivo nuevo.

Turbo EA nunca envía nada a GitHub por sí mismo y no almacena credenciales de GitHub. endoflife.date revisa cada propuesta según su [guía de contribución](https://github.com/endoflife-date/endoflife.date/blob/master/CONTRIBUTING.md).

### Cambiar a endoflife.date

Cuando endoflife.date empieza a rastrear un producto que usted mantenía como personalizado, la cuadrícula muestra junto a él una indicación **En endoflife.date**. La indicación solo aparece cuando la coincidencia es cercana (el mismo nombre, o el nombre de su producto dentro del de endoflife.date), de modo que un nombre corto de endoflife.date que simplemente aparece dentro del suyo no la activa. Haga clic en la indicación, en la lista o en el panel del producto, o elija **Cambiar a un producto de endoflife.date…** al final del panel:

1. Elija el producto de endoflife.date.
2. Para cada uno de sus ciclos, elija el ciclo de endoflife.date al que deben pasar sus fichas (los ciclos con el mismo nombre se emparejan automáticamente), o manténgalo en el producto personalizado.
3. Opcionalmente, elimine el producto personalizado cuando ya no lo vincule ninguna ficha.

Solo se mueven las fichas que usted puede ver. Las fechas de ciclo de vida de las fichas nunca se modifican.

## Informe EOL

Los datos EOL vinculados alimentan el [Informe EOL](../guide/reports.es.md), que proporciona una vista de panel de control del estado de soporte de su panorama tecnológico a través de todas las fichas vinculadas.

## Encontrar lo que aún no está vinculado

Dos lugares fuera de esta página listan las fichas sin información alguna de fin de vida: ni un enlace aquí ni una fecha de fin de vida propia:

- El filtro y la columna **Fin de vida** del [Inventario](../guide/inventory.es.md): elige un tipo de ficha y luego la opción **(vacío)**.
- La cifra **Sin datos de fin de vida** del [Informe EOL](../guide/reports.es.md) y el gráfico **Cobertura de fin de vida** al final del informe de Calidad de datos.
