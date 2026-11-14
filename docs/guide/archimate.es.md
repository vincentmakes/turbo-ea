# Diagramas ArchiMate

El editor **ArchiMate** dibuja diagramas [ArchiMate 3](https://pubs.opengroup.org/architecture/archimate3-doc/) sobre sus fichas: usted coloca elementos de la notación estándar (Business Process, Application Component, Node, etc.), los conecta con las relaciones que permite el lenguaje y, si lo desea, vincula cada elemento a una ficha de su inventario. Un diagrama se guarda como un **ArchiMate Model Exchange File** (el formato XML de The Open Group, versión 3.1), de modo que puede intercambiarse con otras herramientas ArchiMate.

!!! warning "Estado de la versión"
    Esta versión incluye la base de ArchiMate como un **entorno de pruebas para administradores**. El módulo está desactivado de forma predeterminada, los diagramas no aparecen en el menú [Diagramas](diagrams.md) y todavía no pueden publicarse ni incrustarse. Consulte los [Límites conocidos](#known-limits).

La primera fila muestra el nombre del diagrama, las opciones de color y contenido de las fichas y la sincronización. Al sincronizar se actualizan los datos de las fichas vinculadas. La segunda fila contiene las herramientas de dibujo, el zoom, la exportación SVG y el panel de propiedades. Usa **Cuadrícula de puntos** para mostrar u ocultar los puntos del fondo. El navegador recuerda tu elección para cada diagrama.

## Activar el módulo

1. Abra **Admin → Configuración** y busque la tarjeta **Diagramas ArchiMate** (junto a los demás interruptores de módulos).
2. Actívela. La tarjeta muestra **ArchiMate está activado**.
3. Puede desactivarla en cualquier momento. Los diagramas se conservan; mientras el módulo está desactivado las páginas son inaccesibles y quien siga un enlace directo ve el marcador estándar de «módulo desactivado».

## Abrir el entorno de pruebas

Mientras el módulo está activado, los diagramas ArchiMate se crean y se abren desde la página **Diagramas** y desde la pestaña **Recursos** de cualquier ficha a la que hagan referencia. `/admin/architectureStudio` sigue siendo la lista de sus diagramas ArchiMate, donde puede crearlos, abrirlos y eliminarlos; hace falta un permiso sobre al menos una capa ArchiMate y el módulo activado. En el editor, **Atrás** vuelve a la página de la que venía.

<!-- Planned screenshot (added with the screenshot capture): 102_archimate_sandbox -->

## Su primer diagrama

1. En el entorno de pruebas, escriba un **Nombre** en **Nuevo diagrama ArchiMate** y pulse **Crear**. Se abre el editor.
2. **Suelte elementos.** La paleta enumera los tipos de elemento agrupados por capa (Estrategia, Negocio, Aplicación, Tecnología, Física, Motivación, Implementación y migración, Otros). Arrastre una entrada al lienzo o use el teclado: sitúese en una entrada y pulse **Enter** o **Space** para soltar el elemento en el centro del área visible. Un elemento nuevo abre su nombre para editarlo de inmediato.
3. **Dibuje una relación.** Seleccione un elemento: el panel contextual que lo rodea ofrece entradas **Dibujar** *relación*. Elija una y haga clic en el elemento de destino. Solo pueden conectarse los pares que permite la tabla de relaciones de ArchiMate: una entrada se ofrece únicamente si el lenguaje admite esa relación desde este elemento hacia algún tipo de elemento, y se rechaza un destino que la tabla no permite. Seleccione una conexión para cambiar su **tipo de acceso** (en Access) o su dirección (en Association).
4. **Vincule un elemento a una ficha.** Seleccione el elemento y use el panel contextual:
    - **Vincular a una ficha** abre un selector limitado a los tipos de ficha que corresponden a este tipo de elemento (consulte [La asignación](#mapping)).
    - **Crear una ficha** pide un tipo de ficha y un nombre, crea la ficha y la vincula en un solo paso.
    - **Abrir la ficha vinculada** y **Desvincular la ficha** aparecen cuando hay una ficha vinculada.

    Los vínculos son siempre explícitos. Soltar un elemento **nunca** crea una ficha, y quitar un elemento del diagrama (**Quitar del diagrama**) **nunca** elimina una ficha. Al guardar, el conjunto de fichas a las que se vincula el diagrama se sincroniza, como en los demás diagramas.
5. **Guarde.** El editor guarda por sí solo tres segundos después del último cambio; el botón **Guardar** guarda al instante. El estado muestra *Guardando…*, *Guardado* o *Cambios sin guardar*.

!!! warning "Un guardado fallido sigue visible"
    Si falla un guardado, el error permanece visible con un botón **Reintentar**, el diagrama sigue marcado como sin guardar y no se descarta nada en silencio. Salir de la página (cerrar la pestaña, usar el botón Atrás del navegador o abrir otra página de la aplicación) con cambios sin guardar o fallidos pide confirmación antes.

## La asignación {#mapping}

La **asignación** (mapping) indica a qué concepto de ArchiMate corresponde un tipo de ficha, un subtipo o un tipo de relación de Turbo EA. El editor la lee para decidir qué fichas pueden vincularse a qué elemento. Cada tipo de ficha, subtipo y tipo de relación lleva un tipo de elemento o de relación de ArchiMate; una relación lleva además un **indicador de dirección** (si está activado, la relación de ArchiMate se dibuja desde la ficha de destino hacia la de origen; por ejemplo, «Organización *usa* Aplicación» es una relación *Serving* de ArchiMate de la aplicación a la organización) y, en Access, un **tipo de acceso**.

!!! note
    En esta versión la asignación es **de solo lectura**: contiene los valores predeterminados que se muestran a continuación. La pantalla de administración para modificarla (**ARCHI MAP** en **Admin → Metamodelo**) llegará más adelante. Esta versión no crea ni modifica relaciones entre fichas a partir de una relación dibujada.

Los nombres de elementos y relaciones son los del formato de intercambio de The Open Group. Un tipo de ficha cuyo elemento está vacío (`—`) no tiene asignación predeterminada, por lo que sus fichas no pueden vincularse hasta que se defina un tipo de elemento. Un subtipo usa su propia asignación si la tiene y, si no, la del tipo de ficha.

### Tipos de ficha y subtipos

| Tipo de ficha | Elemento ArchiMate |
|---|---|
| Objetivo | `Goal` |
| Objetivo › Objetivo de negocio | `Goal` |
| Objetivo › Hito de valor | `Assessment` |
| Plataforma | `Grouping` |
| Iniciativa | `WorkPackage` |
| Organización | `BusinessActor` |
| Organización › Región | `Location` |
| Capacidad de negocio | `Capability` |
| Contexto de negocio | — |
| Contexto de negocio › Proceso | `BusinessProcess` |
| Contexto de negocio › Cadena de valor | `ValueStream` |
| Contexto de negocio › Recorrido del cliente | `BusinessProcess` |
| Contexto de negocio › Producto de negocio | `Product` |
| Contexto de negocio › Capacidad ESG | `Capability` |
| Proceso de negocio | `BusinessProcess` |
| Proceso de negocio › Categoría de proceso | `BusinessFunction` |
| Proceso de negocio › Grupo de procesos | `BusinessFunction` |
| Aplicación | `ApplicationComponent` |
| Interfaz | `ApplicationInterface` |
| Objeto de datos | `BusinessObject` |
| Componente TI | `Node` |
| Componente TI › Software | `SystemSoftware` |
| Componente TI › Hardware | `Device` |
| Componente TI › SaaS | `TechnologyService` |
| Componente TI › PaaS | `TechnologyService` |
| Componente TI › IaaS | `TechnologyService` |
| Componente TI › Servicio | `TechnologyService` |
| Componente TI › Modelo de IA | `SystemSoftware` |
| Categoría tecnológica | `Grouping` |
| Proveedor | `BusinessActor` |

### Tipos de relación

En una relación Access, `crud` significa que el tipo de acceso sigue los indicadores Create/Read/Update/Delete de la propia relación: solo lectura da Read, cualquier creación, actualización o eliminación da Write, ambas dan Read/Write y ninguna da Access simple. Las relaciones «sucede a» existen para cada tipo de ficha que las tiene y se asignan a Association, salvo la de Business Context, que tiene su propia fila en la tabla.

| Relación | Relación ArchiMate | Nota |
|---|---|---|
| Objetivo → Capacidad de negocio, *mejora* | `Association` | — |
| Plataforma → Objetivo, *apoya* | `Influence` | — |
| Plataforma → Aplicación, *ejecuta* | `Aggregation` | — |
| Plataforma → Componente TI, *implementa* | `Aggregation` | — |
| Iniciativa → Objetivo, *apoya* | `Influence` | — |
| Iniciativa → Plataforma, *afecta* | `Association` | — |
| Iniciativa → Capacidad de negocio, *mejora* | `Association` | — |
| Iniciativa → Aplicación, *afecta* | `Association` | — |
| Iniciativa → Interfaz, *afecta* | `Association` | — |
| Iniciativa → Objeto de datos, *afecta* | `Association` | — |
| Iniciativa → Componente TI, *afecta* | `Association` | — |
| Organización → Objetivo, *posee* | `Association` | — |
| Organización → Iniciativa, *posee* | `Assignment` | — |
| Organización → Contexto de negocio, *posee* | `Association` | — |
| Organización → Aplicación, *utiliza* | `Serving` | dibujada del destino al origen |
| Organización → Componente TI, *posee* | `Association` | — |
| Aplicación → Capacidad de negocio, *apoya* | `Realization` | — |
| Aplicación → Contexto de negocio, *apoya* | `Association` | — |
| Aplicación → Interfaz, *provee / consume* | `Association` | — |
| Aplicación → Objeto de datos, *CRUD* | `Access` | tipo de acceso según los indicadores CRUD |
| Aplicación → Componente TI, *utiliza* | `Serving` | dibujada del destino al origen |
| Componente TI → Categoría tecnológica, *pertenece a* | `Aggregation` | dibujada del destino al origen |
| Componente TI → Plataforma, *implementa* | `Aggregation` | dibujada del destino al origen |
| Interfaz → Objeto de datos, *transfiere* | `Association` | — |
| Interfaz → Componente TI, *utiliza* | `Association` | — |
| Proveedor → Iniciativa, *apoya* | `Association` | — |
| Proveedor → Aplicación, *ofrece* | `Association` | — |
| Proveedor → Componente TI, *ofrece* | `Association` | — |
| Contexto de negocio → Capacidad de negocio, *está asociado con* | `Association` | — |
| Proceso de negocio → Capacidad de negocio, *apoya* | `Realization` | — |
| Proceso de negocio → Aplicación, *es apoyado por* | `Serving` | dibujada del destino al origen |
| Proceso de negocio → Objeto de datos, *utiliza* | `Access` | tipo de acceso según los indicadores CRUD |
| Proceso de negocio → Componente TI, *utiliza* | `Serving` | dibujada del destino al origen |
| Proceso de negocio → Proceso de negocio, *depende de* | `Association` | — |
| Proceso de negocio → Proceso de negocio, *invoca* | `Triggering` | — |
| Proceso de negocio → Organización, *pertenece a* | `Assignment` | dibujada del destino al origen |
| Proceso de negocio → Iniciativa, *es afectado por* | `Association` | — |
| Proceso de negocio → Objetivo, *apoya* | `Influence` | — |
| Proceso de negocio → Contexto de negocio, *realiza* | `Realization` | — |
| Objetivo → Contexto de negocio, *es objetivo de* | `Association` | — |
| Contexto de negocio → Contexto de negocio, *sucede a* | `Triggering` | dibujada del destino al origen |

Haz clic con el botón derecho en un conector y elige **Recto** u **Ortogonal**. El conector mantiene su trazado al mover un nodo y al guardar y volver a abrir el diagrama.

## El archivo Exchange {#exchange-file}

La barra de herramientas ofrece **Exportar como archivo Exchange** e **Importar un archivo Exchange**, además de **Exportar como SVG** para obtener una imagen.

- **Exportar** descarga el diagrama como ArchiMate Model Exchange File (`.xml`, formato 3.1).
- **Importar** reemplaza todo el contenido del diagrama abierto, tras una confirmación (**¿Reemplazar el diagrama?**). Los diagramas creados con otras herramientas (como Archi) pueden leerse si siguen el formato de The Open Group.
- Los archivos de más de 5 MB se rechazan, igual que los que contienen una declaración DOCTYPE o de entidad.

**Lo que no se conserva al importar:**

- **Carpetas** (la sección `organizations`): se descartan y el editor se lo indica.
- **Notas, grupos y conexiones simples** de otras herramientas: se ignoran las etiquetas y los contenedores sin un elemento detrás, así como las conexiones sin una relación.
- **Tipos de propiedad distintos de string**: cada definición de propiedad se lee como cadena de texto.
- **Otros idiomas de un nombre**: solo se conserva un nombre por elemento, relación y vista.
- Las fuentes y otros estilos más allá de lo básico no se conservan.

## Comprobar el modelo

El botón **Comprobar el modelo** de la barra de herramientas envía el diagrama actual al servidor, que lo valida con las reglas de intercambio de The Open Group y enumera cada problema que encuentra (como máximo 100). Cada mensaje tiene un código; el símbolo `…` representa el nombre o el identificador afectado:

| Code | Mensaje |
|---|---|
| `too_large` | El modelo supera los 5 MB. |
| `xml_invalid` | El modelo no es un XML bien formado. |
| `dtd_forbidden` | No se permiten las declaraciones DOCTYPE ni de entidad. |
| `wrong_root` | El elemento raíz no es un modelo ArchiMate. |
| `missing_identifier` | Un elemento, una relación o un nodo del diagrama no tiene identificador. |
| `unknown_element_type` | Tipo de elemento desconocido: … |
| `unknown_relationship_type` | Tipo de relación desconocido: … |
| `unknown_access_type` | Tipo de acceso desconocido en … |
| `duplicate_identifier` | Identificador duplicado: … |
| `dangling_source` | La relación … parte de algo que no existe. |
| `dangling_target` | La relación … termina en algo que no existe. |
| `relationship_not_allowed` | ArchiMate no permite la relación …: ni entre estos dos elementos, ni de una relación hacia sí misma. |
| `dangling_element_ref` | El nodo del diagrama … muestra un elemento que no existe. |
| `dangling_relationship_ref` | La conexión del diagrama … muestra una relación que no existe. |
| `connection_endpoint_mismatch` | La conexión del diagrama … no une los nodos de su relación. |

La comprobación de relaciones también rechaza una relación que apunta a otra relación, salvo que sea una Association, Aggregation o Composition. Si no hay nada que informar, el cuadro de diálogo dice **No se encontraron problemas.**

## Atajos de teclado

Pulse **Atajos de teclado** en la barra de herramientas para ver la lista. Haga clic primero en el lienzo para que tenga el foco.

| Acción | Atajo |
|--------|-------|
| Deshacer | `Ctrl+Z` |
| Rehacer | `Ctrl+Y` / `Ctrl+Shift+Z` |
| Copiar | `Ctrl+C` |
| Pegar | `Ctrl+V` |
| Eliminar | `Delete` / `Backspace` |
| Renombrar | `F2` / `Enter` |
| Seleccionar todo | `Ctrl+A` |
| Acercar | `Ctrl++` |
| Alejar | `Ctrl+-` |
| Ajustar a la pantalla | `Ctrl+0` |

En la paleta, `Enter` o `Space` sobre una entrada enfocada suelta ese elemento.

## Límites conocidos {#known-limits}

- **Se edita una sola vista por archivo.** Si un archivo importado contiene varias vistas, se edita la primera y las demás se conservan intactas al guardar.
- **Las relaciones entre relaciones** (una Association, Aggregation o Composition que apunta a otra relación) se leen y se escriben, y el comprobador las acepta, pero no se dibujan.
- **Dibujar una relación requiere el ratón.** El teclado puede soltar elementos, pero no conectarlos.
- **Las colocaciones con teclado se apilan.** Cada elemento soltado con `Enter` o `Space` cae en el centro del área visible, así que las colocaciones sucesivas se superponen hasta que las mueva.
- **Todavía no se puede publicar.** Los diagramas ArchiMate no pueden publicarse ni incrustarse y no aparecen en el menú **Diagramas**; se accede a ellos desde la lista del entorno de pruebas o desde la pestaña **Recursos** de una ficha a la que hagan referencia.
- **Los conectores (junctions) no tienen etiqueta.** Un conector And u Or es un simple punto.
- La asignación es de solo lectura (consulte [La asignación](#mapping)) y las carpetas se descartan al importar (consulte [El archivo Exchange](#exchange-file)).

---

ArchiMate® es una marca registrada de The Open Group. Turbo EA dibuja la notación ArchiMate y no está certificado por The Open Group.
