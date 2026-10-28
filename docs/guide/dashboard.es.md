# Panel de Control

El Panel de Control es la primera pantalla que ve después de iniciar sesión. Proporciona una **visión rápida** del estado general de toda la arquitectura empresarial.

![Panel de Control - Vista superior](../assets/img/es/01_panel_de_control.png)

## Barra de Navegación Superior

En la parte superior de la pantalla encontrará la **barra de navegación principal** con los siguientes elementos:

- **Turbo EA** (logo): Haga clic para volver al Panel de Control desde cualquier sección
- **Panel de control**: Vista general del estado de la arquitectura
- **Inventario**: Listado completo de todas las fichas
- **Informes**: Informes visuales y analíticos
- **BPM**: Gestión de Procesos de Negocio (si está habilitado)
- **Diagramas**: Editor visual de diagramas de arquitectura
- **Entrega EA**: Gestión de iniciativas de arquitectura
- **Tareas**: Tareas pendientes y encuestas asignadas
- **Buscar fichas**: Barra de búsqueda rápida con autocompletado
- **+ Crear**: Botón para crear nuevas fichas rápidamente
- **Campana de notificaciones**: Alertas del sistema y [notificaciones](notifications.es.md)
- **Icono de perfil**: Selección de idioma, cambio de tema, preferencias de notificaciones y acceso a administración
- **Patrocinar**: Un botón de color púrpura a rosa junto al número de versión en el menú de perfil abre un cuadro de diálogo que explica por qué importa el patrocinio, con un enlace al blog y opciones únicas o mensuales a través de GitHub Sponsors

## Paneles y widgets

La página de inicio se compone de **paneles**, que se muestran como pestañas en la parte superior de la página. Turbo EA incluye tres paneles:

| Panel | Qué muestra |
|-------|-------------|
| **Resumen** | El estado de todo el panorama: tarjetas KPI, gráficos, los tipos de ficha para explorar y la actividad más reciente |
| **Mi espacio de trabajo** | Todo lo que se le ha asignado: favoritos, roles, tareas, encuestas y sus cambios recientes (véase [Pestaña «Espacio de trabajo»](#workspace-tab)) |
| **Administración** | Actividad de los usuarios, cobertura de partes interesadas, aprobaciones pendientes y el directorio de partes interesadas (véase [Pestaña «Administración»](#admin-tab-stakeholder-directory)) |

Cada panel es una cuadrícula de **widgets**. Solo ve los widgets que permite su rol: los widgets de Resumen requieren el permiso `reports.ea_dashboard` y los de Administración `admin.users`; además, una pestaña desaparece cuando ninguno de sus widgets es visible para usted. Los administradores pueden modificar los paneles integrados y añadir los suyos (véase [Personalizar paneles](#customizing-dashboards)).

Haga clic en el icono de **chincheta** de una pestaña para convertirla en el panel que se abre al entrar en Turbo EA.

## Tarjetas KPI

La fila de tarjetas de la parte superior del panel Resumen muestra las cifras principales del panorama:

- **Total de fichas**: número de todos los componentes registrados en la plataforma
- **Calidad media de los datos**: la completitud media de todas las fichas; haga clic para abrir el [informe de Calidad de datos](reports.md)
- **Aprobadas** y **Rotas**: cuántas fichas tienen cada estado de aprobación

Cada tarjeta muestra una **flecha de tendencia** que compara el valor de hoy con el del inicio de la ventana de comparación: 30 días, o menos mientras se sigue recopilando el historial. La leyenda bajo las tarjetas indica la ventana realmente utilizada. Las instantáneas se toman todos los días a las 02:00 UTC. Las tendencias describen todo el panorama, por lo que solo se muestran a los usuarios que pueden leer todas las fichas; un usuario cuyo rol oculta algunas fichas ve el valor sin la flecha.

![Panel de Control - Vista inferior con gráficos](../assets/img/es/02_panel_inferior.png)

## Gráficos y listas

Bajo las tarjetas, el panel Resumen muestra:

- **Fichas por tipo**: la proporción de cada tipo de ficha en su panorama
- **Estado de aprobación**: cuántas fichas están aprobadas, pendientes, rotas o rechazadas
- **Distribución de completitud**: cuántas fichas hay en cada tramo de calidad de datos
- **Visión general del ciclo de vida**: cuántas fichas hay en cada fase del ciclo de vida
- **Explorar por tipo**: cada tipo de ficha con su recuento; haga clic en uno para abrir el [Inventario](inventory.md) prefiltrado por ese tipo
- **Actividad reciente**: un feed de los últimos cambios: quién editó qué y cuándo

Al hacer clic en una barra o en un sector de un gráfico se abre lo que hay detrás: el [Inventario](inventory.md) filtrado por esas fichas para un tipo de ficha o un estado de aprobación, el informe de Ciclo de vida para una fase del ciclo de vida y el informe de Calidad de datos para un tramo de completitud.

## Pestaña «Espacio de trabajo» { #workspace-tab }

El panel **Mi espacio de trabajo** reúne todo lo que se le ha asignado: favoritos, informes guardados, tareas, encuestas pendientes, las fichas que ha creado, actividad reciente en sus fichas y la sección **Fichas en las que tengo un rol**. Cada uno de estos elementos es un widget, por lo que un administrador puede reorganizarlos o colocarlos en otro panel.

Esta última sección agrupa las fichas por el rol de parte interesada que usted desempeña (Application Owner, Business Owner, etc.) y enumera las fichas bajo cada rol. Si su rol concede el permiso `stakeholders.view` (roles admin, member y viewer por defecto), un pequeño icono de **búsqueda de persona** junto al título de la sección le permite dirigirla a **otra persona**: elija un usuario en el autocompletado y la sección se vuelve a cargar con los roles y las fichas de ese usuario. El título cambia a «Roles de {name}». Haga clic en el pequeño icono de cierre para volver a sus propios roles. Útil para responder a «¿de qué es responsable esta persona?» con un clic.

## Pestaña «Administración» — Directorio de partes interesadas { #admin-tab-stakeholder-directory }

El panel **Administración** se muestra a los roles con `admin.users`. Además de sus tarjetas KPI (usuarios activos, fichas sin partes interesadas, tareas vencidas, aprobaciones atascadas, calidad general) y sus listas (principales colaboradores, cobertura de partes interesadas, usuarios inactivos, flujo de aprobación, actividad del sistema, tareas sin asignar), termina con un widget **Directorio de partes interesadas**. Enumera cada tipo de ficha que tiene al menos una parte interesada, con el número de titulares distintos. Expanda un tipo de ficha para ver sus roles y, dentro de cada rol, los usuarios que lo ocupan junto con el número de fichas que cubren. Haga clic en la etiqueta de un usuario para desplegar su lista de fichas en línea; cada nombre de ficha es a su vez un enlace a la página de detalle de la ficha. Todo el árbol (tipo de ficha → rol → usuario → fichas) llega en una sola petición, por lo que la navegación es instantánea.

Un **filtro por nombre** en la parte superior del widget reduce el árbol a los usuarios cuyo nombre o correo coincide con lo escrito; los tipos de ficha coincidentes se expanden automáticamente para que los resultados sean visibles sin un clic adicional. Úselo para responder a «¿dónde aparece Alice en la organización?» en un segundo.

Más allá del directorio, aparece una pequeña **ventana emergente al pasar el cursor** cuando este se detiene sobre el nombre de una parte interesada en otro lugar de la aplicación —en la pestaña Partes interesadas de una ficha, en el propietario de un riesgo en el Registro de riesgos o en la página de detalle del riesgo— y muestra la cartera completa de ese usuario agrupada por rol. Haga clic en cualquier ficha de la ventana para ir a ella. La ventana solo consulta los datos una vez por usuario y sesión.

## Personalizar paneles { #customizing-dashboards }

Los usuarios cuyo rol concede `admin.dashboards` (**Gestionar los paneles de la página de inicio**; por defecto, el rol Admin) pueden modificar todos los paneles y crear otros nuevos. El resto ve los paneles tal como están configurados.

![Panel - Modo de personalización](../assets/img/es/03_panel_personalizar.png)

### Modo de personalización

Haga clic en **Personalizar**, junto a las pestañas de los paneles, para editar el panel actual. En el modo de personalización:

- **Mueva** un widget arrastrándolo por su asa; la cuadrícula tiene 12 columnas de ancho y los demás widgets le hacen sitio.
- **Cambie el tamaño** de un widget desde su esquina inferior derecha.
- **Elimine** un widget con su botón de cierre.
- **Configure** una tarjeta KPI, un gráfico o el feed de actividad con su botón de engranaje.

Haga clic en **Guardar** para conservar los cambios para todos, o en **Descartar** para volver al panel tal como estaba.

### Añadir y restaurar widgets

**Añadir widget** abre un cajón con todos los widgets, agrupados en **KPI**, **Gráficos**, **Resumen**, **Mi espacio de trabajo** y **Administración**. Haga clic en uno para añadirlo al panel; una tarjeta KPI o un gráfico abre primero su configuración. Todos los widgets integrados permanecen en el catálogo, de modo que un widget eliminado por error —**Actividad reciente**, por ejemplo— se restaura añadiéndolo de nuevo. Los widgets que solo pueden aparecer una vez en un panel aparecen atenuados y marcados como ya añadidos cuando están presentes.

Un widget conserva su propio permiso dondequiera que se coloque: un widget de Administración añadido al panel Resumen sigue mostrándose solo a los usuarios con `admin.users`.

### Configurar una tarjeta KPI

Una tarjeta KPI muestra una de las métricas integradas (total de fichas, calidad de los datos, tareas abiertas, etc.) o una cifra que usted define:

- **Tipo de ficha** (opcional): contar solo las fichas de un tipo, acotadas opcionalmente a un subtipo, un estado de aprobación o una fase del ciclo de vida.
- **Medida**: **Número** de fichas, o **Suma** o **Media** de un campo numérico, de coste o de porcentaje de ese tipo.
- **Un aumento es**: **Bueno** o **Malo**: determina si una tendencia al alza se muestra en verde o en rojo.

Una nueva tarjeta KPI registra su primer valor en cuanto se guarda el panel, por lo que su tendencia empieza al día siguiente. Una suma o media de un campo de coste solo se muestra a los usuarios que pueden ver los costes.

### Configurar un gráfico

Un gráfico agrupa las fichas por una **dimensión** y mide cada grupo con una **medida**:

| Dimensión | Agrupa las fichas por |
|-----------|-----------------------|
| **Tipo de ficha** | Tipo de ficha |
| **Subtipo** | Subtipo del tipo de ficha elegido |
| **Estado de aprobación** | Aprobada, pendiente, rota, rechazada |
| **Fase del ciclo de vida** | La fase actual del ciclo de vida |
| **Calidad de los datos** | Tramo de calidad de datos (0–25 %, 25–50 %, …) |
| **Mes de creación** | Mes en que se creó la ficha |
| **Un campo** | Cualquier campo de selección única o de sí/no del tipo de ficha elegido |

La medida es el **Número de fichas**, o la **Suma** o la **Media** de un campo numérico, de coste o de porcentaje. Solo se ofrecen los tipos de ficha que puede leer, y los campos de coste solo a los usuarios que pueden ver los costes.

| Gráfico | Ideal para |
|---------|------------|
| **Barras** / **Columnas** | Comparar grupos, en horizontal o en vertical |
| **Líneas** | Una tendencia en el tiempo, como las fichas creadas por mes |
| **Circular** / **Anillo** | Partes de un todo |
| **Indicador** | Un valor frente a un máximo (sin agrupar) |
| **Mapa de calor** | Dos dimensiones a la vez; por ejemplo, la fase del ciclo de vida frente al estado de aprobación |
| **Treemap** | Partes cuando hay muchos grupos |
| **Sankey** | El flujo de un tipo de relación entre las fichas que conecta |

Active el clic para que los lectores puedan abrir el [Inventario](inventory.md) o el informe que hay detrás de una barra o un sector (gráficos de barras, columnas, líneas, circulares, anillo y treemap). Una vista previa en el cuadro de diálogo muestra el gráfico tal como aparecerá.

### Gestionar paneles

El menú **⋮** junto a las pestañas actúa sobre el panel actual:

| Acción | Qué hace |
|--------|----------|
| **Nuevo panel** | Crea un panel vacío, listo para llenar con widgets |
| **Duplicar** | Copia el panel con todos sus widgets: un buen punto de partida para una variante de un panel integrado |
| **Ajustes** | Nombre, descripción, icono y **Acceso**: los roles autorizados a ver el panel. Deje el acceso vacío para mostrarlo a todos. Los usuarios con `admin.dashboards` siempre ven todos los paneles |
| **Ocultar** / **Mostrar** | Quita el panel de las pestañas de los demás sin eliminarlo |
| **Mover a la izquierda** / **Mover a la derecha** | Cambia el orden de las pestañas |
| **Restablecer valores predeterminados** | Solo paneles integrados: restaura los widgets y el diseño con los que se entrega Turbo EA |
| **Eliminar** | Solo paneles personalizados: elimina el panel para todos |

Actualizar Turbo EA nunca sobrescribe un panel que haya modificado. Cuando una versión mejora un panel integrado, **Restablecer valores predeterminados** incorpora la nueva versión.

Cada cambio en un panel —creado, editado, duplicado, restablecido o eliminado, incluidos los widgets añadidos o eliminados— se registra en el [Registro de auditoría](../admin/audit-log.md#administrative-actions). Los paneles viajan con una [transferencia de espacio de trabajo](../admin/workspace-transfer.md).
