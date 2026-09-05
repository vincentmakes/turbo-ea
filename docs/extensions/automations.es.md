# Automations

La mayor parte de la gobernanza de EA es una lista de cosas que alguien prometió
hacer a mano: crear un riesgo cuando una aplicación supera un umbral de coste sin
propietario, reclamar al propietario técnico cuando un componente llega al fin de
vida, avisar al propietario de negocio cuando se edita una tarjeta aprobada. La
lista es correcta; lo que falla es hacerlo, porque cada punto es un recordatorio
en la cabeza de alguien y no una regla que la plataforma mantiene.

**Automations** convierte esas promesas en reglas que Turbo EA ejecuta por usted.
Una regla se construye por completo con desplegables — *cuando* ocurre algo en
el paisaje, *si* se cumplen unas condiciones, *entonces* se ejecutan unas
acciones — y cada ejecución queda registrada como un lote de mutación en el
Registro de auditoría, de modo que una regla que salió mal se deshace con un
clic.

## De un vistazo

| | |
|---|---|
| **Licencia** | Comercial — se requiere un derecho firmado |
| **Versión mínima de Turbo EA** | 2.126.0 |
| **Permisos** | `ext.automations.view`, `ext.automations.manage` |
| **Concesiones de acceso a datos** | Tarjetas (lectura + escritura), eventos de tarjeta y de tarea, tareas (lectura + escritura), el directorio de usuarios, riesgos (lectura + escritura), registros de decisión, notificaciones, roles de parte interesada |
| **Requiere reinicio del backend** | Sí: la extensión incluye código de backend |
| **Dónde aparece** | **Automations** en la sección **Admin** del menú de usuario · un chip con el número de ejecuciones en el detalle de una tarjeta |

## Una regla: cuándo, si, entonces

![La cuadrícula de reglas](../assets/img/en/86_ext_automations_rules.png)

La pestaña **Reglas** enumera cada regla con su disparador, su tipo de tarjeta,
sus acciones, un interruptor de activación, su última ejecución y un botón de
reproducción. Abra una para ver el editor.

![El editor de reglas](../assets/img/en/87_ext_automations_editor.png)

El editor le lee la regla en lenguaje llano en la parte superior y después
recorre sus tres partes:

**Cuándo** — qué inicia una ejecución. Una regla vigila un tipo de tarjeta y se
dispara con uno de estos eventos:

| Disparador | Se dispara cuando |
|---|---|
| se crea / actualiza / archiva / restaura una tarjeta | esa tarjeta cambia |
| se añade / elimina una relación | una relación, opcionalmente de un tipo dado, toca la tarjeta |
| se completa una tarea | se cierra una tarea asociada a la tarjeta |
| según una programación | llega el momento de una expresión cron de cinco campos (UTC); la regla comprueba entonces cada tarjeta del tipo |

**Si** — las condiciones, como grupos anidados de tipo **todas** / **cualquiera**.
Cada fila es un campo, un operador y un valor elegidos en desplegables: los
campos propios de la tarjeta y sus fases del ciclo de vida, sus etiquetas, sus
roles de parte interesada (*no lo tiene nadie*, *lo tiene*…), sus relaciones,
su estado de fin de vida en Aplicaciones y Componentes de TI y — en *se
actualiza una tarjeta* — qué **cambió**, de modo que una regla se dispare solo
cuando un valor pasó de un estado a otro. Deje el grupo vacío para ejecutarla en
todas las tarjetas.

**Entonces** — las acciones, ejecutadas en orden. Una acción que falla detiene
la ejecución, y la fila de la ejecución indica qué paso falló.

| Acción | Qué hace | Necesita |
|---|---|---|
| Establecer / vaciar un campo, fijar una fecha del ciclo de vida, establecer el subtipo, el padre, el nombre o la descripción | Edita la tarjeta | escritura de inventario |
| Establecer etiquetas | Sustituye, añade o elimina etiquetas, respetando los grupos de elección única | escritura de inventario |
| Crear una tarjeta relacionada, vincular una relación | Añade una tarjeta de otro tipo y la conecta, o conecta dos tarjetas existentes | escritura de inventario |
| Archivar la tarjeta | La archiva (recuperable durante 30 días) | escritura de inventario |
| Asignar / quitar un rol de parte interesada | Da un rol a una persona, a quien ya tiene un rol, a quien tiene el rol en el padre o a la persona que disparó la regla | roles de parte interesada |
| Crear una tarea | Una tarea en la tarjeta para una persona asignada, con fecha de vencimiento | tareas |
| Notificar a personas | Una notificación en la aplicación / por correo según las preferencias de cada destinatario | notificaciones |
| Crear un riesgo, actualizar un riesgo | Registra un riesgo en el Registro de riesgos con categoría, probabilidad e impacto, vinculado a la tarjeta y con un propietario; una ejecución posterior puede actualizar su título, su propietario o su fecha objetivo | riesgos |
| Registrar un borrador de decisión | Un Registro de Decisión de Arquitectura en borrador vinculado a la tarjeta — una regla nunca lo firma | registros de decisión |
| Llamar a un webhook | Una petición HTTPS firmada a un sistema externo con la tarjeta, lo que cambió y la regla | — |
| Detener | Termina la lista de acciones | — |

Los títulos, las descripciones y los mensajes son plantillas: `{{card.name}}`,
`{{card.attributes.costTotalAnnual}}`, `{{actor.name}}`, `{{change.old}}` y
similares se rellenan por tarjeta, y el editor ofrece las variables en un menú.

Bajo las acciones hay dos opciones. **Disparar una vez por tarjeta** (activada
por defecto) recuerda para qué se disparó una regla, de modo que una regla
nocturna no cree el mismo riesgo cada noche; vuelve a dispararse cuando cambian
los valores que lee. La **puesta al día nocturna** vuelve a comprobar cada
tarjeta a las 03:00 UTC, de modo que un evento perdido se corrige solo.

## Simular y Ejecutar ahora

**Simular** ejecuta la regla contra todas las tarjetas de su tipo en modo de
vista previa — no se escribe nada — y muestra cuántas tarjetas coinciden y, por
tarjeta, exactamente qué haría cada acción. Activar una regla que nunca se ha
simulado le pide que la simule primero; aun así puede activarla sin hacerlo.

**Ejecutar ahora** hace lo mismo de verdad: se dispara de inmediato para cada
tarjeta que coincide, respetando *disparar una vez por tarjeta* salvo que
marque *disparar de nuevo para las tarjetas ya tratadas*. El diálogo de
resultados muestra qué se hizo, tarjeta por tarjeta, y enlaza al lote de
auditoría.

![Resultados de una ejecución](../assets/img/en/88_ext_automations_run_results.png)

## Ejecuciones y el Registro de auditoría

![La pestaña de ejecuciones](../assets/img/en/89_ext_automations_runs.png)

Cada ejecución es una fila de la pestaña **Ejecuciones**: qué regla, sobre qué
tarjeta, cómo empezó (un evento, la programación, la puesta al día nocturna,
Ejecutar ahora), cómo terminó y cada línea de acción. Filtre por regla o por
resultado; el número de ejecuciones de una tarjeta aparece como un chip en su
página de detalle.

Cada escritura que hace una ejecución llega a **Admin → Configuración → Registro
de auditoría** como un lote de extensión con diferencias por evento. Un
**barrido** — una programación, la puesta al día nocturna o Ejecutar ahora — es
**un solo lote para todas las tarjetas en las que se disparó**, de modo que una
regla que salió mal es un único **Revertir**, no uno por tarjeta. Revertir
deshace las escrituras en tarjetas y relaciones y, desde Turbo EA 2.127.0, los
riesgos que la ejecución creó o editó, los roles que asignó, las etiquetas que
estableció y los borradores de decisión que registró. Las tareas y las
notificaciones se dejan deliberadamente en su sitio — una petición a una persona
y un mensaje ya entregado no se deshacen borrándolos — y la vista previa de la
reversión lo indica antes de aplicar nada.

## Las notificaciones se agrupan

Una regla nunca envía una notificación por tarjeta. Un barrido recopila lo que se
le debe a cada persona y envía **una** notificación por persona y regla al
final — una sola tarjeta llega como mensaje propio; varias, como un resumen que
nombra las tarjetas y cuyo título fija usted en la acción (*Título del
resumen*). Los cambios que llegan uno a uno — una importación que toca
trescientas tarjetas — envían la primera notificación al instante y retienen el
resto durante la **ventana de agrupación** de Configuración; al minuto siguiente
se envía lo acumulado como un solo resumen. Las preferencias de notificación de
cada persona siguen decidiendo entre la campana, el correo o un canal de
extensión.

## Plantillas

La pestaña **Plantillas** es una galería de reglas listas para usar — una
aplicación costosa sin propietario, fin de vida en menos de 180 días, una
aplicación nueva sin capacidad de negocio, una tarjeta aprobada que se editó,
calidad de datos baja durante un mes, una aplicación que entra en fase de
salida, una tarjeta archivada con relaciones abiertas, una iniciativa que pasa a
activa, una aplicación crítica sin propietario técnico, un proveedor nuevo
registrado, un componente de TI en fin de vida. Cada una se abre en el editor,
desactivada, para que la ajuste y la simule.

## Configuración

![Configuración](../assets/img/en/90_ext_automations_settings.png)

| Ajuste | Qué hace |
|---|---|
| **Persona de respaldo** | Recibe la tarea, el riesgo o la notificación cuando una regla no encuentra a nadie en el rol que pidió |
| **Lista de hosts permitidos para webhooks** | Hosts a los que puede llegar la acción *Llamar a un webhook*, uno por línea; vacía, permite cualquier host HTTPS público. Las direcciones privadas e internas se rechazan siempre |
| **Tarjetas comprobadas por ejecución programada** | Cuántas tarjetas examina un barrido programado antes de detenerse y dejar el resto para el siguiente |
| **Agrupar las notificaciones que lleguen en** | La ventana de agrupación, en minutos; 0 envía cada una al minuto siguiente |

## Datos de demostración

**Cargar datos de demostración** en Configuración instala las plantillas y tres
reglas de muestra sobre el paisaje de ejemplo, activa la mayoría y ejecuta unas
cuantas una vez, para que las pestañas Reglas, Ejecuciones y Registro de
auditoría tengan algo que mostrar. **Retirar** elimina exactamente eso: las
reglas, las ejecuciones, las tareas y los riesgos que crearon.

## Permisos

| Permiso | Concede |
|---|---|
| `ext.automations.view` | Ver las reglas, sus ejecuciones y la galería de plantillas, y el chip con el número de ejecuciones en las tarjetas |
| `ext.automations.manage` | Crear, editar, activar, simular, ejecutar y eliminar reglas; cambiar la configuración; cargar datos de demostración |

## Si la licencia caduca o la extensión se desactiva

La página desaparece del menú, las programaciones se detienen y los eventos
dejan de despacharse. No se elimina nada: las reglas, sus ejecuciones y todo lo
que escribieron — tarjetas, riesgos, tareas, decisiones — permanecen exactamente
como están. Renovar la licencia o volver a activar la extensión devuelve las
reglas, todavía activadas.

## Notas y limitaciones

- Turbo EA permite a una extensión 60 lotes auditados por minuto. Un barrido
  sobre un inventario muy grande se detiene en ese límite y continúa en el
  siguiente ciclo; Ejecutar ahora lo indica en su resultado y el siguiente
  barrido retoma las tarjetas restantes.
- Una regla que vigila *se actualiza una tarjeta* solo ve los cambios hechos
  después de activarla; use Ejecutar ahora o espere a la puesta al día nocturna
  para el paisaje existente. Las condiciones sobre **qué cambió** solo coinciden
  con actualizaciones en vivo.
- Los webhooks son solo HTTPS, van firmados con un secreto por instancia, nunca
  siguen redirecciones y expiran a los 10 segundos; la respuesta se registra en
  la ejecución.
- Una regla solo puede actualizar los riesgos que ella creó, y nunca puede
  firmar una decisión, cambiar el estado de un riesgo ni completar una tarea:
  esos siguen siendo actos humanos.
