# Tareas y Encuestas

La página de **Tareas** centraliza todos los elementos de trabajo pendientes en un solo lugar. Tiene dos pestañas: **Mis Tareas** y **Mis Encuestas**.

![Sección Mis Tareas](../assets/img/es/18_tareas.png)

## Mis Tareas

Las tareas son actividades asignadas a usted o creadas por usted. Pueden estar vinculadas a fichas específicas o ser independientes.

### Filtrado

Use las pestañas de estado para filtrar:

- **Abiertas** — Tareas aún pendientes o en progreso
- **Completadas** — Tareas finalizadas
- **Todas** — Todo

### Gestión de Tareas

- **Cambio rápido** — Haga clic en la casilla de verificación para marcar una tarea como completada (o reabrirla)
- **Enlace a ficha** — Si una tarea está vinculada a una ficha, haga clic en el nombre de la ficha para navegar a su página de detalle
- **Tareas del sistema** — Algunas tareas son generadas automáticamente por el sistema (ej., «Responder a encuesta para Ficha X»). Estas incluyen un enlace directo a la acción relevante

### Crear Tareas

Puede crear tareas desde dos lugares:

1. **Desde esta página** — Haga clic en **+ Nueva Tarea**, ingrese un título, opcionalmente establezca un asignado, fecha de vencimiento y vincule a una ficha
2. **Desde la pestaña Tareas de una ficha** — Cree una tarea que se vincula automáticamente a esa ficha

Cada tarea registra:

| Campo | Descripción |
|-------|-------------|
| **Título** | Lo que necesita hacerse |
| **Estado** | Abierta o Completada |
| **Asignado** | El usuario responsable |
| **Fecha de vencimiento** | Fecha límite opcional |
| **Ficha** | La ficha vinculada (opcional) |

### Tareas recurrentes

Al crear una tarea desde la pestaña **Todos** de una ficha, active **Repetir** para convertirla en una tarea recurrente — ideal para actividades regulares como «revisar esta ficha cada 6 meses». Elija con qué frecuencia se repite (cada *N* días, semanas, meses o años).

- **Avance automático** — Cuando marca una tarea recurrente como completada, la siguiente repetición se crea automáticamente con su fecha de vencimiento desplazada según la cadencia (correcta en el calendario, de modo que una revisión de fin de mes se mantiene a fin de mes).
- **Tiempo de anticipación** — Una repetición lejana permanece **Programada** (oculta de su lista de abiertas, sin notificación) hasta que se abre su ventana de anticipación; entonces se convierte en una tarea abierta normal y notifica al responsable. El tiempo de anticipación tiene valores por defecto sensatos según la cadencia y se puede ajustar.
- **Activar antes** — Haga clic en el icono de evento próximo de una tarea programada para activarla de inmediato si desea hacer la revisión con antelación.

## Mis Encuestas

La pestaña **Encuestas** muestra todas las encuestas de mantenimiento de datos que necesitan su respuesta. Las encuestas son creadas por administradores para recopilar información de las partes interesadas sobre fichas específicas (ver [Administración de Encuestas](../admin/surveys.es.md)).

Cada encuesta pendiente muestra:

- El nombre de la encuesta y la ficha objetivo
- Un botón **Responder** que navega al formulario de respuesta

El formulario de respuesta presenta preguntas configuradas por el administrador. Sus respuestas pueden actualizar automáticamente los atributos de la ficha, dependiendo de cómo se configuró la encuesta.
