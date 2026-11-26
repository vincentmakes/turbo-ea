# Idiomas personalizados

Turbo EA incluye diez idiomas integrados. Cuando su organización necesita otro — neerlandés, polaco, hebreo, hindi, tailandés, una variante regional como el portugués de Brasil —, un administrador puede añadirlo como **idioma personalizado** y rellenar sus traducciones sin esperar a una nueva versión.

Un idioma personalizado reside en su base de datos, no en el código de la aplicación. Usted lo añade, lo traduce, lo revisa y lo ofrece a sus usuarios cuando está listo. Los idiomas integrados no se ven afectados.

Un idioma personalizado abarca toda la interfaz de usuario **y** los nombres que su metamodelo da a las cosas: tipos de ficha, subtipos, secciones, campos y sus opciones, relaciones, roles de partes interesadas, categorías, paneles, normativas, tipos de recurso y la ayuda de las fases del ciclo de vida.

Necesita el permiso **admin.settings** para todo lo que aparece en esta página.

## Añadir un idioma personalizado

Vaya a **Admin > Configuración > General**. La sección **Idiomas personalizados** está justo debajo de [Idiomas Habilitados](settings.md#idiomas-habilitados).

Haga clic en **Añadir idioma** y rellene:

| Campo | Descripción |
|-------|-------------|
| **Código de idioma** | Un código de idioma corto: dos o tres letras minúsculas, seguidas opcionalmente de una escritura (`zh-Hant`) y una región de dos letras en mayúsculas (`pt-BR`) — `nl`, `he`, `hi`, `th`, `pt-BR`. No puede ser el código de un idioma integrado. |
| **Nombre nativo** | El nombre que los usuarios ven en su menú de idioma, escrito en el propio idioma — *Nederlands*, *עברית*, *हिन्दी*, *ไทย*. |
| **Nombre en inglés** | El nombre del idioma en inglés — *Dutch*, *Hebrew*. Es el idioma al que se indica al proveedor de IA que traduzca. Solo letras, espacios, paréntesis y guiones. |
| **Escritura de derecha a izquierda** | Actívela para un idioma que se escribe de derecha a izquierda, como el hebreo, el persa o el urdu. Está desactivada por defecto; el cuadro de diálogo lo señala cuando el código es de un idioma que suele escribirse de derecha a izquierda, pero nunca la activa por usted. |

Sirve cualquier escritura: latina, cirílica, hebrea, árabe, devanagari, tailandesa y otras, incluidos los caracteres de unión y las marcas que esas escrituras necesitan. Con **Escritura de derecha a izquierda** activada, toda la aplicación se dispone de derecha a izquierda para los usuarios que elijan el idioma, como ocurre con el árabe.

Un idioma regional es un idioma propio: `pt-BR` no toma nada del portugués integrado, y `zh-Hant` no toma nada del chino integrado. Mientras una cadena no esté traducida, se muestra en inglés.

Un idioma nuevo empieza desactivado: los usuarios no lo ven hasta que usted lo ofrece. Cada idioma de la lista muestra una barra de progreso con cuántas cadenas están traducidas, y dos contadores:

- **Sin traducir** — cadenas que aún no tienen traducción.
- **Modificadas en inglés** — cadenas que estaban traducidas, pero cuyo texto en inglés ha cambiado desde entonces. Hasta que se vuelvan a traducir, los usuarios ven la traducción antigua, que suele ser mejor que recurrir al inglés.

Ofrezca un idioma a sus usuarios con su interruptor. Los usuarios podrán elegirlo en el menú de idioma, como cualquier idioma integrado. Las cadenas que aún faltan aparecen en inglés.

## Instalar un idioma desde la biblioteca de la comunidad

Otros usuarios de Turbo EA comparten sus traducciones en la [biblioteca de idiomas de la comunidad](https://github.com/vincentmakes/turbo-ea-translations). Debajo de sus propios idiomas, el bloque **Idiomas de la comunidad** lista los idiomas que contiene, cada uno con su nombre nativo y su código, la parte de la interfaz que traduce y la versión de Turbo EA con la que se creó su paquete.

!!! warning "Aportado por la comunidad, sin revisar"
    Los paquetes los escriben miembros de la comunidad. **El proyecto Turbo EA no los revisa.** Las comprobaciones automáticas garantizan que un paquete no pueda añadir marcado, enlaces ni marcadores de posición rotos que el texto en inglés no tenga, pero nadie comprueba si las traducciones son exactas o están completas. Revise un idioma antes de ofrecerlo a sus usuarios.

**Instalar** descarga el paquete del idioma y lo importa. Esto es lo que ocurre:

- El paquete se descarga de la biblioteca de la comunidad — exactamente el archivo que la biblioteca lista, comprobado con su suma de verificación.
- Cada cadena pasa las mismas comprobaciones que un [archivo importado](#the-language-pack-file); una cadena rechazada aparece en el informe y nunca se guarda.
- Un idioma nuevo se añade **desactivado**. Échele un vistazo en **Revisar cadenas** y después actívelo para sus usuarios.
- El informe muestra lo que se aplicó, lo que se rechazó y por qué, y lo que no existe en su versión de Turbo EA.

El idioma aparece entonces como **instalado**, y su fila en su propia lista lleva la marca **Aportado por la comunidad, sin revisar**. Una instalación fallida — un paquete que no se puede descargar, que no coincide con la suma de verificación de la biblioteca o que no es un paquete válido — no instala nada y queda registrada en el [registro de Seguridad y administración](audit-log.md). En **Revisar cadenas**, cada traducción muestra su origen — *Biblioteca de la comunidad*, *Corregida a mano*, *Traducción con IA*, *Archivo importado* o *MCP*.

Cuando la biblioteca tiene un paquete más reciente de un idioma que instaló desde ella, el idioma muestra **Actualización disponible**. **Actualizar** fusiona el paquete nuevo en su idioma. Las cadenas que corrigió a mano se conservan, salvo que marque **Reemplazar también las cadenas corregidas a mano**. El nombre, la dirección y el interruptor de su idioma no se modifican.

Si añadió usted mismo un idioma y la biblioteca tiene el mismo código, su fila muestra **Añadido en este servidor** y ofrece **Añadir cadenas de la comunidad**: el paquete se fusiona en su idioma de la misma manera — las cadenas corregidas a mano se conservan salvo que elija otra cosa — y el idioma queda después marcado como aportado por la comunidad.

Turbo EA solo contacta con la biblioteca cuando usted lo pide: la primera vez que se muestra la sección, la lista se descarga y se conserva; después se muestra la lista conservada (con la fecha de su descarga) hasta que haga clic en **Actualizar**. No se comprueba nada en segundo plano, así que un paquete más reciente solo aparece como **Actualización disponible** tras actualizar. Si no se puede acceder a la biblioteca, el bloque lo indica y sigue mostrando la lista de la última descarga correcta.

### Desactivar la biblioteca

La dirección de la biblioteca se define con la variable de entorno `LANGUAGE_CATALOGUE_URL` (valor de Helm `customLanguages.catalogueUrl`). Déjela vacía para desactivar la función, por ejemplo en una instalación sin acceso a internet; el bloque indica entonces que la biblioteca de la comunidad está desactivada. También puede apuntarla a una copia de la biblioteca en su propio servidor: los paquetes se descargan de los archivos `packs/<code>/pack.json` junto a su `index.json`.

### Aportar un idioma

¿Ha traducido un idioma que aún no está en la biblioteca, o ha mejorado uno? Expórtelo con **Exportar paquete de idioma > Compartir (paquete de la comunidad)** y propóngalo a la biblioteca — consulte su [guía de contribución](https://github.com/vincentmakes/turbo-ea-translations/blob/main/CONTRIBUTING.md).

## Tres formas de traducir

Use la que más le convenga; se pueden combinar y el resultado es el mismo.

### 1. Exportar un archivo e importarlo de nuevo

**Exportar paquete de idioma** descarga un archivo de paquete de idioma (JSON). Elija qué contiene:

- **Cadenas nuevas y modificadas (por traducir)** — el texto en inglés de cada cadena que falta o ha cambiado. Úselo para la primera traducción y después de cada actualización.
- **Todas las cadenas en inglés (por traducir)** — el texto en inglés de todas las cadenas, para volver a traducirlo todo.
- **Traducciones actuales (incluye las etiquetas propias de esta instalación)** — las traducciones que ya tiene, incluidos los nombres de su propio metamodelo. Úselo como copia de seguridad o para trasladar el idioma a otra instalación suya.
- **Compartir (paquete de la comunidad)** — las traducciones que ya tiene, pero solo lo que es igual en todas las instalaciones de Turbo EA: el texto de la interfaz y los nombres del metamodelo integrado tal como los incluye Turbo EA. Se deja fuera todo lo específico de su instalación: tipos de ficha, campos y opciones que usted creó, nombres integrados que renombró, sus paneles y categorías. Este es el archivo que conviene compartir con otros usuarios de Turbo EA.

Traduzca el archivo donde quiera — una agencia de traducción, una herramienta de traducción o un chat de IA — y después elija **Importar paquete de idioma**. La importación comprueba el archivo, guarda las cadenas sección por sección y muestra un informe: cuántas cadenas se aplicaron, quedaron sin cambios o se borraron, cuáles se rechazaron y por qué, y qué claves no están en esta versión.

### 2. Traducir con su proveedor de IA

Si hay un proveedor de IA configurado en [Funciones de IA](ai.md), **Traducir con IA** traduce el idioma en segundo plano. Elija:

- **Cadenas nuevas y modificadas** — solo las que faltan y las modificadas. Es la opción habitual.
- **Todo** — todas las cadenas de nuevo. Las cadenas que corrigió a mano se conservan, salvo que marque también **Reemplazar también las cadenas corregidas a mano**.

El cuadro de diálogo muestra cuántas cadenas se enviarán y, después, el progreso mientras se ejecuta; puede cerrarlo y volver, o **Detener la traducción**. Primero se traducen los nombres de sus tipos de ficha, campos y relaciones, y después el resto de la interfaz con esos nombres como referencia, de modo que lo mismo se llame igual en todas partes. Una cadena que la IA devuelva en un formato inutilizable no se guarda; sigue sin traducir y se reintenta en la siguiente ejecución.

Esta opción no depende de que estén activadas las sugerencias de descripción con IA para las fichas — solo de que haya un proveedor configurado.

### 3. A través de un asistente de IA (MCP)

Un asistente de IA conectado mediante la [integración MCP](mcp.md) puede traducir el idioma por usted, con tres herramientas:

- `list_custom_languages` — qué idiomas personalizados existen y cuánto está traducido cada uno.
- `get_untranslated_strings` — las cadenas en inglés que aún faltan por traducir, página por página, con las instrucciones de traducción.
- `submit_translations` — envía las traducciones de vuelta. Primero muestra una vista previa y guarda tras la confirmación, como toda herramienta de escritura de MCP.

Pida al asistente, por ejemplo: *«Traduce las cadenas que faltan de nuestro idioma personalizado neerlandés, empezando por los nombres del metamodelo.»* El asistente trabaja con sus propios permisos y cada cambio que hace queda registrado en el registro de auditoría.

## El archivo de paquete de idioma

Un paquete de idioma es un archivo JSON como este:

```json
{
  "format": "turbo-ea-language-pack",
  "format_version": 1,
  "app_version": "2.214.0",
  "locale": {"code": "nl", "name": "Nederlands", "english_name": "Dutch", "rtl": false},
  "mode": "missing",
  "instructions": "Translate every value under \"strings\" from English into Dutch. …",
  "strings": {
    "metamodel": {
      "type.Application.label": "Application",
      "type.Application.field.businessCriticality": "Business Criticality"
    },
    "common": {
      "actions.save": "Save",
      "actions.cancel": "Cancel"
    }
  },
  "source_hashes": {
    "metamodel": {
      "type.Application.label": "5c1e0a9d7b32",
      "type.Application.field.businessCriticality": "a90d3f17c4e8"
    },
    "common": {
      "actions.save": "1f3a9c0b2d4e",
      "actions.cancel": "7b2e4d6a8c01"
    }
  }
}
```

- **strings** contiene el texto que hay que traducir, agrupado por sección (`metamodel`, `common`, `admin`, `cards`, …). Traduzca solo los **valores**; nunca cambie las claves.
- La sección **metamodel** contiene los nombres de los tipos de ficha, campos, opciones, relaciones y las demás etiquetas almacenadas en su base de datos. Son etiquetas cortas a las que se refiere el resto de la interfaz: tradúzcalas primero y use las mismas palabras para ellas en todo lo demás.
- Conserve tal cual todo lo que esté entre dobles llaves, como `{{count}}` o `{{name}}`: la aplicación inserta ahí un valor. Conserve también las etiquetas como `<1>` y `</1>` y las referencias como `$t(common:actions.save)`.
- **source_hashes** registra a partir de qué texto en inglés se hizo cada cadena. Déjelo en el archivo: al importar, indica a Turbo EA si el inglés ha cambiado desde que se exportó el archivo. En la sección **metamodel** es obligatorio — una entrada sin su hash se rechaza — porque es lo que impide que una traducción caiga sobre un nombre renombrado entretanto.
- **instructions** repite estas reglas en lenguaje sencillo, para que pueda entregar el archivo tal cual a un traductor o a un chat de IA.

Al importar, cada cadena se comprueba por separado. Una clave que esta versión de Turbo EA no tiene — de un paquete hecho para otra versión — se cuenta como no presente en esta versión y se nombra en el informe. Una cadena se rechaza cuando está vacía o es mucho más larga que la inglesa, cuando pierde o añade un marcador de posición o una referencia `$t(...)`, o cuando introduce una etiqueta o un enlace que el texto en inglés no tiene. En la sección **metamodel**, una traducción también se rechaza si no lleva hash, y se omite si el nombre a partir del cual se hizo ha cambiado desde que se exportó el archivo — una traducción de «Application» nunca cae sobre un tipo de ficha que alguien ha renombrado. Una traducción idéntica a la ya almacenada se notifica como sin cambios. Una cadena rechazada nunca impide que se guarden las demás.

Un archivo exportado para otro código de idioma puede importarse igualmente; antes se le pide confirmación.

## Revisar y corregir cadenas

**Revisar cadenas** enumera las cadenas de un idioma con el texto en inglés junto a cada traducción. Filtre por sección, por estado (sin traducir, modificadas en inglés, traducidas) o por texto, y edite o borre cualquier traducción en el sitio. Sus correcciones surten efecto en cuanto las guarda.

## Después de una actualización

Cada versión de Turbo EA añade y cambia algo de texto en inglés, y usted puede renombrar elementos de su metamodelo. Después, el idioma personalizado muestra las cadenas nuevas como **sin traducir** y las que han cambiado como **modificadas en inglés** — todo lo demás conserva su traducción. Cubra la diferencia de cualquiera de las tres formas anteriores: exporte las cadenas nuevas y modificadas, ejecute **Traducir con IA** con **Cadenas nuevas y modificadas**, o pídaselo a su asistente.

Las correcciones hechas a mano se conservan. Una ejecución de IA sobre **Todo** las respeta, salvo que marque **Reemplazar también las cadenas corregidas a mano**.

## Límites

- **El sitio de documentación no está cubierto.** Este manual permanece en los idiomas integrados.
- **Las encuestas conservan las etiquetas con las que se crearon.** Una encuesta creada antes de traducir las opciones de un campo conserva las etiquetas de opción con las que se creó.
- **Formas plurales.** El inglés tiene dos formas plurales (*one card*, *2 cards*). Un idioma con más — como el polaco, el ruso o el árabe — puede añadir sus formas adicionales (`_few`, `_many`, …) junto a las inglesas en un archivo importado. Una forma que el paquete no incluya recurre a la forma general del idioma (la traducción `_other`), nunca al inglés. La traducción con IA y la pantalla de revisión también trabajan con las formas adicionales ya almacenadas, pero no crean otras nuevas: añádalas mediante un archivo.
- Eliminar un idioma personalizado borra todas sus traducciones, incluidos los nombres de los tipos de ficha, los campos y las demás etiquetas del metamodelo. Los usuarios que lo habían elegido vuelven al inglés.
