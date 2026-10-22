# Personalice el metamodelo — ligeramente

El metamodelo de Turbo EA es totalmente **configurable por el administrador** — cada tipo de ficha, campo, subtipo, relación y rol de interesado es dato, no código. Estará tentado a rediseñarlo. **No lo haga.**

Los equipos que tienen éxito personalizan el metamodelo **solo cuando los campos predeterminados no pueden responder a su pregunta**. Los equipos que fracasan pasan su primer mes renombrando `Application` a `Solution`, agregando 30 campos personalizados, y nunca llegan a un informe funcional.

## Lo que ya está en el metamodelo

Antes de agregar cualquier cosa, sepa lo que ya tiene. El tipo de ficha integrado **Application** viene de fábrica con estos campos (entre otros):

| Campo integrado | Tipo | Para qué sirve |
|-----------------|------|----------------|
| `businessCriticality` | `single_select` (obligatorio) | Crítico para la misión / Crítico para el negocio / Operativo / Administrativo |
| `functionalSuitability` | `single_select` | Perfecto / Apropiado / Insuficiente / Inadecuado |
| `technicalSuitability` | `single_select` | Totalmente apropiado / Adecuado / Inadecuado / Inapropiado |
| `timeModel` | `single_select` (obligatorio) | **Tolerar / Invertir / Migrar / Eliminar** — la disposición TIME canónica de Gartner |
| `costTotalAnnual` | `cost` | Coste anual total |
| `lifecycle.*` | fechas | Plan / Phase In / Active / Phase Out / End of Life |

Todo lo que necesita una Racionalización del Portafolio de Aplicaciones ya está ahí, incluido el **Modelo TIME**. No necesita agregar un campo TIME — lo deriva con un cálculo (vea más abajo) o lo completa a mano, vea [Su primer análisis](your-first-analysis.md). Lo mismo es cierto para `functionalSuitability` y `technicalSuitability`, las dos dimensiones de idoneidad que clásicamente impulsan una ubicación TIME, y para `businessCriticality`, que agrupa el informe Portafolio de aplicaciones.

## La prueba de dos preguntas antes de agregar un campo

Cuando se encuentre necesitando un campo que realmente no está en el metamodelo, pregúntese:

1. **¿Filtraré, agruparé o haré informes sobre este campo?** Si no, pertenece a la descripción o a una etiqueta — no a un campo.
2. **¿Se necesita la misma respuesta en cada ficha de este tipo?** Si no, es una relación o un archivo adjunto, no un campo.

Si no puede responder "sí" a ambas, no agregue el campo.

## Si realmente necesita un campo personalizado

Para el caso raro donde realmente se necesita un campo genuinamente nuevo (por ejemplo, una marca `cloudReadiness`, una clasificación regulatoria, un marcador de segmento de cliente), el flujo de trabajo es:

1. Vaya a **Admin → Metamodelo** y haga clic en el tipo. El diseño de la ficha está en la pestaña **General**.
2. Elija la sección (o cree una con **Agregar sección**) y haga clic en **+ Campo**.
3. Complete:
    - **Clave** en camel-case en minúsculas (por ejemplo, `cloudReadiness`) — se convierte en la clave de atributo en JSON y en las fórmulas.
    - **Etiqueta** (y una traducción para cada idioma que soporte — de lo contrario los usuarios no anglófonos verán la clave en bruto).
    - **Tipo** — `text`, `multiline_text`, `number`, `cost`, `percentage`, `boolean`, `date`, `url`, `single_select`, `multiple_select`.
    - **Obligatorio** — déjelo **desactivado** para el primer despliegue; mientras un campo obligatorio esté vacío, la puntuación de Calidad de Datos de la ficha queda fijada en 0.
4. Para los tipos de selección, agregue las opciones (clave + etiqueta + color) y traduzca cada opción.
5. Guarde.
6. Opcional: defina cuánto cuenta el campo para la Calidad de Datos en la pestaña **Calidad de datos** del tipo.

El campo está inmediatamente disponible en **Inventario** (Columnas, filtros), en el Detalle de la ficha y en las fórmulas de **Cálculos** como `<fieldKey>`. Referencia completa: [Admin → Metamodelo](../admin/metamodel.md).

## Opción: derive un campo automáticamente con un Cálculo { #option-derive-a-field-automatically-with-a-calculation }

Además de la opción estándar de que los usuarios completen un campo manualmente, Turbo EA puede **calcular el valor de un campo automáticamente** a partir de otros campos de la misma ficha — incluidos los integrados — utilizando la función **Cálculos**. El campo calculado se vuelve de solo lectura y lleva una insignia de "calculado" para que los usuarios no puedan desviarse de la regla.

El ejemplo canónico es el cálculo del **Modelo TIME**, que deriva el campo integrado `timeModel` en Application a partir de las dos valoraciones de idoneidad integradas. Créelo en **Admin → Metamodelo → Cálculos** con **Nuevo cálculo**: Tipo de ficha de destino = `Application`, Campo de destino = **Modelo TIME**, y esta fórmula:

```
# TIME Model from the built-in Functional and Technical Suitability (Gartner quadrants)
ff = MAP_SCORE(data.functionalSuitability, {"perfect": 4, "appropriate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalSuitability, {"fullyAppropriate": 4, "adequate": 3, "unreasonable": 2, "inappropriate": 1})
IF(ff is None or tf is None, None, IF(ff >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))
```

Cada valoración se convierte en una puntuación de 4 (la mejor) a 1 (la peor), y las dos puntuaciones sitúan la aplicación en uno de los cuatro cuadrantes: idoneidad funcional alta + técnica alta = **Invertir**, funcional alta + técnica baja = **Migrar**, funcional baja + técnica alta = **Tolerar**, baja en ambas = **Eliminar**. Una aplicación a la que le falte cualquiera de las dos valoraciones no recibe valor TIME, de modo que los huecos siguen siendo visibles.

Es el mismo ejemplo de TIME que encontrará en el panel **Referencia de fórmulas** del editor de cálculos, así que también puede copiarlo desde allí. Solo lee campos que Application ya tiene, así que **no necesita agregar ningún campo** — y no debería hacerlo (vea *No duplique campos integrados* más abajo). Más sintaxis de fórmulas: [Admin → Cálculos](../admin/calculations.md).

Después de guardar, ponga el cálculo en **Activo** y haga clic en **Recalcular todo** en su fila para que cada aplicación existente reciba su valor. El recorrido paso a paso está en [Su primer análisis → Paso 3](your-first-analysis.md).

!!! warning "No haga esto"
    Un TIME calculado es una **hipótesis inicial**, no un veredicto. Revise cada resultado con el Propietario de la Aplicación antes de confiar en él.

El patrón híbrido que funciona bien en la práctica: mantenga el cálculo activo mientras construye el inventario y recopila las valoraciones de idoneidad; revise los resultados en el taller de validación; y si las decisiones deben apartarse de la fórmula, desactive el cálculo (el interruptor **Activo**) para que el campo vuelva a ser editable y las decisiones manuales se mantengan.

## Alternativa: use un Grupo de Etiquetas en su lugar

Si el valor es informativo en lugar de consultable, un **Grupo de Etiquetas** (Admin → Metamodelo → Etiquetas) es más ligero que un campo personalizado — sin cambio en el metamodelo, sin migración, más fácil de evolucionar. Use un Grupo de Etiquetas cuando:

- El valor es descriptivo ("De cara al cliente", "Solo interno", "Adquirido en 2024").
- Puede agregar nuevas opciones con frecuencia.
- No lo necesita en un menú desplegable de filtro pero un chip de etiqueta de búsqueda mientras escribe está bien.

Use un campo personalizado cuando:

- Quiera agrupar o colorear un informe por él (por ejemplo, el Portafolio de aplicaciones).
- Quiera que se pondere en la Calidad de Datos.
- Es un vocabulario controlado que no cambiará a menudo.

## Antipatrones a evitar

Estos son los errores de metamodelo más comunes en los primeros despliegues:

!!! warning "No renombre tipos de ficha integrados"
    Renombrar `Application` a `Solution` se ve ordenado pero rompe el mapeo conceptual que el Mapa de capacidades, el informe Portafolio de aplicaciones y los catálogos asumen. Si su organización los llama "Soluciones", establezca la traducción de **etiqueta** — la `clave` subyacente sigue siendo `Application`.

!!! warning "No agregue 30 campos personalizados el primer día"
    Cada campo personalizado agrega fricción a la recopilación de datos y diluye la puntuación de Calidad de Datos. Agregue un campo, úselo durante un mes, luego agregue el siguiente.

!!! warning "No duplique campos integrados"
    Antes de agregar `timeDisposition`, `funcFit`, `techFit` o `appCriticality`, revise la lista de campos existentes — es probable que ya exista un campo integrado equivalente (`timeModel`, `functionalSuitability`, `technicalSuitability`, `businessCriticality`). Los duplicados dividen sus datos y rompen los informes.

!!! warning "No haga los nuevos campos `obligatorios` el primer día"
    Mientras un campo obligatorio esté vacío, la puntuación de Calidad de Datos de la ficha queda fijada en 0 y un banner de advertencia enumera lo que falta — en todas las fichas existentes a la vez. Haga un campo obligatorio solo **después** de haberlo completado para más del 80% de la población.

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
