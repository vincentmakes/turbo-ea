# Slack Notifications

Su equipo ya vive en Slack. **Slack Notifications** envía a cada persona sus
notificaciones de Turbo EA como **mensaje directo de Slack** — una tarea asignada,
una decisión que espera su firma, un riesgo que ha aterrizado en su mesa — con un
botón que lleva directamente de vuelta a la tarjeta.

Cada persona mantiene el control: en sus propias preferencias de notificación
aparece una columna **Slack**, junto a En la aplicación y Correo, donde marca
exactamente qué tipos de notificación quiere recibir allí. **No hay nada activado
por defecto.**

## De un vistazo

| | |
|---|---|
| **Licencia** | Comercial — se requiere un derecho firmado |
| **Versión mínima de Turbo EA** | 2.89.1 |
| **Permiso** | `ext.slack-notify.admin` |
| **Permisos de acceso a datos** | `core.notifications.channel`, `core.users.read` |
| **Requiere reiniciar el backend** | sí — incluye código de backend |
| **Dónde aparece** | **Admin → Configuración → Integraciones → Slack** · una columna **Slack** en las [preferencias de notificación](../guide/notifications.md) de todas las personas |

Solo hace falta **HTTPS saliente hacia `slack.com`**: ninguna URL entrante,
ninguna devolución de llamada OAuth y ninguna revisión del Slack Marketplace. Por
eso funciona en instancias autoalojadas o tras un cortafuegos.

## Configuración

Abra **Admin → Configuración → Integraciones** y elija la subpestaña **Slack**. El
panel le guía en tres pasos numerados.

### 1. Crear la aplicación de Slack

El panel muestra un **manifiesto de aplicación** ya preparado. En Slack elija
**Create New App → From a manifest**, seleccione su espacio de trabajo, pegue el
manifiesto (hay un botón **Copiar manifiesto**), después **Install to Workspace**
y copie el **Bot User OAuth Token**: empieza por `xoxb-`.

El manifiesto solicita cuatro ámbitos de bot y nada más:

| Ámbito | Para qué |
|---|---|
| `chat:write` | Publicar el mensaje directo |
| `im:write` | Abrir la conversación directa con una persona |
| `users:read` | Leer el directorio de miembros |
| `users:read.email` | Asociar una cuenta de Turbo EA a un miembro de Slack por correo |

!!! warning "Deje la rotación de tokens desactivada"
    El manifiesto desactiva a propósito la **rotación de tokens** de Slack.
    Activada, el token del bot caduca cada 12 horas, algo que esta versión no
    sabe renovar: la entrega se detendría dos veces al día.

### 2. Conectar el espacio de trabajo

| Campo | Notas |
|---|---|
| **Token OAuth del bot** | El token `xoxb-…`. Se guarda cifrado; déjelo vacío más adelante para conservarlo |
| **Nombre mostrado en los mensajes de Slack** | *Turbo EA* por defecto. Se usa en el botón y el pie del mensaje |
| **Entregar notificaciones en Slack** | Activado por defecto: es un interruptor de pausa, no un paso de instalación |

Pulse **Guardar** y después **Probar conexión**; una etiqueta confirma
*Connected to …*.

### 3. Asociar a las personas

Las cuentas se asocian **por dirección de correo** la primera vez que alguien debe
recibir un mensaje, y el resultado se almacena en caché. La tarjeta **Personas**
enumera a todo el mundo, primero los casos problemáticos, con etiquetas que
indican quién está **conectado**, **no está en Slack** o **aún no se ha
comprobado**.

Para alguien cuya dirección de Slack difiera de su correo de Turbo EA, escriba su
**ID de miembro de Slack** (como `U01ABCDEF`) y pulse **Guardar**: una asociación
manual siempre prevalece sobre la coincidencia por correo. **Enviar mensaje de
prueba** demuestra que una asociación funciona de extremo a extremo. Vaciar el
campo devuelve a esa persona a la búsqueda por correo.

Las personas que Slack no reconoce se reintentan automáticamente una vez al día,
de modo que quien se una al espacio de Slack después de tener su cuenta de
Turbo EA queda cubierto sin intervención.

!!! note "Solo se guardan los ID de miembro"
    La extensión guarda ID de miembro de Slack y nada más: las direcciones de
    correo permanecen en Turbo EA.

## Lo que controla cada persona

En cuanto la extensión está en marcha, todo el mundo dispone de una columna
**Slack** en sus **preferencias de notificación**, junto a En la aplicación y
Correo.

![La columna «Slack» en las preferencias de notificación](../assets/img/en/71_ext_slack_notification_preferences.png)

- **Todos los tipos están desactivados por defecto.** Nadie recibe un mensaje de
  Slack hasta que activa ese tipo para sí mismo.
- Un pie bajo la tabla indica a cada persona si su cuenta está conectada a Slack o
  si debe pedir la asociación a un administrador.
- El aviso de actualización, exclusivo de la aplicación, nunca se entrega en
  Slack.

Turbo EA decide qué tipos de notificación existen y quién los ha activado; la
extensión solo transporta el mensaje.

## Cómo es un mensaje

Un mensaje directo de Slack contiene el **título** de la notificación en negrita,
su texto, un botón **Open in Turbo EA** (con el nombre que haya configurado) que
lleva a la tarjeta o página correspondiente, y un pequeño pie con el nombre de la
aplicación y el tipo de notificación.

La entrega es estrictamente unidireccional — de Turbo EA hacia Slack — y siempre
como mensaje directo personal. Nunca se publica nada en un canal.

## Supervisar la entrega

La tarjeta **Registro de entrega** muestra cuántos mensajes están **en espera**,
**enviados** y **fallidos**, además de las 50 líneas de registro más recientes.

Los mensajes se encolan y se envían en segundos. Si Slack limita la tasa o
devuelve un error, la extensión reintenta con una espera creciente y desiste tras
seis intentos; los fallos permanentes — token revocado, persona eliminada, ámbito
ausente — se detienen de inmediato en lugar de reintentar en vano. Las líneas
entregadas se purgan a los 14 días.

Una cola que no avanza tiene exactamente dos causas, y el panel indica la que
corresponde:

- **No hay ningún token de bot guardado**: pegue el token y guarde.
- **La entrega está desactivada**: vuelva a activar *Entregar notificaciones en
  Slack*.

**Reintentar los fallidos** vuelve a encolar todo lo que se dio por perdido y
revisa de nuevo a las personas que Slack no reconocía. Es la vía de recuperación
tras una caída o un cambio de token.

## Permisos

| Permiso | Permite |
|---|---|
| `ext.slack-notify.admin` | Configurar la conexión con el espacio de trabajo, asociar personas, enviar mensajes de prueba, consultar el registro y reintentar los fallos |

La subpestaña está oculta para el resto. **Las personas usuarias no necesitan
ningún permiso adicional**: solo marcan casillas en sus propias preferencias de
notificación.

## Si la licencia caduca o la extensión se desactiva

La entrega se pausa y la columna **Slack** desaparece del diálogo, pero **se
conservan todos los ajustes y todas las suscripciones**. Una licencia renovada
reanuda la entrega. Lo mismo ocurre con el interruptor *Entregar notificaciones en
Slack*, que pausa la entrega sin desinstalar nada: los mensajes pendientes
simplemente esperan.

El token del bot se guarda cifrado y queda excluido de la transferencia de espacio
de trabajo.

## Limitaciones

- **Solo mensajes directos**: no se publica en canales.
- **Sin botones interactivos.** Acciones como *Marcar como hecho* o *Aprobar*
  desde Slack no están disponibles en esta versión; el mensaje enlaza de vuelta a
  Turbo EA.
- **Sin resúmenes**: cada notificación es un mensaje propio en lugar de un resumen
  agrupado.
- **No active la rotación de tokens de Slack** (véase el aviso anterior).
