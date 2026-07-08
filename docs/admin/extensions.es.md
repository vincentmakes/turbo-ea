# Extensiones

La **tienda de extensiones** (Admin → Extensiones) instala extensiones firmadas por el proveedor que añaden capacidades específicas del cliente — contenido adicional del metamodelo, integraciones, tareas en segundo plano e incluso páginas nuevas — sin cambiar el núcleo de Turbo EA (principio «clean core»).

Todo se entrega como archivos: la extensión es un paquete `.teax` firmado y la licencia un archivo de texto firmado, ambos enviados normalmente por correo electrónico. No se requiere activación en línea, cuenta de tienda ni conexión saliente, por lo que el flujo funciona igual en instancias **aisladas (air-gapped)**.

## Cómo funciona la confianza

Dos comprobaciones independientes protegen su instancia:

1. **Procedencia (firma).** Cada paquete lleva una firma Ed25519 de la clave del proveedor. Turbo EA la verifica al subirlo *y de nuevo en cada arranque del backend*. Los paquetes sin firma, manipulados o de terceros se rechazan — una extensión instalada es exactamente lo que el proveedor construyó.
2. **Activación (licencia).** Un archivo de licencia firmado enumera sus derechos — uno por extensión, cada uno con su propia caducidad. Una extensión instalada solo funciona mientras exista un derecho utilizable.

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

## Permisos

Toda la página y sus rutas de API están protegidas por el permiso dedicado `admin.manage_extensions` (concedido al rol Admin integrado). Las extensiones pueden definir sus propias claves de permiso (`ext.<nombre>.…`), que aparecen en **Admin → Usuarios y roles** una vez cargada la extensión.
