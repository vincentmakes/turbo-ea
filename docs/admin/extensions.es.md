# Extensiones

La **tienda de extensiones** (Admin → Extensiones) instala extensiones firmadas por el proveedor que añaden capacidades específicas del cliente — contenido adicional del metamodelo, integraciones, tareas en segundo plano e incluso páginas nuevas — sin cambiar el núcleo de Turbo EA (principio «clean core»).

Las extensiones se instalan de dos maneras: **con un clic desde la Tienda integrada** (si la instancia tiene acceso a Internet) o **subiendo los archivos directamente** — la extensión es un paquete `.teax` firmado y la licencia un archivo de texto firmado, ambos enviados normalmente por correo electrónico. El flujo basado en archivos no requiere cuenta de tienda ni conexión saliente, por lo que funciona igual en instancias **aisladas (air-gapped)**.

La página tiene dos pestañas: **Tienda** explora el catálogo de extensiones de tu proveedor con instalación en un clic, e **Instaladas** gestiona licencias e instala desde archivos.

**Las extensiones las crea y firma Turbo EA** — no son de creación propia ni están abiertas a terceros. Si necesitas una funcionalidad adaptada a tu organización, podemos crearla y licenciarla para ti. Consulta [la consultoría de Turbo EA](https://www.turbo-ea.org/consulting).

## Cómo funciona la confianza

Dos comprobaciones independientes protegen su instancia:

1. **Procedencia (firma).** Cada paquete lleva una firma Ed25519 de la clave del proveedor. Turbo EA la verifica al subirlo *y de nuevo en cada arranque del backend*. Los paquetes sin firma, manipulados o de terceros se rechazan — una extensión instalada es exactamente lo que el proveedor construyó.
2. **Activación (licencia).** Un archivo de licencia firmado enumera sus derechos — uno por extensión, cada uno con su propia caducidad. Una extensión instalada solo funciona mientras exista un derecho utilizable. Las licencias están **vinculadas al ID de su instancia** — una licencia emitida para otra instancia se rechaza.

## Extensiones gratuitas

Algunas extensiones son **gratuitas** y no requieren ninguna licencia. Se instalan y se ejecutan de inmediato: no hay paso de compra ni archivo de licencia que pegar. Las extensiones gratuitas se marcan con una insignia **Gratis** en las pestañas Tienda e Instaladas, y las acciones **Comprar** y **Renovar** quedan ocultas para ellas. La comprobación de firma se sigue aplicando igual que en las extensiones de pago (una extensión gratuita también está firmada por el proveedor), por lo que la procedencia está garantizada en cualquier caso. Como no necesitan ninguna licencia, las extensiones gratuitas nunca caducan ni entran en un periodo de gracia.

## El ID de su instancia

Cada instalación genera una única vez un **ID de instancia** (`TEA-XXXX-XXXX-XXXX`), visible en la parte superior de Admin → Extensiones con un botón de copia. Es su identidad de licencia: indíquelo al comprar (la Tienda integrada lo envía automáticamente; el pago de la tienda en línea lo solicita) para que cada extensión comprada para esta instancia — por cualquier administrador, con cualquier correo — termine en una única licencia combinada. Solo identifica su instancia; nunca es una credencial, así que puede compartirlo con su proveedor sin riesgo.

El ID viaja con una transferencia de espacio de trabajo, por lo que mudarse a un nuevo servidor mantiene la licencia válida. Tras una **reinstalación completa**, la instancia recibe un ID nuevo — pida a su proveedor que vuelva a emitir su licencia para él (un rápido «re-key» por su parte).

## La pestaña Tienda

La pestaña **Tienda** funciona sin configuración alguna y lista las extensiones publicadas por el proveedor con descripción y precio:

- **Comprar** abre la página de pago en una pestaña nueva del navegador. En cuanto se confirma el pago, tu licencia se aplica automáticamente (también llega una copia por correo).
- **Instalar** (o **Actualizar** cuando se publica una versión más reciente) comprueba primero tu licencia — si la extensión aún no tiene licencia, un diálogo ofrece comprarla o pegar una licencia y luego continúa automáticamente — y descarga el paquete con exactamente la misma verificación de firma y vista previa de simulación que una carga manual. Las extensiones con demo muestran un enlace **Verlo en acción**, y una versión más reciente publicada convierte el botón en **Actualizar**.

Cuando el catálogo incluye categorías, cada elemento muestra pequeñas píldoras (free o commercial, más temas como integration) y aparece una barra de filtros sobre la lista — haga clic en las píldoras para acotarla (varias píldoras se combinan) y **All** restablece la vista.

La pestaña Tienda es de solo lectura y anónima: sin cuenta, sin token, y no se envía nada sobre tu instancia — solo se lee el catálogo público del proveedor. Las instancias aisladas no necesitan configuración — la pestaña muestra entonces simplemente un aviso amable — y usan el flujo basado en archivos de abajo; el sitio web de la tienda del proveedor ofrece las mismas compras y descargas desde cualquier navegador con conexión a Internet. Si algo entre su instancia y la tienda bloquea la solicitud — un proxy, un cortafuegos o una protección anti-bots delante de la tienda —, la pestaña lo indica y muestra el estado HTTP recibido, de modo que una instancia bloqueada nunca se confunda con una aislada.

La instancia también **comprueba el catálogo una vez al día** e informa de los cambios, para que una extensión nueva —o una corrección de seguridad de alguna que ya utiliza— no espere a que alguien abra esta página por casualidad. Los administradores (cualquiera cuyo rol conceda `admin.manage_extensions`) reciben una notificación en la campana cuando se publica una extensión nueva en la tienda, y otra cuando una extensión instalada tiene una versión más reciente. Cada cambio se anuncia una sola vez, y un día de lanzamientos intenso llega como una notificación por tipo en lugar de una por extensión. No se descarga ni se instala nada: la notificación simplemente le trae hasta aquí. La comprobación diaria puede desactivarse por completo en [Admin → Configuración → Notificaciones de actualización](settings.md#update-notifications).

## Pruebas

Algunas extensiones de pago ofrecen una **prueba gratuita de 30 días** — busque el botón **Iniciar prueba de 30 días** en la pestaña Tienda (o la opción de prueba en el sitio web de la tienda). Iniciar una prueba funciona como una compra sin pago: no se necesita tarjeta de crédito, su licencia se actualiza automáticamente (también llega una copia por correo electrónico para instalaciones aisladas) y la extensión funciona con toda su funcionalidad durante 30 días.

- Cada instancia de Turbo EA puede probar una extensión determinada **una sola vez**.
- Una prueba termina exactamente en su fecha de finalización — no hay período de gracia. La extensión deja entonces de funcionar hasta que se suscriba; **sus datos nunca se eliminan**, y todo vuelve en cuanto se aplica una licencia de suscripción.
- La pestaña «Instaladas» muestra los derechos de prueba como **Prueba hasta …**.
- Las pruebas terminan por sí solas — no hay nada que cancelar y nunca se factura nada.

## Instalar una extensión

1. Si aún no lo ha hecho, aplique primero su licencia (véase más abajo).
2. Abre **Admin → Extensiones**, elige **Instalar desde archivo…** en la pestaña Tienda y sube el archivo `.teax` recibido.
3. Turbo EA verifica la firma y muestra una **vista previa**: para extensiones con contenido es una simulación de cada tipo de tarjeta, grupo de etiquetas, tarjeta y relación que la extensión crearía o actualizaría — todavía no se escribe nada.
4. Revise la vista previa y pulse **Instalar extensión**.
5. Si la extensión incluye código de backend, un aviso pide reiniciar el contenedor del backend (`docker compose restart backend`). Las extensiones de contenido y de interfaz quedan activas de inmediato: los usuarios ven la nueva interfaz al recargar la página.

Subir el mismo paquete otra vez es seguro — la vista previa muestra todo como «omitido» y aplicarlo no cambia nada.

## Actualizar una extensión

Cuando la tienda publica una versión más reciente de una extensión instalada, la pestaña Instaladas muestra un distintivo **Actualizar a X** junto a la versión (y el botón de la pestaña Tienda se convierte en **Actualizar**). Un clic ejecuta la misma verificación de firma, la misma vista previa y la misma aplicación que una instalación nueva. Se aplican dos salvaguardas:

- Actualizar una extensión que usted ha **desactivado** deliberadamente la mantiene desactivada: la nueva versión se instala en el disco, pero su contenido permanece oculto y nada se ejecuta hasta que la vuelva a activar.
- Instalar un paquete **más antiguo** que la versión instalada pide primero una confirmación explícita: una versión anterior puede no entender los datos escritos por la más reciente. En ningún caso se elimina nada.

## Licencias y renovación

Aplica una licencia mediante **Introducir licencia…** en la pestaña Instaladas (pega el texto o sube el archivo); el botón también aparece en cada fila de extensión que la necesite. La página muestra entonces el titular y un distintivo por derecho con su fecha de caducidad.

Su instancia mantiene **una sola licencia a la vez** — aplicar una nueva sustituye a la anterior. Las licencias emitidas por la Store siempre contienen todas las compras realizadas para su instancia, por lo que sustituirla es seguro. Si además posee licencias emitidas manualmente, pida a su proveedor una licencia combinada en lugar de aplicar archivos por extensión; si una licencia aplicada eliminara derechos que la actual todavía cubre, Turbo EA los enumera y pide confirmación primero (en ningún caso se eliminan datos).

Cuando un derecho supera su caducidad entra en un **periodo de gracia** (30 días por defecto): todo sigue funcionando y los administradores ven un aviso. Tras la gracia, la extensión se **desactiva suavemente** — sus páginas desaparecen, su API rechaza peticiones y sus tareas en segundo plano se pausan. **Nunca se borran datos.** Aplicar una licencia renovada lo restaura todo al instante, sin reinicio.

Las licencias compradas en la Tienda se renuevan solas en las instancias conectadas: tras cada pago correcto, tu instancia obtiene automáticamente la licencia ampliada — nada que pegar. En una instancia aislada, la renovación consiste en pegar el archivo de licencia actualizado del correo de renovación (o pedirlo al proveedor) — nada más.

### Estado de renovación automática y cancelación

Cada chip de titularidad indica qué ocurre en su fecha: **Se renueva el {fecha}** para una suscripción activa, o **Expira el {fecha} — no se renovará** tras una cancelación. La información procede de la propia licencia firmada, por lo que también es exacta en instancias aisladas — el archivo de licencia enviado por correo tras cualquier cambio de suscripción lleva el estado actualizado; péguelo y el chip queda al día.

Para ver la fecha de renovación, cancelar o restaurar la renovación automática, cambiar el método de pago o descargar facturas, use **Gestionar suscripción** junto al nombre del licenciatario (visible en licencias compradas en la Tienda). Abre su portal de facturación en una pestaña nueva — sin necesidad de cuenta. En una instancia aislada el botón no puede llegar a la tienda; use en su lugar el enlace **Gestionar suscripción** incluido en cada correo de licencia (solo su navegador necesita Internet, su instancia de Turbo EA no).

Cancelar nunca apaga nada de inmediato: la extensión sigue funcionando hasta el final del periodo pagado y después se aplica el flujo normal de gracia + desactivación suave. **Sus datos nunca se eliminan**, y volver a suscribirse lo restaura todo.

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

## Permisos de acceso a datos

La mayoría de las extensiones solo trabajan con sus propios datos. Una extensión que se integra con los datos del núcleo — por ejemplo, un conector que sincroniza los todos con un gestor de tareas externo como Jira o MS Planner ([#921](https://github.com/vincentmakes/turbo-ea/discussions/921)) — debe declarar **grants** en su manifiesto firmado:

- `core.todos.read` / `core.todos.write` — leer o modificar todos a través del SDK de extensiones. La escritura incluye la lectura. En los todos del sistema (como las solicitudes de firma), una extensión de sincronización solo puede establecer la referencia externa mostrada como chip — nunca puede completarlos, editarlos, reasignarlos ni eliminarlos, y los todos de otra extensión siguen fuera de su alcance.
- `core.events.todo` — recibir los eventos de cambio de los todos, para que un conector reaccione de inmediato en lugar de esperar al siguiente ciclo de sondeo.
- `core.users.read` — consultar usuarios (solo nombre, correo y estado activo) para que un conector pueda emparejar responsables con cuentas de la herramienta externa. No se expone ningún dato de rol, inicio de sesión o preferencias, y las extensiones nunca pueden modificar usuarios.
- `core.cards.read` — leer tarjetas, relaciones y el metamodelo, por ejemplo para que un conector pueda emparejar sus aplicaciones con registros de un sistema externo. Las tarjetas archivadas permanecen fuera de la vista.
- `core.cards.write` — crear, actualizar o archivar tarjetas y añadir relaciones, con exactamente la misma validación que aplica el editor de la aplicación. Las actualizaciones fusionan los valores de los campos en lugar de reemplazarlos, de modo que una extensión nunca puede borrar datos que no gestiona, y **no existe la eliminación permanente** — archivar, con su ventana de restauración, es la única eliminación posible para una extensión.
- `core.events.card` — recibir eventos de cambio de tarjetas y relaciones, para que un conector reaccione de inmediato a los cambios del inventario en lugar de esperar a su próximo ciclo de sondeo.

Los grants forman parte del paquete firmado por el proveedor: quedan fijados al empaquetar y son visibles antes de instalar. Solo se aplican mientras la extensión está instalada, habilitada y con licencia — deshabilitarla o dejar caducar la licencia revoca el acceso de inmediato, sin reinicio. Cada cambio hecho por una extensión se registra en **Admin → Registro de auditoría** bajo el origen **Extensión**, y un todo reflejado desde un gestor externo muestra un chip con enlace al elemento externo.

Cada cambio realizado por una extensión aparece en **Admin → Registro de auditoría** como un lote `ext:<clave>` con diferencias campo a campo, y puede revertirse desde allí como cualquier otro lote. Los operadores tienen la última palabra: la variable de entorno `EXTENSION_WRITES_ENABLED=false` pausa al instante todas las escrituras de extensiones (las lecturas siguen funcionando, sin reinicio), y `EXTENSION_MAX_WRITES_PER_BATCH` / `EXTENSION_MAX_BATCHES_PER_MINUTE` limitan cuánto puede cambiar una extensión por lote y por minuto.

## Dónde aparecen las páginas de extensión

Las páginas de extensión aparecen en la navegación una vez que la extensión está instalada y con licencia — normalmente como su propia entrada de menú de nivel superior, aunque algunos informes se colocan bajo el menú **Informes** junto a los integrados.
