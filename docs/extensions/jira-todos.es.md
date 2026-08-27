# Jira Todo Sync

Se acabó mantener dos listas de tareas. **Jira Todo Sync** refleja las tareas de
Turbo EA en un proyecto de Jira Cloud de su elección y mantiene ambos lados
alineados: una tarea creada en Turbo EA se convierte en una incidencia de Jira en
segundos, completarla hace que la incidencia pase a «hecho», y las incidencias de
Jira que coincidan con un filtro de su elección aparecen como tareas. Títulos,
fechas de vencimiento y personas asignadas se sincronizan en ambos sentidos.

## De un vistazo

| | |
|---|---|
| **Licencia** | Comercial — se requiere un derecho firmado |
| **Versión mínima de Turbo EA** | 2.68.0 |
| **Permiso** | `ext.jira-todos.admin` |
| **Permisos de acceso a datos** | `core.todos.read`, `core.todos.write`, `core.events.todo`, `core.users.read` |
| **Requiere reiniciar el backend** | sí — incluye código de backend |
| **Dónde aparece** | **Admin → Configuración → Integraciones → Jira Todo Sync** · etiquetas con la clave de incidencia en la página de tareas y en la pestaña Tareas de las tarjetas |

Solo se admite **Jira Cloud**. La conexión es únicamente saliente: Turbo EA llama
a la API REST de Jira con un correo de cuenta y un token de API. No hay ninguna
devolución de llamada OAuth que exponer, ninguna aplicación de Jira que instalar y
ningún acceso de red entrante, por lo que funciona en instancias autoalojadas o
tras un cortafuegos.

## Configuración

### 1. Crear un token de API de Atlassian

1. Vaya a
   <https://id.atlassian.com/manage-profile/security/api-tokens> e inicie sesión
   con la cuenta de Atlassian con la que debe actuar la sincronización. Use una
   **cuenta de servicio dedicada** si dispone de ella: las incidencias se crean y
   se transicionan con esta cuenta. (Este enlace directo es la vía fiable; la
   página de tokens ya no es accesible por una ruta de menú evidente.)
2. Pulse **Create API token** — la variante simple, **no** *Create API token with
   scopes*. **Los tokens con ámbitos no son compatibles.**
3. Póngale un nombre (por ejemplo `turbo-ea-sync`) y elija una caducidad.
   Atlassian exige una y la limita a **un año**.
4. **Copie el token de inmediato**: solo se muestra una vez.

!!! warning "Los tokens caducan"
    Cuando el token caduca, la sincronización se detiene con errores de
    autenticación hasta que se introduce uno nuevo. Anote la fecha de caducidad al
    crearlo.

### 2. Conectar Turbo EA

Abra **Admin → Configuración → Integraciones** y elija la subpestaña **Jira Todo
Sync**.

En **Conexión con Jira Cloud**, rellene:

| Campo | Notas |
|---|---|
| **URL del sitio** | Por ejemplo `https://su-sitio.atlassian.net` |
| **Correo de la cuenta** | La cuenta de Atlassian a la que pertenece el token |
| **Token de API** | Se almacena cifrado. Déjelo vacío más adelante para conservar el token guardado |

Pulse **Probar conexión**. Si funciona, se indica *Connected as …*.

### 3. Definir el alcance

En **Alcance de la sincronización**:

- **Proyecto de Jira** — elija de la lista, que se carga desde Jira en cuanto los
  datos de conexión están rellenos. Las tareas enviadas se crean allí como
  incidencias de tipo **Task**.
- **Filtro de extracción (JQL)** — las incidencias que coincidan con este JQL se
  reflejan como tareas. Déjelo vacío para el valor predeterminado
  `project = "<KEY>" AND statusCategory != Done`.
- **Intervalo de sondeo (segundos)** — con qué frecuencia se consulta Jira.
  Predeterminado 300, mínimo 60.

En **Direcciones** hay tres interruptores:

| Interruptor | Predeterminado | Efecto |
|---|---|---|
| **Enviar todos a Jira** | activado | Las tareas creadas en Turbo EA se convierten en incidencias de Jira; completar una tarea transiciona su incidencia |
| **Extraer incidencias de Jira** | activado | Las incidencias coincidentes aparecen como tareas; resolver una incidencia completa su tarea |
| **Reflejar todos de firma (unidireccional)** | **desactivado** | Las firmas de riesgos, decisiones y proyectos se convierten en incidencias de Jira con un enlace de vuelta, pero deben completarse en Turbo EA |

Pulse **Guardar configuración**. **Sincronizar ahora** ejecuta un ciclo de
inmediato.

La correspondencia de personas asignadas no necesita configuración: Turbo EA
asocia automáticamente las personas a cuentas de Jira por dirección de correo.

## Cómo se comporta la sincronización

| Evento | Efecto |
|---|---|
| Tarea creada en Turbo EA | Se crea una incidencia de Jira en segundos (título, descripción con enlace de vuelta, vencimiento, persona asignada) |
| Tarea completada o editada | La incidencia pasa a «hecho» o se actualizan sus campos |
| Incidencia que coincide con el JQL | Se refleja como tarea |
| Incidencia resuelta en Jira | La tarea se completa en el siguiente sondeo (las tareas recurrentes avanzan al siguiente ciclo) |
| Incidencia reabierta en Jira | La tarea se reabre |
| **Cambios en ambos lados** | **Gana el cambio más reciente; en caso de empate, gana Jira** |
| Tarea eliminada en Turbo EA | La incidencia **nunca se elimina**: un comentario deja constancia |
| Incidencia eliminada en Jira | Una tarea extraída se elimina; una tarea creada en Turbo EA se conserva y se señala en el registro |

**El envío es casi inmediato; la extracción es periódica.** Los cambios hechos en
Turbo EA llegan a Jira en segundos. Los hechos en Jira se recogen en el siguiente
sondeo, de forma predeterminada en menos de cinco minutos. Cada ciclo concilia
además ambos lados, de modo que una caída de Jira o un evento perdido se corrige
solo en lugar de perder cambios.

Se mantienen alineados cuatro campos: **título**, **fecha de vencimiento**,
**estado completado** y **persona asignada**. El título corresponde a la **primera
línea** del texto de la tarea, de modo que renombrar una incidencia en Jira
sustituye exactamente esa primera línea y deja intactas las líneas de detalle
siguientes.

### La etiqueta con la clave de incidencia

Una tarea sincronizada lleva su clave de incidencia de Jira (por ejemplo
`PROJ-123`) como un pequeño enlace, tanto en la [página de tareas](../guide/tasks.md)
como en la pestaña Tareas de una tarjeta. Al pulsarla se abre la incidencia en
Jira. La etiqueta es orientativa: una tarea siempre se completa en Turbo EA o
mediante la sincronización.

### Tareas de firma

Las solicitudes de firma — un riesgo, una decisión o un proyecto pendiente de
aprobación — son tareas del sistema y **nunca** se envían como tareas normales. Si
**Reflejar todos de firma** está activado, obtienen una incidencia de Jira
**unidireccional** que enlaza directamente con la página donde la firma se produce
realmente.

Una firma nunca puede darse desde Jira. Si alguien cierra la incidencia espejo
mientras la obligación sigue abierta, la sincronización la reabre con un
comentario que remite a Turbo EA. Cuando la firma se completa en Turbo EA, el
espejo pasa a «hecho» en el siguiente sondeo.

Desactivar el interruptor impide crear *nuevos* espejos; los existentes se siguen
manteniendo.

## Supervisión

La línea **Estado** indica cuándo se sincronizó por última vez, el error que haya
habido y un resumen de lo realizado. **Actividad reciente**, debajo, enumera las
50 acciones más recientes con la hora, la dirección (**Turbo EA → Jira**,
**Jira → Turbo EA** o **Sync**), la incidencia y un mensaje de detalle. Los avisos
y errores aparecen resaltados por color: ahí es donde se ven una persona asignada
no resuelta o una transición rechazada.

## Permisos

| Permiso | Permite |
|---|---|
| `ext.jira-todos.admin` | Configurar y operar la sincronización: conexión, proyecto, filtros, ejecución manual y registro de actividad |

La subpestaña queda totalmente oculta para quien no lo tenga. **Las personas
usuarias no necesitan ningún permiso adicional**: las tareas sincronizadas
aparecen sin más en su lista habitual, con la etiqueta de la clave de incidencia.

## Si la licencia caduca o la extensión se desactiva

La tarea de sincronización y su gestor de eventos se pausan de inmediato y se
revocan los permisos de acceso a datos. **No se elimina nada**: las tareas
conservan sus etiquetas y se preserva la configuración. Una licencia renovada
reanuda la sincronización donde se quedó.

El token de API se guarda cifrado en su instancia y queda excluido de la
transferencia de espacio de trabajo, de modo que nunca sale de la instancia en la
que se introdujo.

## Resolución de problemas y limitaciones

- **Solo Jira Cloud.** Jira Data Center no es compatible.
- **Un proyecto por instancia**, y las incidencias se crean siempre con el tipo
  **Task**.
- **Sondeo, no webhooks.** Los cambios del lado de Jira llegan en el siguiente
  sondeo. Los webhooks de Jira Cloud exigirían una aplicación OAuth y una
  instancia accesible desde Internet, y aun así haría falta un sondeo de
  conciliación, así que la sincronización es periódica por diseño.
- **Correspondencia de personas y privacidad del correo.** Turbo EA empareja a las
  personas por dirección de correo y, si no lo logra, recurre a una coincidencia
  exacta del nombre visible entre las personas asignables del proyecto. Alguien
  cuyo correo esté oculto en Jira *y* cuyo nombre visible difiera entre ambos
  sistemas no puede emparejarse; esas asignaciones se dejan sin cambios y el
  registro anota la dirección que no pudo resolverse. Una persona de Turbo EA no
  resuelta nunca desasigna en silencio la incidencia de Jira.
- **Borrar una fecha de vencimiento en Jira no se refleja de vuelta.** Bórrela en
  Turbo EA.
- **Los espejos de tareas de firma son unidireccionales y llevan hasta un
  intervalo de sondeo de retraso**, porque los flujos de firma del núcleo no
  emiten eventos de cambio.
- **Sincronizar ahora** responde *A sync is already running* si ya hay un ciclo en
  curso.
- Tras rotar el `SECRET_KEY` de su instancia, el token guardado ya no puede
  descifrarse y el panel vuelve a *Not configured yet*: vuelva a introducirlo.
