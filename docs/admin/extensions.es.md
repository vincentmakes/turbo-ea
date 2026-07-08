# Extensiones

La **tienda de extensiones** (Admin → Extensiones) instala extensiones firmadas por el proveedor que añaden capacidades específicas del cliente — contenido adicional del metamodelo, integraciones, tareas en segundo plano e incluso páginas nuevas — sin cambiar el núcleo de Turbo EA (principio «clean core»).

Todo se entrega como archivos: la extensión es un paquete `.teax` firmado y la licencia un archivo de texto firmado, ambos enviados normalmente por correo electrónico. No se requiere activación en línea, cuenta de tienda ni conexión saliente, por lo que el flujo funciona igual en instancias **aisladas (air-gapped)**.

La página tiene dos pestañas: **Tienda** explora el catálogo de extensiones de tu proveedor con instalación en un clic (si la instancia tiene acceso a Internet), e **Instaladas** gestiona licencias e instala desde archivos.

## Cómo funciona la confianza

Dos comprobaciones independientes protegen su instancia:

1. **Procedencia (firma).** Cada paquete lleva una firma Ed25519 de la clave del proveedor. Turbo EA la verifica al subirlo *y de nuevo en cada arranque del backend*. Los paquetes sin firma, manipulados o de terceros se rechazan — una extensión instalada es exactamente lo que el proveedor construyó.
2. **Activación (licencia).** Un archivo de licencia firmado enumera sus derechos — uno por extensión, cada uno con su propia caducidad. Una extensión instalada solo funciona mientras exista un derecho utilizable.

## La pestaña Tienda

La pestaña **Tienda** funciona sin configuración alguna y lista las extensiones publicadas por el proveedor con descripción y precio:

- **Comprar** abre la página de pago en una pestaña nueva del navegador. Tras la compra, tu licencia llega por correo electrónico: pégala en la pestaña Instaladas.
- **Instalar** (o **Actualizar** cuando se publica una versión más reciente) descarga el paquete y lo somete exactamente a la misma verificación de firma y vista previa de simulación que una carga manual.

La pestaña Tienda es de solo lectura y anónima: sin cuenta, sin token, y no se envía nada sobre tu instancia — solo se lee el catálogo público del proveedor. Las instancias aisladas no necesitan configuración — la pestaña muestra entonces un aviso amable (los operadores también pueden establecer `EXTENSION_STORE_URL=off` para suprimir la llamada saliente) — y usan el flujo basado en archivos de abajo; el sitio web de la tienda del proveedor ofrece las mismas compras y descargas desde cualquier navegador con conexión a Internet.

## Instalar una extensión

1. Si aún no lo ha hecho, aplique primero su licencia (véase más abajo).
2. Abra **Admin → Extensiones**, elija **Instalar extensión** y suba el archivo `.teax` recibido.
3. Turbo EA verifica la firma y muestra una **vista previa**: para extensiones con contenido es una simulación de cada tipo de tarjeta, grupo de etiquetas, tarjeta y relación que la extensión crearía o actualizaría — todavía no se escribe nada.
4. Revise la vista previa y pulse **Instalar extensión**.
5. Si la extensión incluye código de backend o de interfaz, un aviso pide reiniciar el contenedor del backend (`docker compose restart backend`). Las extensiones de solo contenido quedan activas de inmediato.

Subir el mismo paquete otra vez es seguro — la vista previa muestra todo como «omitido» y aplicarlo no cambia nada.

## Licencias y renovación

Pegue el texto de licencia recibido (o suba el archivo) en la tarjeta **Licencia**. La página mostrará el titular y un distintivo por derecho con su fecha de caducidad.

Cuando un derecho supera su caducidad entra en un **periodo de gracia** (30 días por defecto): todo sigue funcionando y los administradores ven un aviso. Tras la gracia, la extensión se **desactiva suavemente** — sus páginas desaparecen, su API rechaza peticiones y sus tareas en segundo plano se pausan. **Nunca se borran datos.** Aplicar una licencia renovada lo restaura todo al instante, sin reinicio.

La renovación en una instancia aislada consiste, por tanto, en pedir al proveedor un nuevo archivo de licencia (por correo) y pegarlo — nada más.

## Habilitar, deshabilitar y desinstalar

- El interruptor **Habilitada** desactiva la extensión de inmediato (sin reinicio) y puede revertirse en cualquier momento.
- **Desinstalar** elimina los archivos de la extensión. Los datos que creó — tipos de tarjeta, tarjetas y sus propias tablas — se conservan deliberadamente y reaparecen si se reinstala. Se necesita un reinicio para descargar por completo el código de backend.

## Tienda en línea (opcional)

Si su proveedor opera una tienda de extensiones en línea, puede conectarse en lugar de intercambiar archivos. Tras una compra recibe un **código de activación** de un solo uso: abra **Admin → Extensiones → Tienda**, introduzca la URL de la tienda y el código. Su instancia lista entonces los paquetes con derecho de uso con **instalación** de un clic, y **Actualizar licencia** recoge renovaciones y nuevas compras al instante — los paquetes descargados pasan exactamente por la misma verificación de firma y vista previa que las subidas manuales. Las instancias aisladas simplemente nunca se conectan; el flujo basado en archivos sigue plenamente soportado.

## Permisos

Toda la página y sus rutas de API están protegidas por el permiso dedicado `admin.manage_extensions` (concedido al rol Admin integrado). Las extensiones pueden definir sus propias claves de permiso (`ext.<nombre>.…`), que aparecen en **Admin → Usuarios y roles** una vez cargada la extensión.
