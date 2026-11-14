# Informes

Turbo EA incluye un potente módulo de **informes visuales** que permite analizar la arquitectura empresarial desde diferentes perspectivas. Todos los informes pueden ser [guardados para reutilización](saved-reports.es.md) con sus filtros y ajustes de visualización actuales.

![Menú de Informes Disponibles](../assets/img/es/09_menu_informes.png)

## Informe de Portafolio

![Informe de Portafolio](../assets/img/es/10_informe_portafolio.png)

El **Informe de Portafolio** (**Informes → Portafolio de aplicaciones**) muestra sus aplicaciones como chips de color, agrupados en cajas. Dos opciones de la barra de herramientas lo controlan:

- **Agrupar por** — cualquier campo de selección única o de sí/no del tipo de ficha (por ejemplo, Criticidad de negocio, Modelo TIME), o un tipo de ficha relacionado (por ejemplo, Organización, Capacidad de negocio). Cada valor se convierte en una caja con un recuento y una barra que muestra su mezcla de colores; las aplicaciones sin valor van a una caja *No asignado a ningún …*.
- **Colorear aplicaciones por** — cualquier campo de selección, de selección múltiple o de sí/no (por ejemplo, Modelo TIME), o *Sin color*.

Junto a ellas se encuentran un cuadro **Buscar**, los filtros plegables (**Relacionado por**, **Etiquetas**, **Campos**, **Subtipos de relación**), el selector de columnas y el conmutador **Vista de gráfico** / **Vista de tabla**, que lista las mismas fichas en una tabla ordenable.

**Colorear y filtrar por campos de sí/no y de selección múltiple** — Cualquier campo de selección, de selección múltiple o de sí/no del tipo de ficha puede colorear las fichas y filtrarlas — aquí, en el Portafolio flexible, en el Mapa de capacidades (*Colorear apps por*), en la vista por rango de fechas del Informe de ciclo de vida y en el menú *Colorear por* de un diagrama. Un campo de sí/no se muestra como **Sí** y **No**, una ficha con varios valores de un campo de selección múltiple aparece como **Múltiples**, y una opción que un administrador dejó sin color recibe un color propio en la leyenda en lugar del gris de *No definido*. Los campos de sí/no también pueden agrupar las fichas — aquí, en la tabla del Informe de costos y en el [Inventario](inventory.md); un campo de selección múltiple no, porque una ficha con dos valores pertenecería a dos grupos.

**Filtrar por subtipo** — Cuando el tipo de ficha tiene subtipos, la fila de filtros **Campos** empieza con un filtro **Subtipo**. Elija uno o varios subtipos, o *(vacío)* para las fichas que no tienen ninguno. El filtro se guarda con el informe y lo traslada **Ver en el inventario**.

Un uso típico: agrupar por **Criticidad de negocio** y colorear por **Modelo TIME**. Las aplicaciones críticas marcadas como *Migrar* son sus primeras prioridades de modernización, y las aplicaciones administrativas marcadas como *Eliminar* o *Migrar* son sus candidatas a retirada y consolidación. La [Guía para principiantes EA](../beginners-guide/your-first-analysis.md) muestra cómo derivar el Modelo TIME de las valoraciones de idoneidad mediante un cálculo.

### Análisis IA del portafolio

Cuando la IA está configurada y los análisis de portafolio están habilitados por un administrador, el informe de portafolio muestra un botón **Análisis IA**. Al hacer clic, se envía un resumen de la vista actual al proveedor de IA, que devuelve análisis estratégicos sobre riesgos de concentración, oportunidades de modernización, preocupaciones del ciclo de vida y equilibrio del portafolio. El panel de análisis es plegable y puede regenerarse después de cambiar filtros o agrupaciones.

### Del informe al inventario

Al hacer clic en un grupo se abre un panel con las tarjetas de ese grupo. Su botón **Ver en el inventario** abre el inventario exactamente en ese segmento. Cuando el informe está agrupado por un campo propio del tipo de tarjeta, el inventario llega agrupado por el mismo campo: el grupo pulsado aparece desplegado y el resto plegado (los recuentos siguen visibles), y se trasladan la búsqueda y los filtros de atributos, relaciones y etiquetas del informe — listo para «seleccionar todo» y la [edición masiva](inventory.md#mass-edit). Al agrupar por un tipo de tarjeta relacionado (por ejemplo, Organización), el inventario llega filtrado a esa tarjeta relacionada. El botón se oculta cuando los *grupos anidados* están activos: un subárbol agregado no se corresponde con ningún filtro único del inventario.

### Plegar los filtros

La fila **Filtros** se puede plegar: haga clic en su cabecera para ocultar los controles de filtrado y devolver al gráfico el espacio vertical. El ajuste se guarda junto con el resto de la configuración del informe, de modo que un informe se vuelve a abrir tal como lo dejó. Mientras está plegada, la cabecera sigue mostrando cuántos filtros hay activos y **Limpiar todo** sigue estando a mano — una sección plegada nunca oculta el hecho de que los datos están filtrados.

### Viaje en el tiempo

El control deslizante de la línea de tiempo lleva los mismos instrumentos de transformación que el [Informe de Dependencias](#informe-de-dependencias): marcas en cada fecha en la que una aplicación entra en producción (azul) o se retira (rojo), pastillas que nombran las aplicaciones que cambian mientras el control permanece sobre una marca, flechas que saltan de cambio en cambio, y chips que resumen la transformación al mirar hacia el futuro («+4 se incorporan · −7 se retiran» — incluidos también en las cabeceras de impresión y exportación). Al hacer clic en una marca o en una pastilla se destacan las aplicaciones que cambian en esa fecha: el resto de la vista se atenúa mientras parpadean, y una aplicación ya desaparecida en la fecha seleccionada se muestra solo durante el parpadeo y vuelve a ocultarse después.

## Portafolio flexible

![Portafolio flexible — portafolio de Objetos de Datos agrupado por Aplicación y coloreado por Sensibilidad de Datos](../assets/img/es/57_informe_portafolio_flexible.png)

El **Portafolio flexible** usa los mismos controles que el Portafolio de aplicaciones pero añade un selector de **Tipo de tarjeta** en la parte superior de la barra de herramientas. Permite analizar un portafolio de Capacidades de Negocio, Iniciativas, Componentes de TI o cualquier otro tipo de tarjeta visible con la misma experiencia de agrupación, coloreado y filtros.

La captura muestra un caso de uso típico: elija **Objeto de Datos** como tipo de tarjeta, **Agrupar por → Aplicación** para ver qué aplicación posee qué datos y **Colorear por → Sensibilidad de Datos** para identificar de un vistazo dónde residen los datos confidenciales.

Cambiar el tipo de tarjeta restablece las selecciones de agrupación, color y filtros (hacen referencia a claves de campo que no existen en el nuevo tipo) y el informe se recarga con los campos, relaciones y etiquetas aplicables al tipo elegido. El informe comparte el mismo permiso que el Portafolio de aplicaciones (`reports.portfolio`) y se guarda de forma independiente.

### Subtipos de relación

Cuando las relaciones de una tarjeta llevan un valor de «tipo» —por ejemplo el **tipo de uso** (Propietario / Usuario / Parte interesada) en las relaciones Organización→Aplicación, o el **tipo de soporte** en las relaciones Aplicación→Capacidad de negocio— puede colorear las tarjetas por ese valor y filtrar por él. **Agrupe el informe por el tipo de tarjeta relacionado** para usarlos (p. ej. *Agrupar por → Organización* para habilitar el *tipo de uso*): el subtipo aparece entonces bajo el grupo **Subtipos de relación** en el desplegable *Colorear por* y como su propia fila de filtros. Como cada tarjeta se muestra bajo una tarjeta relacionada, se colorea según *esa* relación: una aplicación que es *Usuario* de una organización aparece como Usuario ahí, aunque pertenezca a otra.

### Incluir subtarjetas

Cuando un tipo de tarjeta relacionado tiene jerarquía (como Business Capability u Organización), la fila **Relacionado por** incluye un interruptor **Incluir subtarjetas**. Al activarlo, una selección abarca también todo lo que está por debajo: una capacidad padre encuentra entonces las tarjetas vinculadas a cualquiera de sus subcapacidades, y los padres sin vínculo directo propio también pueden seleccionarse. El interruptor se guarda con el informe y se aplica también al informe de ciclo de vida. Mientras amplía una selección, el botón **Ver en el inventario** del panel de grupo se oculta, porque el inventario solo filtra por vínculos directos.

### Grupos anidados

Al agrupar por un tipo de tarjeta relacionado que admite jerarquía (como Capacidad de negocio u Organización), aparece un interruptor **Grupos anidados** junto al selector *Agrupar por*. Actívelo para mostrar los grupos como cajas anidadas siguiendo la jerarquía padre/hijo del tipo relacionado, como en el Mapa de Capacidades. El selector **Profundidad de visualización** controla cuántos niveles se expanden: cada tarjeta aparece bajo su grupo visible más profundo, y los grupos por debajo del límite de profundidad suben sus tarjetas al ancestro visible más cercano. Las ramas sin tarjetas se ocultan.

### Elegir el número de columnas

La cuadrícula de tarjetas de los informes **Cartera**, **Cartera flexible**, **Mapa de capacidades** y **Mapa de procesos** tiene un **selector de columnas** en la barra de herramientas: tres botones para una, dos o tres columnas. Elija menos columnas cuando las tarjetas contengan mucha información y deban ser lo bastante anchas para leerse; elija tres para ver más del panorama de una sola vez. La elección se recuerda por informe, viaja con un [informe guardado](saved-reports.md) y se utiliza al imprimir o exportar. Las pantallas estrechas siguen reduciéndose por sí solas a una o dos columnas. La elección se propaga hacia abajo: cada nivel por debajo del primero recibe una columna menos. Con una columna, el nivel 2 se muestra en tres y el nivel 3 en dos; con tres columnas, todo lo inferior permanece apilado a ancho completo. Un nivel sigue reduciéndose por sí solo cuando una tarjeta es realmente demasiado estrecha.

## Mapa de Capacidades

Al hacer clic en una capacidad se abre un panel lateral con todas las aplicaciones de su subárbol. En el nivel más bajo, el panel ofrece **Ver en el inventario**, que lleva a las aplicaciones vinculadas a ella.


![Mapa de Capacidades de Negocio](../assets/img/es/11_mapa_capacidades.png)

El **Mapa de Capacidades** muestra un **mapa de calor** jerárquico de las capacidades de negocio de la organización. Cada bloque representa una capacidad, con:

- **Jerarquía** — Las capacidades principales contienen sus sub-capacidades
- **Coloración por mapa de calor** — Los bloques se colorean según una métrica seleccionada (por ejemplo, número de aplicaciones que las soportan, calidad de datos promedio o nivel de riesgo)
- **Clic para explorar** — Haga clic en cualquier capacidad para profundizar en sus detalles y aplicaciones de soporte

**Limitar a capacidades concretas** — De forma predeterminada, el mapa dibuja todas las capacidades. Use el chip de capacidad de la barra de herramientas para abrir un selector y elegir una o varias capacidades; el mapa mostrará entonces solo esas y todo lo que hay debajo. Las subcapacidades se incluyen automáticamente, así que elegir una capacidad de primer nivel le da toda su rama. La **Profundidad de visualización** se cuenta desde las capacidades seleccionadas, por lo que *Nivel 2* siempre significa dos niveles por debajo de lo que está viendo. El alcance se guarda con el informe, de modo que un informe guardado se vuelve a abrir en la misma rama.

**Viaje en el tiempo** — El control deslizante de la línea de tiempo lleva los mismos instrumentos de transformación que el [Informe de Dependencias](#informe-de-dependencias): marcas en cada fecha en la que una aplicación entra en producción (azul) o se retira (rojo), pastillas que nombran las aplicaciones que cambian mientras el control permanece sobre una marca, flechas que saltan de cambio en cambio, y chips que resumen la transformación al mirar hacia el futuro (incluidos también en las cabeceras de impresión y exportación). Al hacer clic en una marca o en una pastilla se destaca el cambio: con **Mostrar aplicaciones** activado, los chips de las aplicaciones que cambian parpadean mientras el resto se atenúa, y una aplicación ya desaparecida en la fecha seleccionada se muestra solo durante el parpadeo; con el interruptor desactivado, el foco recae sobre los bloques de capacidad que contienen las aplicaciones que cambian — azul donde solo se incorporan, rojo donde solo se retiran, morado donde ocurren ambas cosas.

**Atribución del costo total** — Con la métrica **Costo total**, una aplicación que da soporte a varias capacidades cuenta íntegramente en cada una de ellas (**Completa**) o se reparte a partes iguales entre ellas (**A partes iguales**). Las subcapacidades se agregan en sus capacidades padre sin contar dos veces una aplicación. El selector **Atribución** aparece junto a la Métrica del mapa de calor solo para Costo total y se guarda con el informe.

**Plegar los filtros** — La fila **Filtros de aplicaciones** se puede plegar; haga clic en su cabecera para recuperar el espacio. El estado se guarda con el informe, el recuento de filtros activos permanece visible en la cabecera plegada y **Limpiar todo** sigue accesible sin necesidad de desplegar primero.

## Informe de Ciclo de Vida

![Informe de Ciclo de Vida](../assets/img/es/12_ciclo_vida.png)

El **Informe de Ciclo de Vida** muestra una **visualización de línea temporal** de cuándo se introdujeron los componentes tecnológicos y cuándo está planificado su retiro. Es crítico para:

- **Planificación de retiro** — Vea qué componentes se acercan al fin de vida
- **Planificación de inversión** — Identifique brechas donde se necesita nueva tecnología
- **Coordinación de migración** — Visualice períodos superpuestos de entrada y salida de fase

Los componentes se muestran como barras horizontales que abarcan sus fases de ciclo de vida: Plan, Fase de Entrada, Activo, Fase de Salida y Fin de Vida.

**Limitar a tarjetas concretas** — Una vez elegido un tipo de tarjeta, el chip contiguo abre un selector: elija una o varias tarjetas y la línea de tiempo mostrará solo esas y todo lo que hay debajo. Las tarjetas hijas se incluyen automáticamente. El chip permanece desactivado mientras el selector esté en *Todos los tipos*, porque un alcance necesita una única jerarquía.

**Filtrar** — Una vez elegido un tipo de tarjeta, el informe ofrece la misma fila de **Filtros** que el **Portafolio flexible**: tarjetas relacionadas (con *Incluir subtarjetas*), etiquetas, el subtipo de la tarjeta y sus campos de selección, y subtipos de relación, además de un cuadro de búsqueda. Los filtros distintos se combinan (una tarjeta debe cumplirlos todos), mientras que los valores elegidos dentro de un mismo filtro son alternativas. Un rótulo muestra cuántas tarjetas coinciden, y **Limpiar todo** quita todos los filtros. Los filtros se guardan con el informe y se nombran uno a uno en el encabezado de una impresión o exportación, para que el público sepa qué abarca la línea de tiempo. Por ejemplo, elija sus capacidades operativas con *Incluir subtarjetas* activado y la etiqueta *Desarrollo interno* para revisar solo las aplicaciones propias que sostienen las operaciones principales — una herramienta de gastos como Concur sigue en el inventario, pero sale de esta vista. Con *Todos los tipos* los filtros no están disponibles, porque leen los campos, relaciones y etiquetas de un único tipo de tarjeta.

**Ordenar** — El menú **Ordenar por** ordena la línea de tiempo y la tabla por igual: por nombre, tipo, subtipo, fase actual, la fecha de una fase (Planificación, Introducción, Activo, Retiro, Fin de vida) o uno de los campos de selección única del tipo de tarjeta, como la criticidad de negocio, que sigue el orden de sus opciones en lugar del alfabético. En la vista de rango de fechas ofrece en su lugar la fecha de inicio, la fecha de fin y el campo de color. La flecha contigua alterna entre ascendente y descendente; las tarjetas sin valor van siempre al final, sea cual sea el sentido. Hacer clic en un encabezado de columna de la tabla ordena del mismo modo. El orden se guarda con el informe, y cualquier orden distinto del nombre aparece en el encabezado de la exportación.

## Informe de Dependencias

![Informe de Dependencias](../assets/img/es/13_dependencias.png)

El **Informe de Dependencias** visualiza las **conexiones entre componentes** como un grafo de red. Los nodos representan fichas y las aristas representan relaciones. Características:

- **Control de profundidad** — Limite cuántos saltos desde el nodo central se muestran (limitación de profundidad BFS)
- **Filtrado por tipo** — Muestre solo tipos de fichas y tipos de relaciones específicos
- **Exploración interactiva** — Haga clic en cualquier nodo para recentrar el grafo en esa ficha
- **Análisis de impacto** — Comprenda el radio de impacto de los cambios en un componente específico
- **Viaje en el tiempo** — Una vez centrado en una ficha (o en la vista de tabla), arrastre el control deslizante de la línea de tiempo para ver el panorama tal como está en cualquier fecha. Las fichas que aún no están en producción se ocultan: una ficha entra en el panorama en su fecha **Activo**, de modo que si esa fecha aún está por llegar, o falta por completo, la ficha queda fuera de la vista predeterminada. Las fichas que **se incorporan** entre hoy y una fecha futura son sencillamente parte del panorama en esa fecha: llevan un contorno morado y ninguna etiqueta, porque el viaje en el tiempo muestra el estado tal como será. Las fichas **retiradas** permanecen en el diagrama — atenuadas y con la etiqueta *RETIRADA* — en cualquier fecha posterior a su retirada, de modo que una transformación muestra tanto lo que elimina como lo que deja. El interruptor **Conservar tarjetas retiradas**, en la barra de herramientas, las oculta para mostrar solo las fichas activas en la fecha seleccionada. Su reflejo, **Previsualizar tarjetas planificadas**, muestra las fichas que aún no han comenzado — atenuadas y con la etiqueta *PRÓXIMA* — en cualquier fecha anterior a su inicio, de modo que incluso una vista presente o pasada permite ver lo que viene. La línea de tiempo está marcada con cada fecha en la que las fichas del diagrama mostrado entran en producción (azul) o se retiran (rojo); haga clic en una marca para llevar el control deslizante directamente a ese cambio, o pase de cambio en cambio con las flechas junto al control. Mientras el control deslizante permanece sobre una marca, las fichas que esta cuenta se enumeran como pastillas bajo las marcas, agrupadas tras un **+** las que entran en producción y tras un **−** las que se retiran — cada pastilla lleva el color de su tipo de ficha y, al hacer clic, se resalta solo esa ficha. Cada marca es azul cuando allí solo entran fichas en producción, roja cuando solo se retiran y morada cuando ocurren ambas cosas. Cuando los cambios quedan próximos entre sí, la línea de tiempo los fusiona en una sola marca, dibujada más ancha y etiquetada con el intervalo que abarca; una ficha que entra en producción y se retira dentro de ese intervalo aparece en ambos lados. Las flechas tratan una marca fusionada como una única parada: una pulsación la supera por completo en lugar de recorrer una a una las fechas que abarca. Cuando el control se sitúa sobre una marca fusionada, el panorama es el del **final** de su intervalo — todo lo que abarca ya ha ocurrido — y la fecha junto al control nombra ese intervalo en lugar de un solo día. Al hacer clic —o al saltar con las flechas— también se resaltan las fichas implicadas: el lienzo se atenúa un instante mientras parpadean en el color de la marca, y una ficha retirada oculta por **Conservar tarjetas retiradas** se muestra solo durante el parpadeo. Al mirar hacia el futuro, unas fichas sobre el control resumen la transformación (+4 se incorporan · −7 se retiran). Las relaciones hacia fichas retiradas se muestran con guiones rojos — las dependencias que la transformación rompe — y mientras el control se sitúa sobre una marca, las fichas que se retiran allí permanecen en el diagrama — atenuadas y con la etiqueta *RETIRADA* — incluso con **Conservar tarjetas retiradas** desactivado. Las fichas que permanecen se marcan allí donde cambian sus conexiones: un icono rojo de enlace roto donde una vecina se retira, uno azul donde una vecina entra en producción, y ambos cuando ocurren las dos cosas. La marca los sostiene: al salir de ella desaparecen, de modo que una retirada ya no marca a sus vecinas en todas las fechas posteriores. El control se aplica a todas las vistas y la fecha se guarda con el informe.

La ficha que sitúe en el centro determina cuánto verá: por eso el selector enumera primero, en cada tipo, las fichas mejor conectadas. Una capacidad suele ser la elección más reveladora, porque es el único tipo de ficha que alcanza en un solo salto los objetivos por encima y las aplicaciones por debajo. El selector enumera **todas las fichas del inventario** — salvo las archivadas — sea cual sea la fecha en la que esté la línea de tiempo: aquí es donde elige qué mirar, y el control deslizante está oculto en esta etapa, así que una ficha ya retirada, o que aún no ha entrado en producción, sigue estando disponible para centrarse en ella. Las fichas que han alcanzado el **final de su vida útil a día de hoy** (no en la fecha de la línea de tiempo) llevan la etiqueta *RETIRADA* con su fecha de fin de vida; el interruptor **Ocultar las de fin de vida útil**, junto a los chips de tipo, las filtra. Una vez centrada una ficha, la lista **Centrar en** de la barra de herramientas permite pasar a otra: esa lista es **alfabética**, porque a esas alturas ya sabe qué ficha busca — los dos órdenes difieren a propósito.

### Layered Dependency View (vista de dependencias por capas)

![Layered Dependency View](../assets/img/es/13b_dependencias_c4.png)

Cambie a la **Layered Dependency View** utilizando los botones de modo de vista en la barra de herramientas. Es la notación propia de Turbo EA para mostrar dependencias entre fichas a través de las cuatro capas EA — inspirada en el principio de estratificación de ArchiMate y en la filosofía de «buenos valores por defecto» del modelo C4, pero distinta de ambos. La misma vista se reutiliza en la página de detalle de la ficha (mostrando el vecindario inmediato de dependencias de la ficha) y en el asistente [TurboLens Architect](turbolens.md#architecture-ai), de modo que las dependencias se ven igual en todas partes.

**Leer el diagrama**

- **Carriles por capa** — Las fichas se agrupan por capa arquitectónica (Estrategia y Transformación, Arquitectura de Negocio, Aplicación y Datos, Arquitectura Técnica) dentro de rectángulos de contorno punteados, en orden fijo.
- **Nodos coloreados por tipo con iconos** — Cada nodo se colorea según su tipo de ficha y muestra el icono del tipo de ficha en su esquina superior izquierda, de modo que los tipos se reconocen de un vistazo, incluso sin color.
- **Aristas dirigidas y etiquetadas** — Las aristas siguen la dirección de la relación del metamodelo (origen → destino) y llevan la etiqueta directa de la relación (por ej. *usa*, *soporta*, *se ejecuta en*). Cuando una relación está cualificada con un valor (como un Tipo de soporte *Principal*), este aparece entre corchetes después de la etiqueta — por ejemplo *soporta [Principal]*.
- **Fichas propuestas** — En el asistente de TurboLens Architect, las fichas aún no confirmadas tienen un borde punteado y una insignia verde **NUEVO**.

**Explorar y navegar**

- **Desplazar, hacer zoom, minimapa** — Arrastre el lienzo para desplazarse, haga scroll para hacer zoom y use el minimapa para navegar por diagramas grandes.
- **Clic para inspeccionar** — Haga clic en cualquier nodo para abrir el panel lateral de detalle de la ficha.
- **Recentrar** — Mayús+clic o pulsación larga sobre una ficha para centrar el diagrama en ella; los botones **Volver al selector de tarjetas**, **Tarjeta anterior** y **Tarjeta siguiente** de la barra de herramientas recorren su historial de navegación.
- **Modo resaltado** — Pase el cursor sobre una ficha para resaltar sus conexiones; en dispositivos táctiles, active el **Modo resaltado** en el panel de controles para resaltar al tocar.
- **Modo expansión** — Active el **Modo expansión** en el panel de controles y luego haga clic en una ficha para revelar todas sus relaciones bajo demanda. La ficha en la que está centrado el diagrama lleva un borde doble en el color de su tipo, y cada ficha que expande lleva uno más fino, de modo que sus referencias siguen visibles a medida que el diagrama crece.
- **Mostrar padre / Mostrar hijos** — Dos alternativas específicas al modo expansión. Active **Mostrar padre** (flecha hacia arriba) o **Mostrar hijos** (flecha hacia abajo) en el panel de controles y luego haga clic en una ficha para añadir al diagrama solo su elemento padre de la jerarquía o sus hijos directos. Las fichas mostradas permanecen en el diagrama —para que pueda combinar padres e hijos— y se eliminan al recentrar o restablecer la vista.
- **Sin ficha central requerida** — En el Informe de Dependencias, la Layered Dependency View muestra todas las fichas que coinciden con el filtro de tipo actual, por lo que no tiene que elegir una ficha de partida primero.

**Personalizar la vista** (desde la barra de herramientas)

- **Mostrar en la tarjeta** — Un botón propio de la barra de herramientas (el icono de ojo) enumera como **casillas de verificación** todo lo que una ficha puede mostrar: la etiqueta de **tipo**, el **subtipo**, el **alias** (solo en las fichas que lo tienen), un **punto de estado del ciclo de vida** y cada **campo de atributo** disponible, agrupado bajo el tipo de ficha al que pertenece. Las dos primeras líneas marcadas se muestran en la propia ficha, en el orden en que las enumera el menú —la etiqueta de tipo cuenta como una de las dos— y el conjunto completo aparece en la información sobre herramientas. Una insignia en el botón cuenta lo que se muestra actualmente. Las opciones se recuerdan entre visitas y viajan con **Crear diagrama**: un diagrama DrawIO generado desde este informe se abre con las mismas líneas, elegidas desde el mismo menú — allí todas, porque una forma de diagrama crece para acogerlas y un nodo de informe no. En un teléfono, la lista se abre a pantalla completa. **Borrar todo** desmarca todas las casillas de una vez.
- **Tipos de tarjeta** — El botón de embudo enumera cada tipo de tarjeta presente en el diagrama con cuántas tarjetas de ese tipo hay. Desmarque uno para quitar sus tarjetas, y todas las relaciones que las tocan, de la vista: útil para leer cómo dependen las aplicaciones de los componentes de TI sin las capacidades que las acompañan. Una insignia en el botón cuenta lo que está oculto, un tipo oculto permanece en la lista para poder recuperarlo, y **Mostrar todo** lo restaura todo de una vez. La tarjeta centrada siempre se muestra, sea cual sea su tipo. Las decisiones se recuerdan entre visitas.
- **Mostrar logotipos de las tarjetas** — Una tarjeta que tiene su propio logotipo lo muestra en la esquina superior izquierda, con el icono del tipo de tarjeta como una pequeña insignia encima, de modo que se reconoce tanto el producto como el tipo de tarjeta. Activado de forma predeterminada; desactívelo en el menú **Opciones de vista** para un diagrama sin adornos. Las tarjetas sin logotipo — y todas las tarjetas de un tipo en el que un administrador ha desactivado los logotipos — se ven igual que antes en ambos casos. Los logotipos se incluyen en las exportaciones de imagen.
- **Mostrar tarjetas al final de su vida útil** — Las fichas relacionadas que han llegado al final de su vida útil **en la fecha elegida en la línea de tiempo** se ocultan por defecto para mantener el gráfico enfocado; active esta opción (en el menú **Opciones de vista**) para volver a mostrarlas. La ficha en la que está centrado siempre se muestra, incluso si ella misma está al final de su vida útil.
- **Agrupar relaciones** — En un diagrama denso, cada línea trazada por separado puede ocultar la forma del paisaje. Active esta opción en el menú **Opciones de vista** para agrupar las tarjetas relacionadas en cajas y trazar una sola conexión entre dos cajas cualesquiera, etiquetada con cuántas relaciones representa: el número va en una pastilla sobre la línea, y la línea se traza más gruesa cuantas más relaciones lleva, de modo que el peso de una dependencia se lee de un vistazo. Elija qué son las cajas: **Por capa**, **Por tipo de tarjeta** (una caja por tipo, como *Aplicaciones (8)*) o **Por subtipo**. Las relaciones entre dos tarjetas de una misma caja se siguen dibujando dentro de ella, y la tarjeta centrada permanece aparte, de modo que se ve de un vistazo cómo se relaciona con cada parte del paisaje. Mientras las relaciones están agrupadas, los cuatro carriles de capa se dejan de lado y las cajas se colocan según lo que conectan, lo que mantiene las conexiones cortas en lugar de recorrer todo el alto del diagrama; **Por capa** le devuelve las capas. Pase el ratón sobre una conexión para enumerar las relaciones agrupadas, o sobre una tarjeta para iluminar solo las suyas. Las cajas se pueden arrastrar como los carriles de capa, y sus tarjetas se mueven con ellas. **Crear diagrama** también funciona en una vista agrupada, con una advertencia que muestra primero; véase más abajo.
- **Mostrar etiquetas de relación** — El verbo de cada relación (*admite*, *usa*, …) se dibuja sobre su línea. Activado de forma predeterminada; desactívelo en el menú **Opciones de vista** para un lienzo más limpio en un panorama denso. Las líneas y sus puntas de flecha siguen mostrando qué se conecta con qué, y en qué dirección.
- **Mostrar valores de relación** — Muchas relaciones pueden cualificarse con un valor (p. ej. una aplicación *soporta* una capacidad como *Principal*, *Secundario* o *Sin soporte*). Cuando está activado (por defecto), estos valores aparecen entre corchetes junto a la etiqueta de la relación (*soporta [Principal]*) y se incluyen en las exportaciones de imagen. Desactívelo en el menú **Opciones de vista** para una vista más limpia; las relaciones sin valor no cambian en ningún caso. Los detalles de sí/no marcados también se muestran, de modo que una relación *CRUD* se lee *CRUD [Crear · Leer]*, solo con las casillas marcadas. Una etiqueta demasiado larga para una línea continúa en una segunda línea, con los valores debajo del verbo, en lugar de cortarse.
- **Estilo de línea** — Elija cómo se dibujan las líneas de conexión en reposo: **continua**, **punteada**, **discontinua** (predeterminada) o **trazo largo**, desde el menú **Opciones de vista**. Al pasar el cursor, la línea siempre se dibuja continua, y una dependencia interrumpida conserva sus propios trazos.
- **Reorganizar** — Arrastre una ficha para moverla dentro de su capa, o arrastre un **bloque de capa** completo para moverlo con todas sus fichas. **Restablecer vista** (en la barra de herramientas izquierda) restaura la disposición automática y borra cualquier exploración. Un bloque de capa crece por sí solo cuando arrastra una ficha contra su borde, de modo que una ficha puede moverse más allá de donde terminaba el bloque al principio. Vuelve a encogerse cuando devuelve la ficha, pero nunca por debajo de su tamaño original. Las cajas de **Agrupar relaciones** crecen y se encogen de la misma manera. **Crear diagrama** toma cada bloque con su tamaño actual, y **Restablecer vista** recupera los tamaños automáticos.
- **Fondo** — Alterne el fondo del lienzo entre cuadrícula, puntos y ninguno.
- **Exportar y pantalla completa** — Exporte el diagrama a **PNG** o **SVG**, o ábralo en **pantalla completa**.
- **Crear diagrama** — Convierta la vista actual en un nuevo diagrama editable en el [módulo de Diagramas](diagrams.md). Recrea las tarjetas, las relaciones y las cuatro capas de arquitectura, y cada forma permanece vinculada a su tarjeta de inventario. Se le solicita un nombre y, a continuación, se le lleva directamente al nuevo diagrama. Disponible para los usuarios que pueden crear diagramas. Desde una vista con **Agrupar relaciones** activado, cada caja se convierte en el diagrama en un contenedor con sus tarjetas dentro —todavía vinculadas al inventario—, mientras que las conexiones entre cajas se dibujan como decoración con los recuentos de hoy: no siguen el inventario, no se pueden sincronizar y no se marcan cuando cambian las relaciones. Un diálogo lo indica antes de pedirle el nombre.

![Relaciones agrupadas por tipo de tarjeta](../assets/img/es/13c_dependencias_agregadas.png)

## Informe de Costos

![Informe de Costos](../assets/img/es/34_informe_costos.png)

El **Informe de Costos** proporciona un análisis financiero de su panorama tecnológico:

- **Vista de mapa de árbol** — Rectángulos anidados dimensionados por costo, con agrupación opcional (por ejemplo, por organización o capacidad)
- **Vista de gráfico de barras** — Comparación de costos entre componentes
- **Vista Sankey** — El mismo informe dibujado como un flujo de costes (véase [Vista Sankey](#sankey-view))
- **Tipo de tarjeta** — Elija el tipo de tarjeta sobre el que se construye el informe: **Aplicación**, **Componente TI** o **Aplicación + Componente TI** (ambos tipos en un mismo gráfico, cada tarjeta con su propio coste). Las iniciativas ya no forman parte del informe de costes.
- **Tipo de coste** — Elija qué se suma: **TCO** (el total de todas las partidas de coste de cada tarjeta) o cualquier partida de coste individual del catálogo. Para la opción combinada solo se ofrecen los tipos de coste que existen en ambos tipos.

Todas las vistas comparten la misma barra de herramientas, los mismos filtros, el mismo año fiscal y el mismo tipo de coste, de modo que cambiar de vista solo cambia el dibujo.

**Gráfico de tendencia** — La tendencia del coste (el año actual, los cuatro anteriores y, cuando se selecciona, la **Forecast**) se muestra encima del gráfico en las tres vistas, no solo en el treemap, y sigue el tipo de coste seleccionado.

**Colores y leyenda** — Cada grupo tiene su propio tono; dentro de un grupo, un tono más oscuro significa una tarjeta más costosa. Más allá de los ocho grupos más costosos, el resto se pliega en un único grupo **Otros**, y las tarjetas sin valor en el campo de agrupación van a **Sin especificar**. La leyenda junto al gráfico lista los grupos con sus colores; el Sankey y la tabla usan los mismos colores.

**Desglose** — Un **clic derecho** en un grupo o una tarjeta profundiza en él: el gráfico se limita a ese grupo (o tarjeta) y aparece una ruta de navegación encima. Haga clic en **Volver**, o en cualquier segmento de la ruta, para subir un nivel. Profundizar en **Otros** lista los grupos que se plegaron en él. Un **clic izquierdo** en una tarjeta abre en cambio su panel lateral (un clic izquierdo en un grupo no hace nada). Una indicación sobre el gráfico recuerda ambos gestos.

**Tabla** — Además de las columnas de agrupación y de atributos, la tabla tiene una columna por partida de coste y una columna **TCO**. Ordenar por el tipo de coste seleccionado pone primero las más costosas. Las filas de cabecera de grupo y el total del pie muestran las sumas por partida, y cada cabecera de grupo lleva la muestra de su color. Una insignia con el icono y el nombre del tipo en la celda del nombre distingue Aplicaciones y Componentes TI en la vista combinada. El clic derecho en una fila profundiza en ella; el clic abre la tarjeta.

### Agrupar por

**Agrupar por** está disponible en el mapa de árbol, la tabla y el Sankey. Una tarjeta se agrupa por:

- el valor de un **campo de la tarjeta** (solo campos de valor único; no se ofrecen los campos de selección múltiple, porque situarían una tarjeta en dos grupos), o
- una **tarjeta vinculada**, designada por el nombre de esa tarjeta, a través de una relación en la que cada tarjeta tiene **como máximo una** tarjeta vinculada de ese tipo. Nunca se ofrecen las relaciones de muchos a muchos, de modo que un coste nunca puede caer en dos grupos.

Las tarjetas sin valor, o sin tarjeta vinculada, van al grupo **Unspecified**. Para la opción combinada **Aplicación + Componente TI** solo se ofrecen los campos que existen en ambos tipos; el selector queda desactivado cuando no hay ninguno. La agrupación nunca cuenta un coste dos veces ni descarta ninguno.

### Año fiscal

Los costes son anuales, por lo que el informe se elabora para un **año fiscal** cada vez. Un selector **Año fiscal** en la barra de herramientas ofrece seis entradas, la más reciente primero:

| Entrada | Qué muestra |
|---|---|
| **FY27 - Forecast** | El año fiscal siguiente, a partir de cifras introducidas a mano (véase más abajo). |
| **FY26 - Current** | El año fiscal actual, a partir de los atributos de coste vigentes de las tarjetas. Es el valor predeterminado. |
| **FY25** … **FY22** | Los cuatro años fiscales anteriores al actual, a partir de los costes registrados para ellos. |

Un año fiscal se llama **FY** más las dos últimas cifras del año en que **termina**, sea cual sea el mes en que empiece su año fiscal: un año fiscal que va de julio de 2025 a junio de 2026 es **FY26**. Un chip en la barra de herramientas repite la selección, por ejemplo **Año fiscal: FY26 - Current**. *Current* y *Forecast* no se traducen.

**Los costes de Aplicaciones y Componentes de TI proceden de las partidas de coste de la ficha.** Cada partida del catálogo (incluidas las archivadas) es un componente de coste propio en el mapa de árbol, el Sankey, la tendencia y la tabla, y el Forecast es el año Forecast de la [sección de Costes](card-details.md#sección-de-costes-aplicación-y-componente-de-ti) de la ficha. Para los demás tipos de ficha (Iniciativa, Proveedor), el próximo año fiscal se introduce a mano en el historial de costes de la ficha, lo que requiere el mismo permiso que registrar un año pasado. Cuando ese año pasa a ser el actual, el informe lee en su lugar los atributos en vivo, y la cifra en vivo de la ficha sustituye a la escrita.

#### Qué tarjetas aparecen

- **Año actual** — El coste anual de una tarjeta cuenta **íntegramente** cuando el año fiscal actual se sitúa entre aquel en que la tarjeta pasa a **Activo** y aquel en que cae su **Fin de vida**, ambos incluidos. No se prorratea nada: una aplicación que se retira en noviembre sigue aportando todo su coste anual este año. Una tarjeta cuyo Fin de vida cayó en un año fiscal anterior no se cuenta. Las fechas de ciclo de vida que faltan se interpretan igual que en los informes con viaje en el tiempo:
    - **Sin fecha Activo, pero con fecha de Planificación o de Introducción** — la tarjeta sigue planificada y no se cuenta.
    - **Sin fecha de Fin de vida** — la tarjeta cuenta a partir del año en que pasa a Activo.
    - **Sin ninguna fecha de ciclo de vida** — la tarjeta cuenta.
- **Cualquier otro año (pasado o de previsión)** — Aparece toda tarjeta activa que tenga un **coste registrado para ese año**, aunque se haya retirado después o solo pase a estar activa más adelante. Una tarjeta sin coste registrado para ese año no aparece.
- **Las tarjetas archivadas** no aparecen nunca, en ningún año.

La regla se aplica a toda la página — los totales, el mapa de árbol, la tabla, los agregados por **Origen de los costes** y el desglose — y el año fiscal seleccionado figura en la cabecera impresa.

Cuando **Forecast** es el año seleccionado, el **gráfico de historial** muestra el coste del año actual, los cuatro anteriores y el año de previsión. Cada barra está apilada, con un segmento por componente de coste: una partida de coste para Aplicaciones y Componentes de TI, y en otro caso un campo de coste (la leyenda y la información emergente usan entonces el nombre técnico del campo, por ejemplo `softwareLicensingCost`).

Un administrador define el mes en que empieza el año fiscal en [Configuración → General](../admin/settings.md).

### Origen de los costes

Cuando el tipo de tarjeta seleccionado tiene al menos un tipo de relación que apunta a un tipo con un campo de coste, aparece un selector **Origen de los costes** junto a **Tipo de tarjeta**. Permite escoger de dónde proceden las cifras:

- **Directo (este tipo de tarjeta)** — opción por defecto; suma el campo de coste de las propias tarjetas mostradas. Úselo cuando consulte directamente *Aplicaciones* o *Componentes TI*.
- **Agregar desde tarjetas relacionadas** — marque una o varias entradas `Tipo · Campo` (por ejemplo `Aplicación · Coste anual total`, `Componente TI · Coste anual total`). El valor de cada tarjeta primaria pasa a ser la suma de ese campo en sus tarjetas relacionadas.

El selector es **de selección múltiple**, de modo que una misma consolidación puede combinar varios tipos relacionados. Por ejemplo, al consultar el **Proveedor** *Microsoft*, marcar a la vez `Aplicación · Coste anual total` y `Componente TI · Coste anual total` muestra la huella completa del proveedor —Teams, M365, Azure y cualquier otro componente suministrado por Microsoft— como una única cifra.

#### Atribución: Completa o A partes iguales

Dentro de un mismo rectángulo, nada se cuenta dos veces:

- Cada entrada es un par único `(tipo destino, campo de coste)`; la lista ofrece cada par exactamente una vez, incluso cuando varios tipos de relación alcanzan el mismo tipo destino.
- Dentro de un mismo par, una tarjeta conectada por varios tipos de relación contribuye con su coste una sola vez.

Entre rectángulos, una tarjeta relacionada puede estar vinculada a varias de las tarjetas mostradas: una iniciativa que mejora dos capacidades, un componente TI que da servicio a tres aplicaciones. El selector **Atribución**, junto al selector de Origen de los costes, decide cómo se cuenta una tarjeta así:

- **Completa** (predeterminada) — el coste total de la tarjeta relacionada cuenta en cada tarjeta mostrada con la que está vinculada. Es una vista de impacto: cada rectángulo muestra cuánto dinero depende de esa tarjeta. La cifra **Costo total** sigue contando cada tarjeta relacionada una sola vez, por lo que no es la suma de los rectángulos; una leyenda debajo lo indica. Un rectángulo cuyos orígenes se comparten con otras tarjetas indica cuántos en su información emergente, y la tabla lo marca con un icono de enlace.
- **A partes iguales** — el coste de la tarjeta relacionada se divide entre el número de tarjetas en servicio del tipo mostrado con las que está vinculada. Una iniciativa de 50.000 que mejora dos capacidades suma 25.000 a cada una, de modo que los rectángulos suman el total.

El reparto es una propiedad del panorama, no de la vista: limitar el informe a unas pocas tarjetas o profundizar en un rectángulo no lo cambia. Las tarjetas que usted no tiene permiso para ver nunca cuentan, ni como origen de coste ni en el número entre el que se divide un coste. La elección se guarda con el informe.

Un pequeño **icono de ayuda (?)** junto al selector explica las dos opciones de atribución al pasar el ratón.

La lista de opciones se genera a partir de su metamodelo —los tipos de relación y los campos de coste se descubren en tiempo de renderizado, de modo que cualquier tipo de tarjeta o relación personalizada que añada se convierte automáticamente en un Origen de los costes válido.

### Profundizar en un rectángulo

Siempre que haya al menos un Origen de los costes activo, los rectángulos del mapa de árbol son **clicables**. Al hacer clic en uno, el gráfico se sustituye por el desglose del coste de ese rectángulo: las tarjetas relacionadas que contribuyeron a su consolidación, dimensionadas por su coste directo. Sobre el gráfico aparece una ruta de navegación, p. ej. **Todas las Aplicaciones › NexaCore ERP**; haga clic en cualquier segmento para retroceder.

- **Un único Origen de costes activo** — el desglose muestra un mapa de árbol de las tarjetas relacionadas (por ejemplo, al hacer clic en *NexaCore ERP* con `Componente TI · Coste anual total` marcado se muestran los Componentes TI vinculados a NexaCore ERP, dimensionados por su coste anual).
- **Varios Orígenes de costes activos** — el desglose muestra **un mapa de árbol por origen, en paralelo** (1 columna en pantallas estrechas, 2 en pantallas amplias). Cada panel tiene su propio encabezado, su propio total y su propio `% del total` en la información sobre herramientas, de modo que los distintos tipos de tarjeta conservan su escala en lugar de mezclarse en un único gráfico.

Con **A partes iguales**, las tarjetas del desglose muestran su parte en el rectángulo en el que hizo clic, de modo que el total del panel coincide con el coste de ese rectángulo.

La selección de Origen de los costes y los demás filtros se conservan al profundizar, y el nivel de desglose forma parte de la configuración del informe guardado: guardar un informe mientras se está profundizando lo abre directamente en ese nivel. Sin un Origen de costes activo, hacer clic en un rectángulo abre en su lugar el panel lateral de la tarjeta (no hay nada que desglosar).

**Limitar a tarjetas concretas** — El chip contiguo al selector de tipo abre un selector: elija una o varias tarjetas y el treemap, los totales y la tabla se limitarán a esas y a todo lo que hay debajo. El chip se oculta mientras esté dentro de un rectángulo, ya que ese detalle le ha llevado a otro tipo de tarjeta; salga de él y el alcance seguirá ahí.

### Vista Sankey {#sankey-view}

El Sankey admite los mismos filtros que el mapa de árbol: tipo de tarjeta, ámbito de tarjetas, campo de coste, año fiscal y Agrupar por. Dibuja a la izquierda las **partidas de coste** (los campos de coste que componen el total), a la derecha las **tarjetas** y, cuando se elige un Agrupar por, en el centro los **grupos**: las partidas de coste fluyen hacia los grupos y los grupos fluyen hacia sus tarjetas. Sin Agrupar por, el flujo va directamente de las partidas de coste a las tarjetas. Un coste se cuenta una sola vez: un componente TI usado por varias aplicaciones no se repite.

### Pantalla completa

El botón de pantalla completa del mapa de árbol y del Sankey hace que el gráfico ocupe toda la pantalla, a lo ancho y a lo alto, sin deformarlo.

## Informe de Licencias

![Informe de Licencias](../assets/img/en/103_report_licensing.png)

El **Informe de Licencias** (**Informes → Licencias**) compara, para cada Aplicación o Componente de TI, las licencias contratadas con las realmente usadas, y señala un exceso. Requiere el permiso `licenses.view`. Los datos se introducen en la [sección de Licencias](card-details.md#sección-de-licencias-aplicación-y-componente-de-ti) de cada ficha o se importan desde Excel.

La barra de herramientas elige el **tipo de ficha** (Aplicación o Componente de TI, uno cada vez), la **métrica** (**Usuarios** o **Instalaciones**), el **tipo de licencia** (todos, o una entrada del catálogo), la **agrupación**, el **año fiscal** y el alcance de las fichas. Solo se listan las fichas cuyo campo **Modelo de licencias** incluye la métrica seleccionada. Cuatro mosaicos arriba cuentan las fichas **Conformes**, **Cerca del límite**, **Sobrelicenciadas** o **Sin datos reales** en el año seleccionado.

**Tendencia** — Sobre la vista, un gráfico muestra las cantidades licenciadas frente a las reales del año actual, los cuatro anteriores y el año **Forecast** (solo licenciado), apiladas por tipo de licencia. Sigue el filtro de tipo de licencia, el alcance y cualquier desglose.

### Vistas

| Vista | Qué muestra |
|---|---|
| **Utilización** | Una barra horizontal por ficha: real dividido por licenciado, de mayor a menor. Verde por debajo del 80 %, naranja del 80 % al 100 %, rojo por encima del 100 %, con líneas de referencia en el 80 % y el 100 %. Una ficha sin datos reales es una barra gris en cero. |
| **Por tipo de licencia** | Barras agrupadas de licenciado frente a real para cada tipo de licencia en el año seleccionado. Sin ficha elegida muestra los totales del alcance. El selector **Ficha** la limita a una Aplicación o Componente de TI; elegir una **Plataforma** suma las Aplicaciones y Componentes de TI vinculados a ella, cada uno contado una sola vez. |
| **Tabla** | Una fila por ficha con licenciado, real y % para cada tipo de licencia, los totales y el estado. El menú **Columnas** añade campos de la ficha. Descarga a Excel o impresión como en el Informe de Costes. |

**Estado.** Cada tipo de licencia se juzga por separado, sin compensación entre tipos: está **sobrelicenciado** cuando lo real supera lo licenciado, y **cerca del límite** desde el 80 % de lo licenciado. Una ficha toma su peor estado. Una ficha sin cantidad real para la métrica seleccionada está **Sin datos reales**. La barra de una ficha muestra su peor tipo de licencia. El año Forecast no tiene estado.

**Gestos** — Un **clic izquierdo** en una ficha abre su panel lateral. Un **clic derecho** en una ficha (o en un grupo cuando la agrupación está activa) la desglosa, con una ruta de navegación y un botón **Atrás**; la tendencia sigue el desglose. La vista Por tipo de licencia no tiene desglose.

### Importación

**Importar** en la barra de herramientas carga cantidades de licencias desde un archivo Excel (requiere `licenses.edit`). La primera hoja tiene una fila por cantidad, con las columnas **Component**, **Metric**, **License type**, **Year**, **Licensed** y **Actual**. El componente se identifica por su nombre exacto (sin distinguir mayúsculas); el tipo de licencia por su clave o su nombre en inglés; el año es el año fiscal tal como se nombra en la barra de herramientas (por ejemplo 2026). Una celda vacía deja el valor almacenado sin cambios, y no se puede fijar una cantidad real para el año Forecast.

El cuadro de diálogo muestra primero una vista previa: las filas que se aplicarán y las omitidas, cada una con su motivo (ficha no encontrada, tipo de licencia desconocido, año fuera del periodo, no es un número entero, celda duplicada). No se escribe nada hasta que haga clic en **Aplicar**. La importación nunca crea un tipo de licencia ni edita el Modelo de licencias de una ficha.

Los informes de licencias se pueden guardar como los demás informes (véase [Informes guardados](#informes-guardados)).

## Informe de Matriz

![Informe de Matriz](../assets/img/es/35_informe_matriz.png)

El **Informe de Matriz** crea una **cuadrícula de referencias cruzadas** entre dos tipos de fichas. Por ejemplo:

- **Filas** — Aplicaciones
- **Columnas** — Capacidades de Negocio
- **Celdas** — Indican si existe una relación (y cuántas)

Esto es útil para identificar brechas de cobertura (capacidades sin aplicaciones de soporte) o redundancias (capacidades soportadas por demasiadas aplicaciones).

Utilice el interruptor **Ocultar tarjetas sin relación** para ocultar las filas y columnas de las fichas que no tienen relaciones, conservando solo las fichas que participan en al menos una relación. La vista completa que muestra todas las fichas sigue siendo el comportamiento predeterminado.

### Qué muestra cada celda

El control **Visualización de celda** ofrece cuatro opciones:

- **Existe (punto)** — un punto allí donde exista una relación.
- **Recuento (mapa de calor)** — cuántas relaciones hay, sombreado según la densidad.
- **Valores (códigos)** — una letra con color por cada valor de relación, con una leyenda sobre la cuadrícula. Ideal para una matriz grande.
- **Valores (etiquetas)** — los nombres de los valores completos. Las columnas se ensanchan, así que conviene a una matriz más pequeña.

Las letras y los nombres provienen de los atributos que declaran sus tipos de relación, en su propio idioma. Una relación CRUD se lee `C R U D`; una relación de propiedad muestra sus propios valores. Añada un valor a un tipo de relación en el [metamodelo](../admin/metamodel.md) y aparecerá aquí sin más configuración. Una celda de grupo contraído siempre muestra un recuento, porque puede abarcar muchos valores distintos: expanda un nivel para verlos.

Una ficha con hijos en la jerarquía también puede tener relaciones propias. Cuando así ocurre, recibe una fila (o columna) propia etiquetada **(él mismo)** justo debajo de su encabezado de grupo, de modo que esas relaciones tengan dónde mostrarse en lugar de perderse entre el padre y sus hijos. Al contraer el nivel se cuentan en la celda del grupo junto con las de sus hijos.

### Filtrar por relación

La barra de filtros sobre la cuadrícula limita la matriz a las relaciones que le interesan:

- **Tipo de relación** — cuando los dos tipos de ficha están conectados en ambos sentidos.
- **Dirección** — si la ficha de la fila es el origen o el destino de la relación.
- **Valores** — un filtro por cada atributo que declaren los tipos de relación, incluido «(vacío)» para las relaciones cuyo valor nunca se estableció.

Al filtrar se vacían las celdas de las fichas que ya no coinciden, de modo que activar **Ocultar tarjetas que no coinciden** deja solo las que sí. Algunos ejemplos:

- Aplicación × Objeto de datos, filtrado por *Crear*: qué aplicaciones son el sistema de referencia de cada objeto de datos.
- Aplicación × Interfaz, filtrado por dirección: quién publica una interfaz y quién la consume.
- Organización × Aplicación, filtrado por *Propietario*: el mapa de propiedad, sin que los usuarios lo saturen.

### Encontrar brechas de cobertura

Dos tarjetas cuentan las fichas de cada eje que no tienen ninguna relación. **Mostrar solo brechas** reduce la cuadrícula exactamente a esas: las capacidades que nadie soporta, los objetos de datos que nadie mantiene.

### Moverse por una matriz grande

**Buscar fila** y **Buscar columna** filtran los ejes por nombre; un elemento padre permanece visible cuando alguno de sus hijos coincide. El botón de intercambio de la barra de título permuta los dos ejes.

### Exportar

La exportación a Excel genera dos hojas: la cuadrícula tal como aparece en pantalla y una fila por relación con sus valores repartidos en columnas, la hoja sobre la que construir una tabla dinámica. La exportación a PowerPoint captura la imagen.

**Limitar cada eje** — Cada eje tiene su propio chip junto a su selector de tipo, de modo que puede pedir *estas capacidades × estas aplicaciones*. Los indicadores sobre la cuadrícula siguen al alcance, así que las cifras siempre describen lo que está viendo. Cambiar el tipo de un eje borra su alcance; al transponer, los dos alcances se intercambian junto con los ejes.

## Informe de Calidad de Datos

![Informe de Calidad de Datos](../assets/img/es/33_informe_calidad_datos.png)

El **Informe de Calidad de Datos** es un **panel de completitud** que muestra qué tan bien están completados los datos de su arquitectura. Basado en los niveles de importancia configurados en la pestaña **Calidad de datos** de cada tipo de tarjeta (cada campo más los factores integrados Descripción, Ciclo de vida, Relaciones obligatorias, Etiquetas obligatorias e Interesados):

- **Puntuación general** — Calidad de datos promedio en todas las fichas
- **Por tipo** — Desglose que muestra qué tipos de fichas tienen la mejor/peor completitud
- **Fichas individuales** — Lista de fichas con la calidad de datos más baja, priorizadas para mejora

Las tarjetas con un **campo obligatorio** vacío siempre puntúan **0 %** — el cálculo ponderado solo se reanuda cuando todos los campos obligatorios están completos — de modo que la lista de puntuaciones más bajas muestra exactamente las tarjetas a las que aún les faltan datos obligatorios.

### Profundizar en una cifra

Cada cifra del informe es una vía de entrada, no solo un dato:

- **Haga clic en un segmento de barra** en *Completitud por tipo*: se abre un panel a la derecha con las fichas de ese tipo en esa banda (Completo, Parcial o Mínimo).
- **Haga clic en una barra** de *Completitud media por tipo*, o en una fila de la vista de tabla, para listar todas las fichas de ese tipo.
- **Haga clic en el mosaico Huérfanos u Desactualizados** para listar las fichas tras ese recuento.

Desde el panel, haga clic en una ficha para abrir su panel de detalle, o pulse **Ver en el inventario** para continuar en el [Inventario](inventory.md), que llega agrupado por calidad de datos con la banda seleccionada desplegada y las demás plegadas al lado, de modo que pueda empezar a corregir registros de inmediato. Los paneles de Huérfanos y Desactualizados enlazan con el filtro de inventario correspondiente, en todos los tipos de ficha.

El informe termina con el gráfico **Cobertura de fin de vida**: para aplicaciones y componentes de TI, cuántos tienen un fin de vida vinculado desde endoflife.date, introducido a mano o sin registrar. Haz clic en un segmento para listar las fichas que hay detrás; desde el panel **Sin registrar**, **Ver en el inventario** abre exactamente esos componentes en el [Inventario](inventory.es.md), donde el filtro **Fin de vida** te permite trabajarlos.

## Informe de Fin de Vida (EOL)

![Informe de Fin de Vida](../assets/img/es/32_informe_eol.png)

El **Informe de EOL** muestra el estado de soporte de los productos tecnológicos vinculados a través de la función de [Administración de EOL](../admin/eol.es.md):

- **Distribución de estados** — Cuántos productos tienen Soporte, se Acercan a EOL o están en Fin de Vida
- **Línea temporal** — Cuándo los productos perderán soporte
- **Priorización de riesgos** — Enfóquese en componentes de misión crítica que se acercan a EOL
- **Origen** — Cada elemento procede de endoflife.date, de uno de sus [productos EOL personalizados](../admin/eol.es.md) (con la insignia **Producto personalizado**) o de una fecha de fin de vida introducida a mano (con la insignia **Manual**). El filtro **Origen** limita el informe a uno de ellos.
- **Sin datos de fin de vida** — Fichas de un tipo que realiza el seguimiento del fin de vida (Aplicaciones y Componentes de TI, salvo que un administrador lo [haya cambiado](../admin/eol.md#fin-de-vida-en-otros-tipos-de-ficha)) sin enlace a endoflife.date (ni a un producto EOL personalizado) ni fecha de fin de vida propia. Aparecen con el estado **Sin datos de fin de vida**; pulse el mosaico del mismo nombre para ver solo esos, y púlselo de nuevo para recuperar el resto. Una fecha mantenida a mano en el ciclo de vida cuenta como registrada, así que un componente ya evaluado no vuelve a aparecer aquí.

## Informes Guardados

![Galería de Informes Guardados](../assets/img/es/36_informes_guardados.png)

Guarde cualquier configuración de informe para acceso rápido. Los informes guardados incluyen una vista previa en miniatura y pueden compartirse en toda la organización.

## Exportar Informes

Todos los informes admiten **Exportar a Excel (.xlsx)** y **Exportar a PowerPoint (.pptx)** desde el menú **⋮** de la barra de título (junto a Imprimir y Copiar enlace); el [Informe de la iniciativa](ppm.md#informe-de-la-iniciativa) solo ofrece PowerPoint.

- **Excel** — Genera una hoja por cada tabla de datos visible, con columnas dimensionadas automáticamente y formato de moneda / número preservado. Cambie a la **vista de tabla** antes de exportar para capturar las filas subyacentes.
- **PowerPoint** — Crea una presentación cuya primera diapositiva combina el título del informe, la marca de tiempo de generación, el resumen de filtros activos y el gráfico en vivo con calidad de presentación. En los informes con gráficos largos (como los informes de Portafolio, Mapa de Capacidades, Ciclo de Vida y Calidad de Datos), un gráfico que no cabe en una diapositiva continúa en las siguientes, dividido entre filas; las tablas de datos en sí van a la exportación a Excel.

Mientras se genera una exportación, el botón **⋮** muestra un indicador de carga; si falla, un mensaje lo indica y puede volver a intentarlo.

Los filtros y agrupaciones activos en el momento de la exportación se registran en la diapositiva de título o en la cabecera, manteniendo las exportaciones autoexplicativas.

## Mapa de Procesos

El **Mapa de Procesos** visualiza el panorama de procesos de negocio de la organización como un mapa estructurado, mostrando las categorías de procesos (Gestión, Principal, Soporte) y sus relaciones jerárquicas.

**Limitar a procesos concretos** — El chip contiguo a *Profundidad de visualización* abre un selector: elija uno o varios procesos y el mapa mostrará solo esos y todo lo que hay debajo. Los subprocesos se incluyen automáticamente y la **Profundidad de visualización** se cuenta desde su selección. El zoom con un clic sigue funcionando, ahora dentro del alcance. Es un control distinto de la fila **Alcance** de abajo, que filtra por Organización o Contexto de negocio relacionado.
