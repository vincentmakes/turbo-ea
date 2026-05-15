# Personalice el metamodelo — ligeramente

El metamodelo de Turbo EA es totalmente **configurable por el administrador** — cada tipo de ficha, campo, subtipo, relación y rol de interesado es dato, no código. Estará tentado a rediseñarlo. **No lo haga.**

Los equipos que tienen éxito personalizan el metamodelo **solo cuando los campos predeterminados no pueden responder a su pregunta**. Los equipos que fracasan pasan su primer mes renombrando `Application` a `Solution`, agregando 30 campos personalizados, y nunca llegan a un informe funcional.

## La prueba de dos preguntas antes de agregar un campo

Antes de agregar un solo campo personalizado, pregúntese:

1. **¿Filtraré, agruparé o haré informes sobre este campo?** Si no, pertenece a la descripción o a una etiqueta — no a un campo.
2. **¿Se necesita la misma respuesta en cada ficha de este tipo?** Si no, es una relación o un archivo adjunto, no un campo.

Si no puede responder "sí" a ambas, no agregue el campo.

## Ejemplo trabajado: agregar una disposición TIME

Para una Racionalización del portafolio de aplicaciones, necesita una sola decisión por aplicación: **T**olerar / **I**nvertir / **M**igrar / **E**liminar (el marco **TIME**, popularizado por Gartner). El metamodelo integrado no incluye un campo `timeDisposition`, así que este es uno de los raros casos donde agregar un campo personalizado es lo correcto.

Lo vamos a agregar como un campo `single_select` en el tipo `Application`, con cuatro opciones codificadas por color, peso 1 para que contribuya a la calidad de datos.

### Paso 1 — Abra el editor de tipo

1. Vaya a **Admin → Metamodelo**.
2. Haga clic en la ficha del tipo **Application**.
3. El cajón del tipo se abre a la derecha. Cambie a la pestaña **Campos**.

### Paso 2 — Agregue el campo

1. Elija la sección donde quiere que aterrice el campo (o cree una nueva sección llamada "Decisión de Portafolio").
2. Haga clic en **+ Agregar campo** en esa sección.
3. Complete:
    - **Clave**: `timeDisposition`  *(camel-case en minúsculas, sin espacios, se convierte en la clave de atributo en JSON)*
    - **Etiqueta**: *Disposición de Portafolio (TIME)*
    - **Tipo**: `single_select`
    - **Peso**: `1`  *(contribuye a la puntuación de Calidad de Datos)*
    - **Obligatorio**: déjelo **desactivado** — obligatorio bloquearía la aprobación de cada ficha existente.
4. Agregue las cuatro opciones:

    | Clave | Etiqueta | Color |
    |-------|----------|-------|
    | `tolerate` | Tolerar | gris / neutral |
    | `invest` | Invertir | verde |
    | `migrate` | Migrar | ámbar |
    | `eliminate` | Eliminar | rojo |

5. **Agregue traducciones** para la etiqueta y cada opción en cada idioma que soporte — la página 4 de [Admin → Metamodelo](../admin/metamodel.md) cubre el editor de traducciones. Omitir esto significa que los usuarios no anglófonos verán "timeDisposition" textualmente.
6. Guarde.

### Paso 3 — Confirme que funciona

1. Abra cualquier ficha de Aplicación. El nuevo campo aparece en su sección, vacío.
2. Elija un valor, guarde. El anillo de Calidad de Datos debería subir unos puntos porcentuales.
3. De vuelta en **Inventario**, el campo está ahora disponible en la pestaña **Columnas** y como filtro — ya puede filtrar aplicaciones por TIME.

Eso es todo. Un campo, diez minutos, inmediatamente útil.

## Alternativa: use un Grupo de Etiquetas en su lugar

Si el valor es informativo en lugar de consultable, un **Grupo de Etiquetas** (Admin → Etiquetas) es más ligero que un campo personalizado — sin cambio en el metamodelo, sin migración, más fácil de evolucionar. Use un Grupo de Etiquetas cuando:

- El valor es descriptivo ("De cara al cliente", "Solo interno", "Adquirido en 2024").
- Puede agregar nuevas opciones con frecuencia.
- No lo necesita en un menú desplegable de filtro pero un chip de etiqueta de búsqueda mientras escribe está bien.

Use un campo personalizado cuando:

- Necesite el valor en los ejes del Informe de Portafolio (X, Y, color).
- Quiera que se pondere en la Calidad de Datos.
- Es un vocabulario controlado que no cambiará a menudo.

La disposición TIME está en el campo del campo personalizado porque la usaremos como eje de color del Informe de Portafolio en la siguiente página.

## Antipatrones a evitar

Estos son los errores de metamodelo más comunes en los primeros despliegues:

!!! warning "No renombre tipos de ficha integrados"
    Renombrar `Application` a `Solution` se ve ordenado pero rompe el mapeo conceptual que el Mapa de Calor de Capacidades, el Informe de Portafolio y los catálogos asumen. Si su organización los llama "Soluciones", establezca la traducción de **etiqueta** — la `clave` subyacente sigue siendo `Application`.

!!! warning "No agregue 30 campos personalizados el primer día"
    Cada campo personalizado agrega fricción a la recopilación de datos y diluye la puntuación de Calidad de Datos. Agregue un campo, úselo durante un mes, luego agregue el siguiente.

!!! warning "No haga los nuevos campos `obligatorios` el primer día"
    `Obligatorio` bloquea la aprobación de cada ficha existente que no tiene un valor. Haga un campo obligatorio solo **después** de haberlo completado para más del 80% de la población.

!!! warning "No cree tipos de ficha personalizados en lugar de campos personalizados"
    "App Móvil" debería ser un subtipo de `Application`, no un nuevo tipo de ficha. Los nuevos tipos no obtienen mapeo de capacidades, informes de portafolio ni importaciones de catálogos de forma gratuita.

## Otras extensiones ligeras que puede querer

Estas son extensiones comunes de segunda pasada, pero **no las agregue hasta que realmente las necesite**:

| Necesidad | Dónde agregar | Tipo |
|-----------|---------------|------|
| Calificación de valor de negocio | Application | `single_select` (Alto/Medio/Bajo) — impulsa el eje Y del Informe de Portafolio |
| Calificación de aptitud técnica | Application | `single_select` — impulsa el eje X |
| Preparación para la nube | Application | `single_select` (Listo / Necesita refactor / Permanece on-prem) |
| Categoría de riesgo de pérdida | Application, IT Component | `single_select` (Punto único de fallo, etc.) |
| División de costos | Application | campos `cost` para `costRunTotalAnnual`, `costChangeTotalAnnual` |

Cada uno pasa la prueba de las dos preguntas para análisis de portafolio. Cada uno es también un buen candidato para una fórmula calculada en lugar de entrada manual — que es lo que cubre la siguiente página.

Siguiente: [Su primer análisis: Armonización de Aplicaciones](your-first-analysis.md).
