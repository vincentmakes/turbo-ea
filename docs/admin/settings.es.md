# Configuración

La página de **Configuración** en **Administrador → Configuración** (`/admin/settings`) es el hub central de configuración. Está organizada en pestañas — elige la pestaña adecuada de la tabla siguiente para el desarrollo dedicado:

| Pestaña | URL | Qué controla | Guía completa |
|---------|-----|--------------|---------------|
| **General** | `/admin/settings?tab=general` | Apariencia (logo, favicon, moneda, formato de fecha, idiomas habilitados, año fiscal), envío de correo, **interruptores de módulos** (BPM, PPM, GRC, TurboLens, Sponsor button) | Esta página |
| **Autenticación** | `/admin/settings?tab=authentication` | Proveedores SSO, registro, política de contraseñas | [Autenticación y SSO](sso.md) |
| **IA** | `/admin/settings?tab=ai` | Proveedor LLM, modelo, backend de búsqueda web, interruptores de sugerencia IA por tipo de tarjeta | [Capacidades de IA](ai.md) |
| **EOL** | `/admin/settings?tab=eol` | Vinculación masiva de productos a entradas de endoflife.date | [Fin de vida (EOL)](eol.md) |
| **Portales web** | `/admin/settings?tab=web-portals` | Slugs de portal público de solo lectura, filtros de visibilidad | [Portales web](web-portals.md) |
| **Integraciones** | `/admin/settings?tab=integrations` | Sincronización ServiceNow e integraciones añadidas por extensiones | [Integración con ServiceNow](servicenow.md) |
| **TurboLens** | `/admin/settings?tab=turbolens` | Interruptores específicos de TurboLens, regulaciones habilitadas, sondeo de análisis | Ver la sección [Configuración de TurboLens](#configuracion-de-turbolens) más abajo |
| **Migración** | `/admin/settings?tab=migration` | Importaciones desde otras plataformas EA y transferencia completa del espacio de trabajo entre instancias de Turbo EA | [Migración de plataforma](migration.md) |
| **Registro de auditoría** | `/admin/settings?tab=audit-log` | Registro de cambios — quién cambió qué y si provino de la interfaz web, la API o una herramienta de IA | — |
| **Recursos** | `/admin/settings?tab=resources` | Todos los archivos y enlaces adjuntos a una tarjeta, con estadísticas de almacenamiento y limpieza masiva | [Recursos](resources.md) |

El resto de esta página cubre la pestaña **General**.

![Configuración general](../assets/img/es/28_admin_config_general.png)

## Apariencia

### Logotipo

Cargue un logotipo personalizado que aparecerá en la barra de navegación superior. Formatos compatibles: PNG, JPEG, SVG, WebP, GIF. Haga clic en **Restablecer** para volver al logotipo predeterminado de Turbo EA.

### Estilo de la barra de navegación

Elija los colores de fondo y de texto de la barra de navegación superior. El estilo elegido se aplica a **todos los usuarios** de la instancia, en escritorio y móvil (incluido el menú lateral móvil). Seleccione uno de los siete estilos predefinidos — Azul marino (predeterminado), Claro, Carbón, Pizarra, Azul, Verde bosque o Ciruela — o elija **Personalizado** para definir libremente los colores de fondo y de texto con los selectores de color. Una vista previa en vivo muestra cómo se verá la barra de navegación antes de guardar, y aparece una advertencia cuando el contraste entre el texto y el fondo es demasiado bajo (por debajo de WCAG AA). Haga clic en **Restablecer valores predeterminados** para volver al estilo predeterminado.

### Favicon

Cargue un icono de navegador personalizado (favicon). El cambio se aplicará en la siguiente carga de página. Haga clic en **Restablecer** para volver al icono predeterminado.

### Moneda

Seleccione la moneda utilizada para los campos de costo en toda la plataforma. Esto afecta a cómo se formatean los valores de costo en las páginas de detalle de fichas, informes y exportaciones. Se admiten más de 40 monedas, incluyendo USD, EUR, GBP, JPY, CNY, CHF, INR, BRL, IDR, entre otras.

### Formato de fecha

Elija cómo se muestran las fechas en toda la aplicación. El formato seleccionado se aplica a las fechas de ciclo de vida de las fichas, a la cuadrícula de inventario, a las firmas de ADR y SoAW, al Registro de Riesgos, a los informes y tareas de PPM, a las versiones de flujos de procesos BPM, a los comentarios, al historial, al panel de actividad del dashboard, a las notificaciones y a las páginas de administración. Se ofrecen cinco formatos con vista previa en vivo:

- `MM/DD/YYYY` — estilo EE. UU. (p. ej. `04/29/2026`)
- `DD/MM/YYYY` — estilo europeo (p. ej. `29/04/2026`)
- `YYYY-MM-DD` — ISO 8601 (p. ej. `2026-04-29`)
- `DD MMM YYYY` — predeterminado (p. ej. `29 abr 2026`)
- `MMM DD, YYYY` (p. ej. `abr 29, 2026`)

Los cambios surten efecto de inmediato para todos los usuarios — no se requiere recargar la página.

### Idiomas Habilitados

Active o desactive los idiomas disponibles para los usuarios en su selector de idioma. Los ocho idiomas soportados pueden habilitarse o deshabilitarse individualmente:

- English, Deutsch, Français, Español, Italiano, Português, 中文, Русский

Al menos un idioma debe permanecer habilitado en todo momento.

### Inicio del Año Fiscal

Seleccione el mes en que comienza el año fiscal de su organización (enero a diciembre). Esta configuración afecta cómo se agrupan las **líneas de presupuesto** en el módulo PPM por año fiscal. Por ejemplo, si el año fiscal comienza en abril, una línea de presupuesto de junio de 2026 pertenece al AF 2026–2027.

El valor predeterminado es **enero** (año calendario = año fiscal).

## Gestión de datos

Controle cuánto tiempo se conservan las **fichas archivadas** antes de eliminarse permanentemente.

Cuando una ficha se archiva, queda oculta en el inventario, los informes y las relaciones, pero conserva todo su historial y puede restaurarse en cualquier momento antes de su purga.

| Campo | Descripción |
|-------|-------------|
| **Período de retención (días)** | Número de días que se conserva una ficha archivada antes de eliminarse permanentemente. El valor predeterminado es **30**. |
| **Conservar las fichas archivadas indefinidamente** | Cuando se activa (retención establecida en **0**), las fichas archivadas nunca se eliminan automáticamente y se conservan —con su historial— indefinidamente. |

La purga se ejecuta cada hora y vuelve a leer este ajuste en cada ejecución, por lo que los cambios surten efecto sin reiniciar la aplicación. Los avisos de archivado y los cuadros de diálogo de confirmación reflejan automáticamente el período configurado.

## Correo Electrónico

Turbo EA envía correos de invitación, notificaciones de encuestas, restablecimientos de contraseña y otros mensajes del sistema. Elija un **método de envío** que se ajuste a su plataforma de correo.

!!! warning "La autenticación SMTP básica se está retirando"
    Microsoft 365 está deshabilitando la autenticación SMTP básica (no disponible para inquilinos nuevos, eliminada para los existentes durante 2026–2027) y Google Workspace la deshabilitó en marzo de 2025. Para esas plataformas, use uno de los métodos OAuth a continuación en lugar de una contraseña de buzón.

### Métodos de envío

| Método | Cuándo usarlo |
|--------|---------------|
| **SMTP (usuario y contraseña)** | SMTP clásico para servidores que aún aceptan autenticación básica. El predeterminado. |
| **SMTP con OAuth 2.0 (XOAUTH2)** | SMTP autenticado con un token OAuth de corta duración — Microsoft 365 (solo aplicación) o Google Workspace (cuenta de servicio). |
| **API de Microsoft Graph** | `sendMail` de Microsoft Graph solo de aplicación. La opción recomendada para Microsoft 365 — sin SMTP, sin contraseña almacenada. |

### Campos comunes

| Campo | Descripción |
|-------|-------------|
| **Dirección de remitente** | La dirección del remitente de los mensajes salientes |
| **URL base de la aplicación** | La URL pública de su instancia (usada en los enlaces de los correos) |

### SMTP (usuario y contraseña)

| Campo | Descripción |
|-------|-------------|
| **Host SMTP** | El nombre de host de su servidor de correo (p. ej., `smtp.gmail.com`) |
| **Puerto SMTP** | El puerto del servidor (587 para STARTTLS, 465 para TLS/SSL implícito) |
| **Usuario SMTP** | El nombre de usuario de autenticación |
| **Contraseña SMTP** | La contraseña de autenticación (almacenada cifrada) |
| **Usar TLS** | Habilitar el cifrado STARTTLS (recomendado). Se ignora en el puerto 465, que siempre usa TLS/SSL implícito |

### API de Microsoft Graph (recomendada para Microsoft 365)

1. En **Microsoft Entra ID → Registros de aplicaciones**, cree un registro de aplicación dedicado.
2. En **Permisos de API**, agregue el permiso **de aplicación** **Mail.Send** y otorgue el **consentimiento del administrador**.
3. Cree un **secreto de cliente** en **Certificados y secretos**.
4. En Turbo EA, elija **API de Microsoft Graph** e introduzca el **ID de inquilino**, el **ID de cliente**, el **secreto de cliente** y el **buzón de remitente** (el nombre principal de usuario desde el que se envía el correo).

No se almacena ninguna contraseña de buzón; Turbo EA solicita un token de corta duración para cada envío.

La **dirección de remitente** es opcional con Graph: déjela en el valor predeterminado para enviar como el buzón de remitente. Definir una dirección diferente requiere un permiso de **Send As** para esa dirección en el buzón de remitente.

### SMTP con OAuth 2.0

- **Microsoft 365:** introduzca el **ID de inquilino**, el **ID de cliente** y el **secreto de cliente** de un registro de aplicación, además del **buzón de remitente**. SMTP AUTH debe estar habilitado para el buzón.
- **Google Workspace:** elija **Google**, pegue la **clave de cuenta de servicio (JSON)** con la delegación en todo el dominio habilitada para el buzón de remitente, y establezca el **buzón de remitente** que se suplantará.

Los campos **Ámbito** y **Punto de conexión de token** son anulaciones opcionales — déjelos vacíos a menos que su inquilino requiera valores personalizados.

Después de configurar cualquier método, haga clic en **Enviar correo de prueba** para verificar que funciona.

!!! note
    El correo es opcional. Si no se configura ningún método, las funciones que envían correos omiten la entrega de forma silenciosa.

## Módulo BPM

Active o desactive el módulo de **Gestión de Procesos de Negocio** (BPM). Cuando está desactivado:

- El elemento de navegación **BPM** se oculta para todos los usuarios
- Las fichas de Proceso de Negocio permanecen en la base de datos, pero las funciones específicas de BPM (editor de flujos de proceso, panel de control BPM, informes BPM) no están accesibles

Esto es útil para organizaciones que no utilizan BPM y desean una experiencia de navegación más limpia.

### Exigir un aprobador distinto

Desactivado de forma predeterminada. Cuando se activa, quien envía una revisión de un flujo de proceso no puede ser quien la aprueba: segregación de funciones, tal como esperan sistemas de calidad como GxP e ISO 9001.

Déjelo desactivado en equipos pequeños donde la misma persona redacta y aprueba. Activarlo no cambia lo que se registra: los envíos, las aprobaciones, los rechazos y los retiros quedan en la pestaña **Historial** de la tarjeta en cualquier caso.

## Módulo PPM

Active o desactive el módulo de **Gestión de Portafolio de Proyectos** (PPM). Cuando está desactivado:

- El elemento de navegación **PPM** se oculta para todos los usuarios
- Las fichas de Iniciativa permanecen en la base de datos, pero las funciones específicas de PPM (informes de estado, seguimiento de presupuesto y costos, registro de riesgos, tablero de tareas, diagrama de Gantt) no están accesibles

Cuando está habilitado, las fichas de Iniciativa obtienen una pestaña **PPM** en su vista de detalle y el panel de portafolio PPM está disponible en la navegación principal. Consulte [Gestión de Portafolio de Proyectos](../guide/ppm.md) para la guía completa de funciones.

## Módulo GRC

Active o desactive el módulo de **Gobernanza, Riesgo y Cumplimiento** (GRC). Cuando está desactivado:

- El elemento de navegación **GRC** se oculta para todos los usuarios
- El espacio `/grc` (principios de Gobernanza y ADRs, Registro de Riesgos, hallazgos de Cumplimiento) deja de ser accesible y muestra el marcador estándar de «módulo deshabilitado» para quien llegue por un enlace directo
- Las pestañas **Riesgos** y **Cumplimiento** en el detalle de la ficha se ocultan, de modo que las fichas individuales tampoco siguen mostrando datos de GRC
- Los riesgos y los hallazgos de cumplimiento permanecen en la base de datos — los permisos subyacentes `risks.*` y `compliance.*` no cambian, de modo que los datos se preservan y vuelven a aparecer sin cambios si el módulo se reactiva

Consulte la [guía de GRC](../guide/grc.md) para la referencia completa de funciones.

## Notificaciones de actualización

Turbo EA comprueba una vez al día si se ha publicado una versión más reciente y, cuando la hay, deja una notificación en la campana de cada usuario cuyo rol conceda `admin.settings`. Al hacer clic se abren las notas de la versión —el changelog de esa versión— en un diálogo dentro de Turbo EA. Cada notificación sigue mostrando la versión que anunció, por mucho tiempo que lleve en la campana: las notas se leen del changelog incluido en la imagen, así que no suponen ninguna petición saliente y funcionan igual en una instalación aislada. Solo una versión que aún no hayas instalado procede de la caché de la comprobación diaria, porque un changelog escrito en tiempo de compilación no puede describirla; para esas, un botón **Ver en GitHub** abre la página de la versión en una pestaña nueva.

Las notificaciones llevan el nombre configurado para esta instancia, de modo que un despliegue renombrado no se anuncia con otro nombre de producto.

La comprobación **solo notifica**: no se descarga nada ni se modifica nada en el host. La actualización sigue siendo el procedimiento deliberado y respaldado por copia de seguridad que se describe en [Operaciones](operations.md#the-upgrade-procedure). Un administrador que prefiera no recibir avisos puede silenciar la fila **Actualización disponible** en sus propias preferencias de notificación.

Desactivar el interruptor elimina por completo la petición diaria a github.com, que es lo que necesita una instalación aislada o con salida restringida. En cualquier caso la instancia funciona con normalidad: si no se puede acceder al feed de versiones, el fallo se registra discretamente y no se muestra nada.

### Cuando la actualización se completa

Un segundo interruptor, **Anunciar las actualizaciones a los usuarios**, cubre la otra mitad. Cuando la instancia se reinicia con una versión más reciente, **todos** los usuarios —no solo los administradores— reciben una notificación que indica que la aplicación se ha actualizado, y al hacer clic se muestra el changelog de todas las versiones que se saltaron. Una instancia que pasa de 2.57.0 a 2.60.0 muestra las cuatro versiones, no solo la última. Cada uno de estos avisos permanece ligado a su propia actualización: abrir uno de hace un año sigue mostrando las versiones que recorrió *esa* actualización.

El anuncio se envía **una vez por versión**: reiniciar diez veces con la misma versión produce una sola notificación, y una reversión no produce ninguna. Una instalación recién creada no anuncia nada, porque no hay ninguna actualización que describir. Estas notas proceden del changelog incluido en la imagen, así que esta mitad no necesita red en absoluto.

Esta notificación es **solo en la aplicación** y nunca se envía por correo: llega a todos los usuarios activos en cada actualización, y un canal de correo convertiría cada versión de parche en un envío masivo. Cada usuario puede silenciarla en **Notificaciones de actualización** dentro de sus propias preferencias, donde el interruptor de correo aparece desactivado.

### Notificaciones de la tienda de extensiones

Un tercer interruptor, **Notificaciones de la tienda de extensiones**, hace lo mismo para la [tienda de extensiones](extensions.md). Una vez al día la instancia lee el catálogo público de la tienda y, cuando algo ha cambiado, avisa a todos los usuarios cuyo rol conceda `admin.manage_extensions`, el mismo permiso que abre la página Extensiones. Se anuncian dos cosas: una extensión publicada en la tienda que no tenga instalada, y una versión más reciente de alguna que sí tenga.

Los días de lanzamiento intensos siguen siendo legibles: por muchas extensiones que cambien, cada administrador recibe **una** notificación por tipo («3 actualizaciones de extensiones disponibles»), no una por extensión. Cada cambio se anuncia **una sola vez** —un catálogo que no cambia en un mes produce una notificación, no treinta— y al hacer clic se abre la pestaña Tienda dentro de Turbo EA.

La primera lectura correcta del catálogo no anuncia **ninguna** extensión nueva: una instancia que ve la tienda por primera vez informaría de todo su contenido. Las actualizaciones de extensiones ya instaladas sí se informan de inmediato, porque siempre son unas pocas y se pueden aplicar directamente.

Igual que la comprobación de versiones, esto es **solo informativo**: no se descarga ni se instala nada, e instalar sigue siendo una acción deliberada en la página Extensiones. Desactivar el interruptor elimina por completo la petición diaria a la tienda. Cada administrador puede silenciar por separado las filas **Nueva extensión disponible** y **Actualización de extensión disponible** en sus propias preferencias de notificación.

## Botón Patrocinar

Muestra u oculta el botón **Patrocinar** en el menú de usuario (avatar). Cuando está oculto, los usuarios ya no ven el botón Patrocinar en su menú de perfil. El botón Patrocinar — y el cuadro de diálogo que explica cómo apoyar Turbo EA — siempre permanece disponible desde este panel de configuración, por lo que los administradores aún pueden acceder a él incluso cuando está oculto en el menú.

Si tu empresa patrocina Turbo EA y desea que su logotipo aparezca en turbo-ea.org, escribe a [sponsorship@turbo-ea.org](mailto:sponsorship@turbo-ea.org).

## Configuración de TurboLens

La pestaña **TurboLens** agrupa los interruptores que gobiernan la superficie de análisis IA. A diferencia de los interruptores por módulo de arriba, TurboLens **no** es un on/off binario — está «listo» cuando tanto un proveedor IA está configurado (bajo la pestaña **IA**) como los datos de análisis se han sincronizado al menos una vez. La página también expone:

- **Regulaciones habilitadas** — marca cuáles de los seis frameworks integrados (EU AI Act, RGPD, NIS2, DORA, SOC 2, ISO 27001) participan en los [escaneos de Cumplimiento](../guide/compliance.md). Las regulaciones personalizadas definidas bajo **Metamodelo → Regulaciones** también pueden habilitarse aquí.
- **Cadencia de sondeo de análisis** — con qué frecuencia la UI vuelve a sondear los análisis TurboLens de larga duración en busca de progreso. Mayor cadencia = menor latencia percibida, más carga de API.
- **TTL de caché de resultados** — cuánto tiempo se cachean los resultados de análisis completados antes de que el botón **Ejecutar análisis** se vuelva a habilitar.

Consulta [Inteligencia IA TurboLens](../guide/turbolens.md) para la superficie de funciones completa y [Cumplimiento](../guide/compliance.md) para el flujo de escaneo.
