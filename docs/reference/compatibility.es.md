# Política de compatibilidad

A partir de la versión `1.0.0`, Turbo EA se compromete a ofrecer compatibilidad retroactiva documentada dentro de cada línea de versión principal. Esta página es el contrato: describe qué permanece estable, qué puede cambiar y cómo funcionan las obsolescencias, para que los operadores puedan planificar actualizaciones sin sorpresas.

La política se aplica a `1.x`. Una futura línea `2.x` podrá revisarla; en ese caso, las notas de la versión `2.0.0` incluirán una guía de migración.

---

## Qué cubre

### Esquema de base de datos (migraciones Alembic)

Dentro de `1.x`:

- Las migraciones son **aditivas** o **compatibles con versiones anteriores al actualizar**.
- Se pueden añadir columnas nuevas en cualquier momento.
- Las columnas existentes no se eliminarán sin pasar por un ciclo de obsolescencia.
- Las columnas existentes no se cambiarán de nombre sin pasar por un ciclo de obsolescencia (el cambio sigue estos pasos: add-new-column → backfill → deprecate-old-column → drop-in-next-major).
- Los cambios de tipo se limitan a ampliaciones (por ejemplo, `varchar(80)` → `varchar(255)`); las reducciones pasan por el ciclo de obsolescencia.
- Las restricciones de clave externa no se harán más estrictas sin un ciclo de obsolescencia (por ejemplo, `ON DELETE SET NULL` no pasará a `ON DELETE CASCADE`).

Los operadores pueden actualizar con confianza; la migración automática al iniciar el backend es segura para los datos de producción.

### Metamodelo integrado

Dentro de `1.x`, el metamodelo distribuido en `backend/app/services/seed.py` es estable:

- Las claves de los tipos de ficha integrados (`Application`, `Initiative`, `BusinessCapability`, etc.) no se cambiarán ni eliminarán.
- Las claves de los campos integrados de esos tipos no se eliminarán sin un ciclo de obsolescencia.
- Las claves de los tipos de relación integrados no se cambiarán ni eliminarán sin un ciclo de obsolescencia.
- Los subtipos predeterminados incluidos con los tipos integrados son estables.

Las personalizaciones propias de cada operador (tipos de ficha personalizados, campos añadidos desde la interfaz de administración y tipos de relación personalizados) son responsabilidad del operador y no están cubiertas por esta política.

### API REST (`/api/v1/`)

Dentro de `1.x`:

- Los endpoints de `/api/v1/` no se eliminarán sin un ciclo de obsolescencia.
- Los nombres de los campos existentes en solicitudes y respuestas no se cambiarán sin un ciclo de obsolescencia.
- Los tipos de campo no cambiarán de forma incompatible (por ejemplo, de cadena a array).
- Los nuevos campos opcionales de solicitud y los nuevos campos de respuesta no son incompatibles y pueden incorporarse en cualquier versión menor.
- Los nuevos endpoints no son incompatibles y pueden incorporarse en cualquier versión menor.
- La semántica de autenticación (JWT `Bearer`, forma de la carga útil de `/auth/login`) es estable.
- La semántica de los códigos de estado HTTP es estable para las rutas de éxito y error documentadas.

El comportamiento que exceda la superficie documentada (encabezados no documentados, texto interno de errores, orden cuando no se especifica `sort_by`) no está cubierto.

### Claves de permisos

Las claves de permisos definidas en `backend/app/core/permissions.py` son estables en `1.x`. Se pueden añadir claves nuevas; las existentes no se cambiarán ni eliminarán sin un ciclo de obsolescencia.

El conjunto de permisos concedidos **de forma predeterminada** a los roles iniciales (`admin`, `bpm_admin`, `member`, `viewer`) puede cambiar entre versiones menores, con un aviso en el CHANGELOG. Esto no afecta a los operadores que hayan personalizado los permisos de los roles en su implementación.

### Configuración (variables de entorno)

Las variables de entorno existentes documentadas en `CLAUDE.md` y `README.md` son estables en `1.x`. Se pueden añadir variables nuevas con valores predeterminados razonables. Los valores predeterminados pueden cambiar con un aviso en el CHANGELOG cuando sea relevante para los operadores (por ejemplo, un nuevo puerto predeterminado).

### Secretos cifrados en reposo

El marcador de prefijo `enc:` y la clave derivada de Fernet de `backend/app/core/encryption.py` son estables en `1.x`. Los operadores no necesitan volver a cifrar los secretos al actualizar entre versiones menores.

---

## Ciclo de obsolescencia

Cuando sea necesario eliminar algo cubierto por esta política:

1. **Marcarlo como obsoleto en la versión menor N.** La entrada del CHANGELOG incluye una sección `Deprecated` que indica el cambio. En los endpoints de API, la ruta obsoleta envía el encabezado de respuesta `Deprecation: true` (RFC 8594) y un encabezado `Sunset` con la primera fecha prevista para su eliminación.
2. **Seguir admitiéndolo en la versión menor N+1.** La eliminación no puede producirse en la misma versión menor que la obsolescencia. La forma obsoleta seguirá funcionando.
3. **La eliminación más temprana será en la versión menor `N+2` o en `2.0`** (lo que ocurra primero). La eliminación se publicará con una sección `Removed` en el CHANGELOG y una nota de migración.

Para los cambios en la forma de los datos (migraciones Alembic), se aplica la misma cadencia `N` → `N+1`, expresada como add-new → backfill → drop-old.

---

## Qué no cubre

Los siguientes elementos quedan explícitamente fuera del alcance y pueden cambiar en cualquier momento:

- La **estructura interna de módulos Python** en `backend/app/`. Las importaciones de `app.models`, `app.services`, etc. no forman parte de la API pública. Los complementos o scripts que dependan de importaciones internas deberían fijar una versión concreta de Turbo EA.
- La **estructura de los bloques JSONB** almacenados en tablas integradas (`fields_schema`, `section_config`, `attributes`, `lifecycle`), más allá de lo que lee la API REST documentada. La estructura JSON en disco puede evolucionar para admitir nuevas funciones.
- Los **elementos internos del frontend**: rutas de archivos de componentes, firmas de props de los componentes en `frontend/src/`, contenido de `frontend/src/types/index.ts` y estilos de componentes MUI. Los operadores que usan el frontend incluido quedan aislados de estos cambios; quien integre componentes del árbol de código fuente asume esa responsabilidad.
- Las **personalizaciones del metamodelo introducidas por el operador**. Si añade un tipo de ficha o campo personalizado mediante la interfaz de administración, la migración al modificarlo es responsabilidad suya.
- Los **datos de demostración y de inicialización** (`SEED_DEMO=true`). El conjunto de datos de demostración puede evolucionar libremente entre versiones.
- Los **servicios de terceros incluidos**: versión de DrawIO, imagen de Ollama incluida y versión de swagger-ui-dist integrado. Pueden actualizarse en cualquier momento.
- El **comportamiento con configuraciones no predeterminadas** señaladas expresamente como experimentales en las entradas del CHANGELOG.

---

## Qué cambia realmente con «1.0.0»

En comparación con la serie `0.x`, `1.0.0` no es por sí misma una versión con nuevas funciones: es el momento a partir del cual se aplican los compromisos anteriores. El código de `1.0.0` es el mismo que se publicó en `0.71.0`, junto con el refuerzo de la cadena de suministro y los cambios en el proceso de contribución documentados en la [entrada del CHANGELOG de `1.0.0`](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md#100---2026-05-05).

Las versiones anteriores a `1.0` no estaban cubiertas por esta política. Las migraciones entre versiones `0.x` podían incluir, y de hecho incluyeron, eliminaciones y cambios de nombre del esquema, así como cambios incompatibles del metamodelo. A partir de `1.0.0`, esos cambios siguen el ciclo de obsolescencia.
