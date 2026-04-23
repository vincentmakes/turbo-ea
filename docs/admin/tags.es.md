# Etiquetas

La función de **Etiquetas** (**Administrador > Metamodelo > pestaña Etiquetas**) le permite crear etiquetas de clasificación que los usuarios pueden aplicar a las fichas. Las etiquetas se organizan en **grupos de etiquetas**, cada uno con su propio modo de selección, restricciones de tipo y un indicador opcional de obligatoriedad que se integra con el flujo de aprobación y con el puntaje de calidad de los datos.

## Grupos de etiquetas

Un grupo de etiquetas es una categoría de etiquetas. Por ejemplo, podría crear grupos como «Dominio de Negocio», «Marco de Cumplimiento» o «Propiedad del Equipo».

### Crear un grupo de etiquetas

Haga clic en **+ Nuevo Grupo de Etiquetas** y configure:

| Campo | Descripción |
|-------|-------------|
| **Nombre** | Nombre visible en el detalle de ficha, los filtros del inventario y los informes. |
| **Descripción** | Texto libre opcional, visible sólo para administradores. |
| **Modo** | **Selección única** — una etiqueta por ficha. **Selección múltiple** — varias etiquetas por ficha. |
| **Obligatorio** | Cuando está activado, el grupo participa en la puerta de aprobación y en el puntaje de calidad de cada tipo de ficha al que aplica. Véase [Grupos de etiquetas obligatorios](#grupos-de-etiquetas-obligatorios) más abajo. |
| **Restringir a tipos** | Lista opcional de tipos de ficha permitidos. Si está vacía, el grupo está disponible en todos los tipos; en caso contrario, sólo los tipos listados ven el grupo en el detalle, filtros y portales. |

### Gestionar etiquetas

Dentro de cada grupo, puede agregar etiquetas individuales:

1. Haga clic en **+ Agregar Etiqueta** dentro de un grupo de etiquetas.
2. Introduzca el **nombre** de la etiqueta.
3. Opcionalmente, establezca un **color** para la distinción visual — el color determina el fondo del chip en el detalle de ficha, el inventario, los informes y los portales web.

Las etiquetas aparecen en la sección **Etiquetas** de las páginas de detalle, donde los usuarios con permiso pueden aplicarlas o eliminarlas.

## Restricciones de tipo

Configurar **Restringir a tipos** en un grupo de etiquetas lo limita en todas partes a la vez:

- **Detalle de ficha** — el grupo y sus etiquetas sólo se muestran en tipos de ficha coincidentes.
- **Barra lateral de filtros del inventario** — el chip del grupo sólo aparece en el `TagPicker` cuando la vista del inventario está filtrada a un tipo coincidente.
- **Portales web** — el grupo sólo se muestra a los lectores del portal cuando éste presenta un tipo coincidente.
- **Informes** — los desplegables de agrupación/filtro sólo incluyen el grupo para tipos coincidentes.

La interfaz de administración muestra los tipos asignados como pequeños chips en cada grupo, para ver el alcance de un vistazo.

## Grupos de etiquetas obligatorios

Marcar un grupo de etiquetas como **Obligatorio** lo convierte en un requisito de gobernanza: cada ficha a la que aplica el grupo debe llevar al menos una etiqueta del grupo.

### Puerta de aprobación

Una ficha no puede pasar a **Aprobada** mientras un grupo obligatorio aplicable esté sin satisfacer. Intentar aprobar devuelve el error `approval_blocked_mandatory_missing` y el detalle de la ficha lista qué grupos faltan. Dos matizaciones mantienen la puerta segura:

- Un grupo sólo aplica a una ficha si su lista **Restringir a tipos** está vacía o incluye el tipo de la ficha.
- Un grupo obligatorio que **aún no tiene etiquetas configuradas** se omite silenciosamente — esto evita una puerta de aprobación inaccesible por una configuración incompleta del administrador.

Una vez agregue las etiquetas requeridas, la ficha puede aprobarse con normalidad.

### Aporte a la calidad de datos

Los grupos obligatorios aplicables también alimentan el puntaje de calidad de datos de la ficha. Cada grupo satisfecho eleva el puntaje junto con los demás elementos obligatorios (campos requeridos, lados de relación obligatorios) que conforman el cálculo de integridad.

### Indicadores visuales

Los grupos obligatorios llevan un chip **Obligatorio** tanto en la lista de administración como en la sección Etiquetas del detalle de ficha. Las etiquetas obligatorias faltantes aparecen en el aviso de estado de aprobación y en la información sobre el aro de calidad de datos, para que los usuarios sepan exactamente qué agregar.

## Permisos

| Permiso | Qué permite |
|---------|-------------|
| `tags.manage` | Crear, editar y eliminar grupos y etiquetas en la interfaz de administración, y aplicar/quitar etiquetas en cualquier ficha independientemente de otros permisos. |
| `inventory.edit` + `card.edit` | Aplicar o quitar etiquetas en las fichas que el usuario puede editar (vía rol de aplicación o rol de stakeholder sobre esa ficha concreta). |

`tags.manage` se concede por defecto al rol admin. `inventory.edit` pertenece a admin, bpm_admin y member; `card.edit` se concede mediante las asignaciones de rol de stakeholder de la propia ficha.

Los lectores (viewers) **ven** las etiquetas pero no pueden modificarlas.

## Dónde aparecen las etiquetas

- **Detalle de ficha** — la sección Etiquetas lista los grupos aplicables y las etiquetas actualmente adjuntas. Los grupos obligatorios muestran un chip; los grupos restringidos sólo aparecen cuando el tipo de la ficha coincide.
- **Barra lateral de filtros del inventario** — un `TagPicker` agrupado permite filtrar la cuadrícula del inventario por una o más etiquetas. Los grupos y las etiquetas se filtran al tipo actual.
- **Informes** — el corte por etiquetas está disponible en los informes de portafolio, matriz y otros que admiten dimensiones de agrupación/filtro.
- **Portales web** — los editores pueden exponer filtros por etiquetas a lectores anónimos, para que los consumidores externos corten los paisajes públicos del mismo modo.
- **Diálogos de creación / edición** — el mismo `TagPicker` aparece al crear una ficha, permitiendo fijar etiquetas requeridas desde el principio — especialmente útil para grupos obligatorios.
