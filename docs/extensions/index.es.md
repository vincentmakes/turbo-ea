# Extensiones

Las **extensiones** añaden capacidades a Turbo EA sin modificar el núcleo —
contenido adicional de metamodelo, integraciones con las herramientas que sus
equipos ya utilizan, informes regulatorios y páginas completamente nuevas. Las
crea y firma Turbo EA y se instalan desde **Admin → Extensiones**.

Esta sección describe *qué hace* cada extensión publicada y cómo utilizarla. Para
saber cómo funciona la tienda en sí — confianza y firmas, licencias,
identificadores de instancia, instalación, actualizaciones y periodos de prueba —
consulte [Administración → Tienda de extensiones](../admin/extensions.md).

## Extensiones disponibles

### Estrategia, planificación y transformación

| Extensión | Qué hace | Licencia |
|-----------|----------|----------|
| [Digital Autonomy Assessment](digital-autonomy.md) | Evalúa cada aplicación según el Digital Autonomy Assessment Framework de la Universidad de Utrecht — 22 indicadores ponderados, una puntuación de autonomía automática de 1 a 10 y un cuadrante de riesgo/mitigación | **Gratuita** |
| [EA Value Tracker](value-savings.md) | Convierte las decisiones de arquitectura en un registro financiero auditable: ahorros declarados por categoría, aprobación de la realización con cuatro ojos y un panel de valor | Comercial |
| [Roadmap Studio](roadmap-studio.md) | Planifica futuros alternativos del paisaje como escenarios, recorre las mesetas de transición, los compara por coste y exposición a fin de vida, y los lleva de la revisión a la decisión de un comité | Comercial |
| [Automations](automations.md) | Ejecuta reglas de gobernanza construidas con desplegables — cuando una tarjeta, una relación o una tarea cambia o se dispara una programación, si se cumplen las condiciones, entonces establece campos, etiquetas y roles, crea tareas, crea riesgos, registra borradores de decisión, notifica a personas o llama a un webhook — cada ejecución es un lote auditado con Revertir | Comercial |

### Integraciones

| Extensión | Qué hace | Licencia |
|-----------|----------|----------|
| [Jira Todo Sync](jira-todos.md) | Mantiene alineadas en ambos sentidos las tareas de Turbo EA y un proyecto de Jira Cloud — estado, título, vencimiento y persona asignada | Comercial |
| [Slack Notifications](slack-notify.md) | Entrega a cada persona sus notificaciones de Turbo EA como mensaje directo de Slack, con adhesión voluntaria por persona y por tipo | Comercial |

### Regulaciones

| Extensión | Qué hace | Licencia |
|-----------|----------|----------|
| [DORA Register of Information](dora-roi.md) | Mantiene el registro de información del art. 28 de DORA sobre sus tarjetas existentes y exporta el paquete oficial de presentación xBRL-CSV | Comercial |

## Lo que todas las extensiones tienen en común

- **Firmadas por el proveedor.** Cada paquete lleva una firma Ed25519 que Turbo EA
  verifica al subirlo *y* en cada arranque del backend. Lo que se instala es
  exactamente lo que el proveedor creó.
- **Sujetas a licencia en ejecución** (salvo las gratuitas). Si una licencia
  caduca, la extensión se desactiva de forma suave — sus páginas desaparecen y sus
  tareas en segundo plano se detienen — pero **sus datos nunca se eliminan**. Una
  licencia renovada lo restaura todo.
- **Mínimo privilegio.** Todo lo que una extensión lee o escribe más allá de sus
  propios datos se declara como **permiso de acceso** dentro del paquete firmado,
  de modo que es visible antes de instalar. Véase
  [Permisos de acceso a datos](../admin/extensions.md).
- **Sus propios permisos.** Cada extensión define claves de permiso con el formato
  `ext.<nombre>.…` que aparecen en **Admin → Usuarios y roles** una vez cargada:
  usted decide quién puede utilizarla.
- **Auditables.** Cualquier cambio que una extensión realice en su inventario
  queda registrado en el **Admin → Registro de auditoría** con el origen
  **Extensión** y puede revertirse.

## Antes de instalar

Compruebe la **versión mínima de Turbo EA** indicada en la página de cada
extensión: no se instalará en un núcleo anterior. Las extensiones que incluyen
código de backend requieren un reinicio puntual del backend tras la instalación;
Turbo EA muestra entonces un aviso.
