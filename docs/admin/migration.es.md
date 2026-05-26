# Migración de plataforma

> Plataformas de origen admitidas hoy: **SAP LeanIX**. Otros adaptadores (Ardoq, Mega HOPEX, BiZZdesign, Avolution Abacus, …) se conectan a la misma canalización de preparación y aplicación, y aparecen automáticamente en el diálogo de carga cuando se entregan.

El importador de migración de plataforma (**Administración → Configuración → Migración**) ingiere un workspace completo de LeanIX y lo deposita como tarjetas, relaciones, etiquetas, partes interesadas, documentos, comentarios y un metamodelo totalmente desarrollado de Turbo EA en una sola operación por etapas, revisable.

## ¿Para quién es?

Para clientes que migran de LeanIX (SAP LeanIX) a Turbo EA. El importador acepta el libro xlsx **Full Snapshot** de LeanIX — la exportación multi-hoja con una hoja por tipo de fact sheet, una hoja por tipo de relación, más `TagGroups`, `Tags`, `Documents`, `Comments`, `Types` y una hoja de referencia `ReadMe`. Las cargas en otros formatos se rechazan ya en el paso de subida con un mensaje de error claro.

## Cómo obtener la exportación

En LeanIX, abra **Administration → Export → Full Snapshot**. Esto produce un único libro XLSX con todas las fact sheets **activas**, además de sus relaciones, grupos de etiquetas, etiquetas, documentos (llamados *resources* en LeanIX) y comentarios.

**Las fact sheets archivadas no se incluyen** en el Full Snapshot — restáurelas primero en LeanIX si necesita que lleguen a Turbo EA.

## El flujo de trabajo

1. **Cargar** el snapshot en **Configuración → Migración → Nueva migración**. El archivo permanece en el disco del servidor; la base de datos solo almacena metadatos. El parseo se ejecuta en segundo plano y el estado avanza automáticamente de `uploaded → parsed`.

2. **Revisar** cada tipo de entidad en la vista por pestañas. Cada fila staged lleva una acción:
    - `create` — se añadirá a Turbo EA
    - `update` — ya existe; se fusionarán los campos del diff
    - `skip` — ya existe sin cambios
    - `conflict` — falta endpoint, tipo no mapeado, colisión con built-in, correo malformado, etc. — vea la columna *Note* para el motivo completo

    Cada pestaña muestra encima de la tabla una fila de **píldoras de filtro** — una por tipo de tarjeta cuando aplica, si no por acción — para acotar una lista larga (cientos de tarjetas, decenas de tipos de fact sheets) a una porción a la vez. La pestaña **Tarjetas** muestra el **nombre** de la tarjeta resuelto junto al UUID de origen. La columna *Note* muestra el motivo completo del conflicto; las filas `update` listan los nombres de campo cambiados con un tooltip que detalla la transición `antiguo → nuevo`.

    Las pestañas **Nuevos tipos**, **Campos personalizados** y **Nuevas relaciones** muestran el metamodelo personalizado del tenant de su workspace de origen. Por defecto, se aceptan tal cual y crean tipos de tarjeta / campos / tipos de relación no-built-in correspondientes en Turbo EA.

3. **Mapear los campos importados** (opcional, en la pestaña **Campos personalizados**). Para cada columna personalizada de la plataforma de origen, elija una de tres opciones en el menú desplegable junto a la fila:
    - **Importar como nuevo campo personalizado** (por defecto) — la columna aterriza como un nuevo atributo en el tipo de tarjeta destino, bajo una sección sintética *Imported from {source}*.
    - **Mapear a un campo Turbo EA existente** — el valor se enruta a un campo built-in del tipo de tarjeta destino (p. ej. enviar `businessCriticality` de LeanIX al propio slot `businessCriticality` de TEA). La fila del campo de metamodelo se omite entonces al aplicar, así que no se crea ninguna columna huérfana.
    - **Mapear a una fase de ciclo de vida** — para columnas de fecha, el valor se enruta al slot estándar `plan` / `phaseIn` / `active` / `phaseOut` / `endOfLife` en `card.lifecycle`. Los valores de fecha/datetime se convierten automáticamente a `YYYY-MM-DD` (el sufijo `T00:00:00` que algunas plataformas escriben para celdas datetime se elimina); los valores no parseables se descartan para no corromper el mapa de lifecycle.
    - **No importar este campo** — la columna se omite por completo, ni como atributo ni como campo de metamodelo.

    El mapeo es por migración y puede editarse mientras el estado sea `parsed` o `previewed`. Las columnas base de la plataforma de origen que el adaptador enruta directamente a los slots estándar de Turbo EA (p. ej. LeanIX `name`, `displayName`, `description`, `status`, `category → subtype`, `lifecycle:*`, `qualitySeal`, `completion`) se listan al inicio de la pestaña en un banner informativo de solo lectura — no hay decisión de mapeo que tomar.

4. **Aplicar** cuando esté conforme. El pipeline de aplicación ejecuta 12 pasadas ordenadas por dependencias (tipos del metamodelo → campos del metamodelo → tipos de relación del metamodelo → usuarios → tarjetas → grupos de etiquetas → etiquetas → enlaces tarjeta-etiqueta → relaciones → suscripciones → documentos → comentarios) dentro de savepoints individuales — una fila fallida no envenena el resto del import. El estado avanza de `applying → applied` (o `failed` si los errores cruzan el umbral de seguridad).

    Si el snapshot parseado contiene filas en **conflict**, aparece un banner de advertencia sobre las pestañas de staging (con chips clickables que saltan a la pestaña afectada) y al hacer clic en **Aplicar** se abre un diálogo de confirmación que detalla qué tipos llevan conflictos. Debe reconocer explícitamente que las filas en conflicto se omitirán antes de que se ejecute el apply. El *Resultado del apply* posterior muestra un chip *conflictos* dedicado junto a *creados / actualizados / omitidos / errores* — los conflictos no son skips silenciosos, son un resultado de primer orden visible en el historial de migración.

## Lo que se importa

| LeanIX | Turbo EA |
|---|---|
| Application, ITComponent, Business Capability, Business Context, Process, DataObject, Interface, Provider, TechCategory, Platform, Objective, Project / Initiative | Mapeo directo 1:1 de tipo de tarjeta |
| User Group | Organization con subtipo `team`, etiquetado `leanix_origin=UserGroup` |
| Fases de ciclo de vida (plan / phaseIn / active / phaseOut / endOfLife) | Trasladadas literalmente a `cards.lifecycle` |
| Jerarquía (`childParentRelation`) | Plegada en `Card.parent_id` |
| Aristas Sucesor/Predecesor (`*SuccessorRelation`) | Almacenadas como relaciones; la dirección se invierte al importar para que la convención de Turbo EA «source sucede target» coincida con la semántica de LeanIX «X tiene sucesor Y». Los nuevos tipos de tarjeta del tenant tienen `has_successors=true` para que se renderice la vista de linaje. |
| Relaciones (50+ tipos de aristas predeterminados de LeanIX, tanto en notación xlsx `applicationITComponentRelation` como GraphQL `relApplicationToITComponent`) | Relaciones nativas de Turbo EA con atributos de arista |
| Tipos de relación definidos por el tenant (Server↔Application, lxSystem*, lxDora*, microservice*, ESG*, etc.) | Nuevas filas `relation_types` no-built-in, creadas automáticamente en la misma pasada de importación para que cada arista realmente aterrice |
| Tags (grupos single/multi) | Grupos de tags + tags + joins por tarjeta |
| Suscripciones (una por rol RESPONSIBLE/OBSERVER) | Filas de stakeholders; los usuarios se crean automáticamente desactivados (`is_active=false`) |
| Documentos (URL) | Adjuntos de tipo documento |
| Comentarios (nivel superior + respuestas, aplanados) | Filas de comentarios |
| Tipos de fact sheet personalizados del tenant (p. ej. `ESGCapability`, `Server`, `System`, `TechPlatform`, `TechnicalStack`) | Nuevos tipos de tarjeta no-built-in con `has_hierarchy=true`, `has_successors=true` y una sección `Imported from LeanIX` pre-poblada |
| Campos personalizados del tenant | Añadidos al `fields_schema` del tipo objetivo bajo una sección sintética `Imported from LeanIX`. El tipo de campo y la lista **completa** de opciones enum se extraen de la hoja `ReadMe` del libro — `currentMaturity` aterriza como single-select con los 5 valores (`adHoc, repeatable, defined, managed, optimized`) incluso cuando los datos usan solo uno |
| Tipos de relación personalizados del tenant | Nuevos tipos de relación no-built-in, con tipos de endpoints traducidos a través del mapa LX↔TEA (`UserGroup → Organization`, etc.) |

### Por qué importa la hoja ReadMe

La primera hoja del xlsx (`ReadMe`) es la referencia autoritativa de campos de LeanIX: cada columna documentada con su tipo (`String`, `Integer`, `Percent`, `Datetime`, `Boolean`, `String list`) y, cuando aplica, su restricción enum completa (`Possible values: one of A, B, C.`). El importador lee primero esta hoja y la usa como fuente principal de verdad para los metadatos de campo — recurriendo a la hoja in-data `Types` solo cuando el ReadMe no cubre una columna. Esta es la diferencia entre un campo importado como entrada de texto libre y un dropdown adecuado con las opciones correctas.

## Lo que **no** se importa

El snapshot no contiene lo siguiente — el importador marca lo faltante en la columna *Note* por fila:

- **Binarios de documentos** — solo URLs están en el snapshot; el importador crea documentos tipo enlace. Recargue binarios manualmente.
- **Threading de comentarios** — las respuestas se aplanan a comentarios de nivel superior para preservar el texto; los padres de hilo requerirían metadatos de UI de LeanIX que no están en el snapshot.
- **Contraseñas de usuario y vínculos SSO** — los usuarios auto-creados aterrizan desactivados. Invítelos o vincúlelos a SSO después.
- **Historial de auditoría** previo a la importación — el historial de Turbo EA comienza con el timestamp de apply.
- **Diagramas / pósters / dashboards / búsquedas guardadas / preferencias de notificación / tokens API / webhooks** — sin equivalente en Turbo EA o sin análogo en el snapshot.

## Reejecución de un import

La idempotencia está incorporada. La tabla `migration_identity_map` registra la asignación UUID LeanIX → Turbo EA para cada entidad importada. Un re-upload del mismo snapshot (o de un snapshot actualizado del mismo workspace) detecta entidades existentes y escribe filas staged `update`/`skip` en vez de duplicar `create`s. El `external_id` de la tarjeta lleva el `factSheetId` de LeanIX, por lo que el vínculo sobrevive incluso si se borra la identity map.

Si necesita rehacer una importación (p. ej., borró en bloque las tarjetas importadas en la UI y quiere ingresarlas de nuevo), use el icono de papelera en la fila de migración para eliminarla y luego vuelva a cargar. Las migraciones `applied` son eliminables; al borrarlas se libera el lock de idempotencia por hash de archivo, permitiendo volver a cargar el mismo snapshot. Las filas huérfanas de `migration_identity_map` que apuntan a tarjetas inexistentes se podan automáticamente en la siguiente pasada de staging — nunca se requiere limpieza manual del mapa de identidad.

## Permiso

Esta página está protegida por el permiso `admin.migrate`. Por defecto, solo el rol **admin** lo tiene; concédalo explícitamente a otros roles en **Configuración → Roles** si quiere que un no-admin dirija la migración.

## Limitaciones a considerar

- **Una migración en curso por hash de archivo.** Recargar exactamente los mismos bytes mientras una migración para ese hash está activa devuelve el registro de migración existente (el hash SHA-256 es la clave natural de idempotencia). Elimine el registro de migración primero si realmente quiere ingerir el mismo archivo otra vez.
- **Workspaces grandes** (10k+ fact sheets): el parser hace streaming, pero el pipeline de apply escribe filas en una transacción por pasada. Planifique ~15 minutos para imports muy grandes.
- **Campos, valores y tags personalizados son tolerados, no pre-mapeados.** Cualquier columna de LeanIX que no esté en el metamodelo built-in de Turbo EA aterriza textualmente en el mapa `attributes` de la tarjeta importada y aparece en la pestaña **Campos personalizados** para que un admin pueda procesarla (enrutarla a un campo TEA existente, a una fase de ciclo de vida, u omitirla — vea *Mapear los campos importados* en el flujo de arriba). Lo mismo para grupos de tags definidos por el tenant y tipos de relación añadidos por las plataformas de origen (p. ej., `lxSystemSystem*`, `*Lx*Dora*`, `microservice*`, `eSGCapability*`) — aparecen sin cambios en las pestañas **Nuevos tipos** / **Nuevas relaciones**, listos para decisión del admin.
- **Los correos de suscripción aceptan ambos separadores.** El export «Full Snapshot» de LeanIX separa correos en celdas `subscriptions:<RoleType>[:<RoleName>]` con `;`; el export GraphQL CSV usa `,`. El parser acepta cualquiera. Las filas con correo malformado (sin `@`, o un separador no dividido) se staged como `conflict` con motivo claro en lugar de crearse como usuarios falsos — corrija el export de origen y recargue.

## Limpieza

Borrar un registro de migración (Configuración → Migración → icono de papelera) elimina tanto las filas de base de datos de esa migración (los registros staged cascadean) como el archivo de snapshot en disco. Las migraciones en estado `uploaded`, `parsed`, `previewed`, `failed`, `aborted` y `applied` son todas eliminables; una migración `applying` debe terminar (o fallar) antes de poder eliminarse.
