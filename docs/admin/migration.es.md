# Migración de plataforma (LeanIX)

El importador de migración de plataforma (**Administración → Configuración → Migración**) ingiere un workspace completo de LeanIX y lo deposita como tarjetas, relaciones, etiquetas, partes interesadas, documentos, comentarios y un metamodelo totalmente desarrollado de Turbo EA en una sola operación por etapas, revisable.

## ¿Para quién es?

Para clientes que migran de LeanIX (SAP LeanIX) a Turbo EA. El importador acepta **dos formatos de snapshot**, ambos detectados automáticamente por el contenido del archivo:

- **`.xlsx` Full Export** (predeterminado para la mayoría de clientes) — el libro multi-hoja que LeanIX produce mediante *Reports → Full Export*. Una hoja por tipo de fact sheet, una hoja por tipo de relación, más `TagGroups`, `Tags`, `Documents`, `Comments`, `Types` y una hoja de referencia `ReadMe`. Cualquier usuario de LeanIX puede generarlo; no se requiere acceso de administrador.
- **Snapshot JSON comprimido con gzip** (`workspace-<id>-<fecha>.json.gz`) — el snapshot de clonación entre tenants producido por **Administration → Workspace → Conduct a Data Snapshot**. Solo administradores.

Ambos formatos llegan al mismo modelo interno — el parser detecta automáticamente cuál se cargó según el contenido (sniff del magic ZIP `PK\x03\x04` para xlsx y del magic gzip `\x1f\x8b` para el snapshot JSON), por lo que una extensión mal nombrada se enruta correctamente.

## Cómo obtener la exportación

- **xlsx Full Export** — En LeanIX, **Reports → … → Full Export** produce un archivo como `20260518_snapshot_demo.xlsx`. Contiene todas las fact sheets activas, todas las relaciones, los metadatos de tags/documentos/comentarios y una hoja `ReadMe` que describe cada columna y sus valores permitidos.
- **Snapshot JSON Workspace** — En LeanIX, **Administration → Workspace → Conduct a Data Snapshot** activa el snapshot de clonación. El archivo de salida se llama típicamente `workspace-<id>-<fecha>.json.gz`. Se requiere acceso de administrador en LeanIX.

Si no tiene acceso de administrador en LeanIX pero dispone de un token API de tenant, la combinación de las consultas GraphQL `allFactSheets`, `subscriptions`, `relations` y `documents` produce un dataset JSON que coincide con la forma del snapshot — el importador también lo acepta.

## El flujo de trabajo

1. **Cargar** el snapshot en **Configuración → Migración → Nueva migración**. El archivo permanece en el disco del servidor; la base de datos solo almacena metadatos. El parseo se ejecuta en segundo plano y el estado avanza automáticamente de `uploaded → parsed`.

2. **Revisar** cada tipo de entidad en la vista por pestañas. Cada fila staged lleva una acción:
    - `create` — se añadirá a Turbo EA
    - `update` — ya existe; se fusionarán los campos del diff
    - `skip` — ya existe sin cambios
    - `conflict` — falta endpoint, tipo no mapeado o colisión con built-in — vea la columna *Note* para el motivo

    Las pestañas **Nuevos tipos**, **Campos personalizados** y **Nuevas relaciones** muestran el metamodelo personalizado del tenant de su workspace de LeanIX. Por defecto, se aceptan tal cual y crean tipos de tarjeta / campos / tipos de relación no-built-in correspondientes en Turbo EA. Para un control más fino, edite la clave/etiqueta/tipo propuestos en el JSON del registro staged antes de aplicar.

3. **Aplicar** cuando esté conforme. El pipeline de aplicación ejecuta 12 pasadas ordenadas por dependencias dentro de savepoints individuales — una fila fallida no envenena el resto del import. El estado avanza de `applying → applied` (o `failed` si los errores cruzan el umbral de seguridad).

## Lo que se importa

| LeanIX | Turbo EA |
|---|---|
| Application, ITComponent, Business Capability, Business Context, Process, DataObject, Interface, Provider, TechCategory, Platform, Objective, Project / Initiative | Mapeo directo 1:1 de tipo de tarjeta |
| User Group | Organization con subtipo `team`, etiquetado `leanix_origin=UserGroup` |
| Fases de ciclo de vida (plan / phaseIn / active / phaseOut / endOfLife) | Trasladadas literalmente a `cards.lifecycle` |
| Jerarquía (`childParentRelation`) | Plegada en `Card.parent_id` |
| Aristas Sucesor/Predecesor (`*SuccessorRelation`) | Almacenadas como relaciones; los nuevos tipos de tarjeta del tenant tienen `has_successors=true` para que se renderice la vista de linaje |
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

La idempotencia está incorporada. La tabla `leanix_identity_map` registra la asignación UUID LeanIX → Turbo EA para cada entidad importada. Un re-upload del mismo snapshot (o de un snapshot actualizado del mismo workspace) detecta entidades existentes y escribe filas staged `update`/`skip` en vez de duplicar `create`s. El `external_id` de la tarjeta lleva el `factSheetId` de LeanIX, por lo que el vínculo sobrevive incluso si se borra la identity map.

Si necesita rehacer una importación (p. ej., borró en bloque las tarjetas importadas en la UI y quiere ingresarlas de nuevo), use el icono de papelera en la fila de migración para eliminarla y luego vuelva a cargar. Las migraciones `applied` son eliminables; al borrarlas se libera el lock de idempotencia por hash de archivo, permitiendo volver a cargar el mismo snapshot. Las filas huérfanas de `leanix_identity_map` que apuntan a tarjetas inexistentes se podan automáticamente en la siguiente pasada de staging — nunca se requiere limpieza manual del mapa de identidad.

## Permiso

Esta página está protegida por el permiso `admin.migrate`. Por defecto, solo el rol **admin** lo tiene; concédalo explícitamente a otros roles en **Configuración → Roles** si quiere que un no-admin dirija la migración.

## Limitaciones a considerar

- **Una migración en curso por hash de archivo.** Recargar exactamente los mismos bytes mientras una migración para ese hash está activa devuelve el registro de migración existente (el hash SHA-256 es la clave natural de idempotencia). Elimine el registro de migración primero si realmente quiere ingerir el mismo archivo otra vez.
- **Workspaces grandes** (10k+ fact sheets): el parser hace streaming, pero el pipeline de apply escribe filas en una transacción por pasada. Planifique ~15 minutos para imports muy grandes.
- **Campos, valores y tags personalizados son tolerados, no pre-mapeados.** Cualquier columna de LeanIX que no esté en el metamodelo built-in de Turbo EA aterriza textualmente en el mapa `attributes` de la tarjeta importada y aparece en la pestaña **Campos personalizados** para que un admin pueda promoverla. Lo mismo para grupos de tags definidos por el tenant y tipos de relación añadidos por clientes de LeanIX (p. ej., `lxSystemSystem*`, `*Lx*Dora*`, `microservice*`, `eSGCapability*`) — aparecen sin cambios en las pestañas **Nuevos tipos** / **Nuevas relaciones**, listos para decisión del admin.

## Limpieza

Borrar un registro de migración (Configuración → Migración → icono de papelera) elimina tanto las filas de base de datos de esa migración (los registros staged cascadean) como el archivo de snapshot en disco. Las migraciones en estado `uploaded`, `parsed`, `previewed`, `failed`, `aborted` y `applied` son todas eliminables; una migración `applying` debe terminar (o fallar) antes de poder eliminarse.
