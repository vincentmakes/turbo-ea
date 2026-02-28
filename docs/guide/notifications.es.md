# Notificaciones

Turbo EA le mantiene informado sobre cambios en fichas, tareas y documentos que le importan. Las notificaciones se entregan **en la aplicación** (mediante la campana de notificaciones) y opcionalmente **por correo electrónico** si SMTP está configurado.

## Campana de Notificaciones

El **icono de campana** en la barra de navegación superior muestra una insignia con la cantidad de notificaciones no leídas. Haga clic para abrir un menú desplegable con las 20 notificaciones más recientes.

Cada notificación muestra:

- **Icono** que indica el tipo de notificación
- **Resumen** de lo que sucedió (ej., «Se le asignó una tarea en SAP S/4HANA»)
- **Tiempo** desde que se creó la notificación (ej., «hace 5 minutos»)

Haga clic en cualquier notificación para navegar directamente a la ficha o documento relevante. Las notificaciones se marcan como leídas automáticamente cuando las visualiza.

## Tipos de Notificaciones

| Tipo | Evento |
|------|--------|
| **Tarea asignada** | Se le asigna una tarea |
| **Ficha actualizada** | Se actualiza una ficha en la que es parte interesada |
| **Comentario agregado** | Se publica un nuevo comentario en una ficha en la que es parte interesada |
| **Estado de aprobación cambiado** | Cambia el estado de aprobación de una ficha (aprobada, rechazada, rota) |
| **Solicitud de firma SoAW** | Se le solicita firmar una Declaración de Trabajo de Arquitectura |
| **SoAW firmado** | Un SoAW que está siguiendo recibe una firma |
| **Solicitud de encuesta** | Se envía una encuesta que requiere su respuesta |

## Entrega en Tiempo Real

Las notificaciones se entregan en tiempo real utilizando Server-Sent Events (SSE). No necesita actualizar la página — las nuevas notificaciones aparecen automáticamente y el contador de la insignia se actualiza al instante.

## Preferencias de Notificaciones

Haga clic en el **icono de engranaje** en el menú desplegable de notificaciones (o vaya al menú de su perfil) para configurar sus preferencias de notificaciones.

Para cada tipo de notificación, puede alternar de forma independiente:

- **En la aplicación** — Si aparece en la campana de notificaciones
- **Correo electrónico** — Si también se envía un correo electrónico (requiere que SMTP esté configurado por un administrador)

Algunos tipos de notificaciones (ej., solicitudes de encuesta) pueden tener la entrega por correo electrónico obligatoria por el sistema y no pueden desactivarse.
