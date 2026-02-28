# Gestión de Fin de Vida (EOL)

La página de administración de **EOL** (**Administrador > Configuración > EOL**) le ayuda a realizar el seguimiento de los ciclos de vida de productos tecnológicos vinculando sus fichas a la base de datos pública [endoflife.date](https://endoflife.date/).

## ¿Por Qué Realizar el Seguimiento de EOL?

Saber cuándo los productos tecnológicos alcanzan el fin de vida o el fin de soporte es fundamental para:

- **Gestión de riesgos** — El software sin soporte es un riesgo de seguridad
- **Planificación presupuestaria** — Planifique migraciones y actualizaciones antes de que finalice el soporte
- **Cumplimiento normativo** — Muchas regulaciones exigen software con soporte vigente

## Búsqueda Masiva

La función de búsqueda masiva analiza sus fichas de **Aplicación** y **Componente TI** y encuentra automáticamente productos coincidentes en la base de datos endoflife.date.

### Ejecución de una Búsqueda Masiva

1. Navegue a **Administrador > Configuración > EOL**
2. Seleccione el tipo de ficha a analizar (Aplicación o Componente TI)
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

- **Nombre del producto y versión**
- **Estado de soporte** — Codificado por colores: Con soporte (verde), Próximo a EOL (naranja), Fin de Vida (rojo)
- **Fechas clave** — Fecha de lanzamiento, fin de soporte activo, fin de soporte de seguridad, fecha EOL

## Informe EOL

Los datos EOL vinculados alimentan el [Informe EOL](../guide/reports.es.md), que proporciona una vista de panel de control del estado de soporte de su panorama tecnológico a través de todas las fichas vinculadas.
