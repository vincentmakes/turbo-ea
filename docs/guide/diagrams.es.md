# Diagramas

El módulo de **Diagramas** permite crear **diagramas de arquitectura visual** utilizando un editor [DrawIO](https://www.drawio.com/) integrado — completamente conectado con el inventario de fichas. Puede arrastrar fichas al lienzo, conectarlas con relaciones y mantener el diagrama sincronizado con los datos de su arquitectura.

![Galería de Diagramas](../assets/img/es/16_diagramas.png)

## Galería de Diagramas

La galería muestra todos los diagramas como **tarjetas con miniatura** o en una **vista de lista** (alterne mediante el icono de vista en la barra de herramientas). Cada diagrama muestra su nombre, tipo y una vista previa visual de su contenido.

**Acciones desde la galería:**

- **Crear** — Haga clic en **+ Nuevo Diagrama** para crear un diagrama con nombre, descripción opcional y un enlace opcional a una ficha de Iniciativa
- **Abrir** — Haga clic en cualquier diagrama para abrir el editor
- **Editar detalles** — Renombrar, actualizar la descripción o reasignar la iniciativa vinculada
- **Eliminar** — Eliminar un diagrama (con confirmación)

## El Editor de Diagramas

Al abrir un diagrama se inicia un editor **DrawIO** a pantalla completa en un iframe. La barra de herramientas estándar de DrawIO está disponible para formas, conectores, texto, formato y diseño.

### Insertar Fichas

Use la **Barra Lateral de Fichas** (alterne mediante el icono de barra lateral) para explorar su inventario:

- **Buscar** fichas por nombre
- **Filtrar** por tipo de ficha
- **Arrastrar una ficha** al lienzo — aparece como una forma estilizada con el nombre y el icono de tipo de la ficha
- Use el **Diálogo de Selección de Fichas** para búsqueda avanzada y selección múltiple

### Crear Fichas desde el Diagrama

Si dibuja una forma que no corresponde a una ficha existente, puede crear una directamente:

1. Seleccione la forma no vinculada
2. Haga clic en **Crear Ficha** en el panel de sincronización
3. Complete el tipo, nombre y campos opcionales
4. La forma se vincula automáticamente a la nueva ficha

### Crear Relaciones desde Conectores

Cuando dibuja un conector entre dos formas de fichas:

1. Seleccione el conector
2. Aparece el diálogo del **Selector de Relaciones**
3. Elija el tipo de relación (solo se muestran los tipos válidos para los tipos de fichas conectados)
4. La relación se crea en el inventario y el conector se marca como sincronizado

### Sincronización de Fichas

El **Panel de Sincronización** mantiene su diagrama e inventario sincronizados:

- **Fichas sincronizadas** — Las formas vinculadas a fichas del inventario muestran un indicador verde de sincronización
- **Formas no sincronizadas** — Las formas aún no vinculadas a fichas se marcan para acción
- **Expandir/contraer grupos** — Navegue por grupos jerárquicos de fichas directamente en el lienzo

### Vinculación a Iniciativas

Los diagramas pueden vincularse a fichas de **Iniciativa**, haciéndolos aparecer en el módulo de [Entrega EA](delivery.es.md) junto con los documentos SoAW. Esto proporciona una vista completa de todos los artefactos de arquitectura para una iniciativa determinada.
