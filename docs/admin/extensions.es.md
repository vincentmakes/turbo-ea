# Extensiones

La **tienda de extensiones** (Admin → Extensiones) instala extensiones firmadas por el proveedor que añaden capacidades específicas del cliente — contenido adicional del metamodelo, integraciones, tareas en segundo plano e incluso páginas nuevas — sin cambiar el núcleo de Turbo EA (principio «clean core»).

Las extensiones se instalan de dos maneras: **con un clic desde la Tienda integrada** (si la instancia tiene acceso a Internet) o **subiendo los archivos directamente** — la extensión es un paquete `.teax` firmado y la licencia un archivo de texto firmado, ambos enviados normalmente por correo electrónico. El flujo basado en archivos no requiere cuenta de tienda ni conexión saliente, por lo que funciona igual en instancias **aisladas (air-gapped)**.

La página tiene dos pestañas: **Tienda** explora el catálogo de extensiones de tu proveedor con instalación en un clic, e **Instaladas** gestiona licencias e instala desde archivos.

**Las extensiones las crea y firma Turbo EA** — no son de creación propia ni están abiertas a terceros. Si necesitas una funcionalidad adaptada a tu organización, podemos crearla y licenciarla para ti. Consulta [la consultoría de Turbo EA](https://www.turbo-ea.org/consulting).

## Cómo funciona la confianza

Dos comprobaciones independientes protegen su instancia:

1. **Procedencia (firma).** Cada paquete lleva una firma Ed25519 de la clave del proveedor. Turbo EA la verifica al subirlo *y de nuevo en cada arranque del backend*. Los paquetes sin firma, manipulados o de terceros se rechazan — una extensión instalada es exactamente lo que el proveedor construyó.
2. **Activación (licencia).** Un archivo de licencia firmado enumera sus derechos — uno por extensión, cada uno con su propia caducidad. Una extensión instalada solo funciona mientras exista un derecho utilizable. Las licencias están **vinculadas al ID de su instancia** — una licencia emitida para otra instancia se rechaza.

## El ID de su instancia

Cada instalación genera una única vez un **ID de instancia** (`TEA-XXXX-XXXX-XXXX`), visible en la parte superior de Admin → Extensiones con un botón de copia. Es su identidad de licencia: indíquelo al comprar (la Tienda integrada lo envía automáticamente; el pago de la tienda en línea lo solicita) para que cada extensión comprada para esta instancia — por cualquier administrador, con cualquier correo — termine en una única licencia combinada. Solo identifica su instancia; nunca es una credencial, así que puede compartirlo con su proveedor sin riesgo.

El ID viaja con una transferencia de espacio de trabajo, por lo que mudarse a un nuevo servidor mantiene la licencia válida. Tras una **reinstalación completa**, la instancia recibe un ID nuevo — pida a su proveedor que vuelva a emitir su licencia para él (un rápido «re-key» por su parte).

## La pestaña Tienda

La pestaña **Tienda** funciona sin configuración alguna y lista las extensiones publicadas por el proveedor con descripción y precio:

- **Comprar** abre la página de pago en una pestaña nueva del navegador. En cuanto se confirma el pago, tu licencia se aplica automáticamente (también llega una copia por correo).
- **Instalar** (o **Actualizar** cuando se publica una versión más reciente) comprueba primero tu licencia — si la extensión aún no tiene licencia, un diálogo ofrece comprarla o pegar una licencia y luego continúa automáticamente — y descarga el paquete con exactamente la misma verificación de firma y vista previa de simulación que una carga manual. Las extensiones con demo muestran un enlace **Verlo en acción**, y una versión más reciente publicada convierte el botón en **Actualizar**.

La pestaña Tienda es de solo lectura y anónima: sin cuenta, sin token, y no se envía nada sobre tu instancia — solo se lee el catálogo público del proveedor. Las instancias aisladas no necesitan configuración — la pestaña muestra entonces simplemente un aviso amable — y usan el flujo basado en archivos de abajo; el sitio web de la tienda del proveedor ofrece las mismas compras y descargas desde cualquier navegador con conexión a Internet.

## Instalar una extensión

1. Si aún no lo ha hecho, aplique primero su licencia (véase más abajo).
2. Abre **Admin → Extensiones**, elige **Instalar desde archivo…** en la pestaña Tienda y sube el archivo `.teax` recibido.
3. Turbo EA verifica la firma y muestra una **vista previa**: para extensiones con contenido es una simulación de cada tipo de tarjeta, grupo de etiquetas, tarjeta y relación que la extensión crearía o actualizaría — todavía no se escribe nada.
4. Revise la vista previa y pulse **Instalar extensión**.
5. Si la extensión incluye código de backend, un aviso pide reiniciar el contenedor del backend (`docker compose restart backend`). Las extensiones de contenido y de interfaz quedan activas de inmediato: los usuarios ven la nueva interfaz al recargar la página.

Subir el mismo paquete otra vez es seguro — la vista previa muestra todo como «omitido» y aplicarlo no cambia nada.

## Licencias y renovación

Aplica una licencia mediante **Introducir licencia…** en la pestaña Instaladas (pega el texto o sube el archivo); el botón también aparece en cada fila de extensión que la necesite. La página muestra entonces el titular y un distintivo por derecho con su fecha de caducidad.

Cuando un derecho supera su caducidad entra en un **periodo de gracia** (30 días por defecto): todo sigue funcionando y los administradores ven un aviso. Tras la gracia, la extensión se **desactiva suavemente** — sus páginas desaparecen, su API rechaza peticiones y sus tareas en segundo plano se pausan. **Nunca se borran datos.** Aplicar una licencia renovada lo restaura todo al instante, sin reinicio.

Las licencias compradas en la Tienda se renuevan solas en las instancias conectadas: tras cada pago correcto, tu instancia obtiene automáticamente la licencia ampliada — nada que pegar. En una instancia aislada, la renovación consiste en pegar el archivo de licencia actualizado del correo de renovación (o pedirlo al proveedor) — nada más.

## Habilitar, deshabilitar y desinstalar

- El interruptor **Habilitada** desactiva una extensión inmediatamente de forma suave (sin reinicio) y puede revertirse en cualquier momento. Para los paquetes de contenido, esto oculta sus tipos de tarjeta del metamodelo — las tarjetas se quedan donde están.
- **Desinstalar** elimina los archivos de la extensión y oculta sus tipos de tarjeta del metamodelo. Las tarjetas y las tablas propias de la extensión se conservan deliberadamente, y todo — tipos incluidos — reaparece si la reinstalas.

## Permisos

Toda la página y sus rutas de API están protegidas por el permiso dedicado `admin.manage_extensions` (concedido al rol Admin integrado). Las extensiones pueden definir sus propias claves de permiso (`ext.<nombre>.…`), que aparecen en **Admin → Usuarios y roles** una vez cargada la extensión.

## Funciones de campo avanzadas

Algunas extensiones habilitan formas avanzadas de describir tus datos que el núcleo no ofrece por sí solo:

- **Texto de ayuda del campo** — una guía plegable que se muestra debajo de un campo durante la entrada de datos, para que un formulario se explique solo.
- **Tipos de campo personalizados** — nuevos tipos más allá del conjunto integrado (por ejemplo, una valoración configurable de 1 a 5 o de 0 a 10).

Estas opciones aparecen en el editor de campos del metamodelo **solo mientras la extensión que las proporciona esté instalada y con licencia**. Si dicha extensión se deshabilita más tarde o su licencia caduca, los valores que ya capturaste se siguen mostrando como texto de solo lectura — nada se borra ni se elimina — y las opciones de edición simplemente desaparecen hasta que la extensión vuelva a estar activa.

## Dónde aparecen las páginas de extensión

Las páginas de extensión aparecen en la navegación una vez que la extensión está instalada y con licencia — normalmente como su propia entrada de menú de nivel superior, aunque algunos informes se colocan bajo el menú **Informes** junto a los integrados.
