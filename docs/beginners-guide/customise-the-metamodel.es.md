# Personalice el metamodelo — ligeramente

El metamodelo de Turbo EA es totalmente **configurable por el administrador** — cada tipo de ficha, campo, subtipo, relación y rol de interesado es dato, no código. Estará tentado a rediseñarlo. **No lo haga.**

Los equipos que tienen éxito personalizan el metamodelo **solo cuando los campos predeterminados no pueden responder a su pregunta**. Los equipos que fracasan pasan su primer mes renombrando `Application` a `Solution`, agregando 30 campos personalizados, y nunca llegan a un informe funcional.

## Lo que ya está en el metamodelo

Antes de agregar cualquier cosa, sepa lo que ya tiene. El tipo de ficha integrado **Application** viene de fábrica con estos campos (entre otros):

| Campo integrado | Tipo | Para qué sirve |
|-----------------|------|----------------|
| `businessCriticality` | `single_select` | Crítico para la misión / Importante / Útil / Marginal |
| `functionalSuitability` | `single_select` | Perfect / Appropriate / Insufficient / Unreasonable |
| `technicalSuitability` | `single_select` | Fully Appropriate / Adequate / Unreasonable / Inappropriate |
| `timeModel` | `single_select` (obligatorio) | **Tolerate / Invest / Migrate / Eliminate** — la disposición TIME canónica de Gartner |
| `riskLevel` | `single_select` | Bajo / Medio / Alto / Crítico |
| `businessValue` | `single_select` | Impulsa el eje Y del Informe de Portafolio |
| `costTotalAnnual` | `cost` | Costo anual total |
| `lifecycle.*` | fechas | Plan / Phase In / Active / Phase Out / End of Life |

Todo lo que necesita una Racionalización del Portafolio de Aplicaciones ya está ahí, incluido el **Modelo TIME**. No necesita agregar un campo TIME — lo completa (manualmente o mediante un cálculo, vea [Su primer análisis](your-first-analysis.md)). Lo mismo es cierto para `functionalSuitability` y `technicalSuitability`, las dos dimensiones de idoneidad que clásicamente impulsan una ubicación TIME.

## La prueba de dos preguntas antes de agregar un campo

Cuando se encuentre necesitando un campo que realmente no está en el metamodelo, pregúntese:

1. **¿Filtraré, agruparé o haré informes sobre este campo?** Si no, pertenece a la descripción o a una etiqueta — no a un campo.
2. **¿Se necesita la misma respuesta en cada ficha de este tipo?** Si no, es una relación o un archivo adjunto, no un campo.

Si no puede responder "sí" a ambas, no agregue el campo.

## Si realmente necesita un campo personalizado

Para el caso raro donde realmente se necesita un campo genuinamente nuevo (por ejemplo, una marca `cloudReadiness`, una clasificación regulatoria, un marcador de segmento de cliente), el flujo de trabajo es:

1. Vaya a **Admin → Metamodelo**, haga clic en el tipo, cambie a la pestaña **Campos**.
2. Elija la sección (o cree una nueva) y haga clic en **+ Agregar campo**.
3. Complete:
    - **Clave** en camel-case en minúsculas (por ejemplo, `cloudReadiness`) — se convierte en la clave de atributo en JSON y en las fórmulas.
    - **Etiqueta** (y una traducción para cada idioma que soporte — de lo contrario los usuarios no anglófonos verán la clave en bruto).
    - **Tipo** — `text`, `number`, `cost`, `boolean`, `date`, `url`, `single_select`, `multiple_select`.
    - **Peso** — `0` para excluir de Calidad de Datos, `1`+ para incluirlo y ponderarlo.
    - **Obligatorio** — déjelo **desactivado** para el primer despliegue; obligatorio bloquea la aprobación de cada ficha existente.
4. Para los tipos de selección, agregue las opciones (clave + etiqueta + color) y traduzca cada opción.
5. Guarde.

El campo está inmediatamente disponible en **Inventario** (Columnas, filtros), en el Detalle de la ficha y en las fórmulas de **Cálculos** como `<fieldKey>`. Referencia completa: [Admin → Metamodelo](../admin/metamodel.md).

## Alternativa: use un Grupo de Etiquetas en su lugar

Si el valor es informativo en lugar de consultable, un **Grupo de Etiquetas** (Admin → Etiquetas) es más ligero que un campo personalizado — sin cambio en el metamodelo, sin migración, más fácil de evolucionar. Use un Grupo de Etiquetas cuando:

- El valor es descriptivo ("De cara al cliente", "Solo interno", "Adquirido en 2024").
- Puede agregar nuevas opciones con frecuencia.
- No lo necesita en un menú desplegable de filtro pero un chip de etiqueta de búsqueda mientras escribe está bien.

Use un campo personalizado cuando:

- Necesite el valor en los ejes del Informe de Portafolio (X, Y, color).
- Quiera que se pondere en la Calidad de Datos.
- Es un vocabulario controlado que no cambiará a menudo.

## Antipatrones a evitar

Estos son los errores de metamodelo más comunes en los primeros despliegues:

!!! warning "No renombre tipos de ficha integrados"
    Renombrar `Application` a `Solution` se ve ordenado pero rompe el mapeo conceptual que el Mapa de Calor de Capacidades, el Informe de Portafolio y los catálogos asumen. Si su organización los llama "Soluciones", establezca la traducción de **etiqueta** — la `clave` subyacente sigue siendo `Application`.

!!! warning "No agregue 30 campos personalizados el primer día"
    Cada campo personalizado agrega fricción a la recopilación de datos y diluye la puntuación de Calidad de Datos. Agregue un campo, úselo durante un mes, luego agregue el siguiente.

!!! warning "No duplique campos integrados"
    Antes de agregar `timeDisposition`, `funcFit`, `techFit` o `appBusinessValue`, revise la lista de campos existentes — es probable que ya exista un campo integrado equivalente (`timeModel`, `functionalSuitability`, `technicalSuitability`, `businessValue`). Los duplicados dividen sus datos y rompen los informes.

!!! warning "No haga los nuevos campos `obligatorios` el primer día"
    `Obligatorio` bloquea la aprobación de cada ficha existente que no tiene un valor. Haga un campo obligatorio solo **después** de haberlo completado para más del 80% de la población.

!!! warning "No cree tipos de ficha personalizados en lugar de campos personalizados"
    "App Móvil" debería ser un subtipo de `Application`, no un nuevo tipo de ficha. Los nuevos tipos no obtienen mapeo de capacidades, informes de portafolio ni importaciones de catálogos de forma gratuita.

## Otras extensiones ligeras que puede querer

Estas son extensiones comunes de segunda pasada, pero **no las agregue hasta que realmente las necesite**:

| Necesidad | Dónde agregar | Tipo |
|-----------|---------------|------|
| Preparación para la nube | Application | `single_select` (Listo / Necesita refactor / Permanece on-prem) |
| Marca de cara al cliente | Application | `boolean` |
| Clasificación regulatoria | Application, DataObject | `multiple_select` (GDPR, PCI-DSS, …) |
| Categoría de riesgo de pérdida | Application, IT Component | `single_select` (Punto único de fallo, etc.) |
| División de costos | Application | campos `cost` adicionales para `costRunTotalAnnual`, `costChangeTotalAnnual` |

Cada uno pasa la prueba de las dos preguntas para análisis de portafolio. Varios de ellos también son buenos candidatos para una fórmula **calculada** en lugar de entrada manual — que es lo que cubre la siguiente página, usando `timeModel` como ejemplo de trabajo.

Siguiente: [Su primer análisis: Armonización de Aplicaciones](your-first-analysis.md).
