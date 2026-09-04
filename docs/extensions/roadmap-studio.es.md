# Roadmap Studio

A toda función de EA su CIO le hace las mismas dos preguntas: *¿qué aspecto
tendrá el paisaje dentro de tres años?* y *¿qué pasa si elegimos otra cosa?* Las
presentaciones responden mal a la primera y nada a la segunda: quedan obsoletas
la semana siguiente al comité de dirección, y dos de ellas no se pueden comparar.

**Roadmap Studio** responde a ambas a partir del inventario que ya mantiene. Un
**escenario** es un plan superpuesto a su paisaje vivo — retirar esto, sustituir
aquello en esta fecha, añadir estas tres cosas que aún no existen — guardado como
un conjunto de cambios y no como una copia de su grafo. Nada de lo que explore
toca su inventario hasta que un plan se aprueba y se aplica, y como el plan se
lee contra lo que el inventario dice hoy, nunca se aleja en silencio de la
realidad.

## De un vistazo

| | |
|---|---|
| **Licencia** | Comercial: se requiere una habilitación firmada |
| **Versión mínima de Turbo EA** | 2.119.0 |
| **Permisos** | `ext.roadmap-studio.view`, `.manage`, `.apply`, `.admin` |
| **Concesiones de acceso a datos** | Tarjetas (lectura + escritura), eventos de tarjeta, tareas (lectura + escritura), el directorio de usuarios, los registros de decisión |
| **Requiere reinicio del backend** | Sí: la extensión incluye código de backend |
| **Dónde aparece** | **Roadmap** en la navegación principal · un chip en el detalle de una tarjeta · un panel y una sección de exportación en las decisiones |

## Transformaciones y escenarios

Una **transformación** es el programa al que pertenece un conjunto de planes
competidores — «Modernización del ERP», por ejemplo — y nombra los
[Objetivos](../guide/reports.md) de los que el programa responde. Debajo están
los **escenarios**: respuestas alternativas a la misma pregunta. Uno de ellos
puede marcarse como **recomendado**, para que la sala sepa qué propone el
arquitecto antes de leer las cifras.

Un escenario fuera de toda transformación es perfectamente válido; simplemente no
tiene alternativas frente a las que ser elegido.

## El inventario de planificación y la roadmap

![La roadmap: carriles, mesetas y la banda de costes](../assets/img/en/73_ext_roadmap_studio_roadmap.png)

La **roadmap** dibuja el plan como barras fechadas en carriles, con una banda de
costes debajo que muestra el coste de funcionamiento año a año, incluido el
repunte durante un funcionamiento en paralelo: justo la cifra que un caso de
negocio de migración suele ocultar.

![El inventario de planificación](../assets/img/en/74_ext_roadmap_studio_inventory.png)

El **inventario de planificación** es el mismo plan como cuadrícula: sus tarjetas
vivas más las planificadas, con cada cambio sobre ellas. Las tarjetas
planificadas viven dentro del escenario y nunca en su inventario principal.

Un cambio cuya tarjeta destino se haya archivado, movido o refechado en otro
sitio se **marca como obsoleto**, con el motivo: así un plan escrito hace tres
meses le dice qué se ha movido bajo él.

## Mesetas y el corte de arquitectura

![La arquitectura en una meseta](../assets/img/en/75_ext_roadmap_studio_architecture.png)

Como cada cambio lleva una fecha, la arquitectura en cualquier momento es
simplemente el escenario evaluado en esa fecha. Nombre los momentos que importan
como **mesetas** — «T1 · Consolidación del núcleo, 3T 2027» — y recórralas: la
roadmap, la vista de dependencias y las cifras avanzan juntas.

## Comparar escenarios

![Escenarios frente a no hacer nada](../assets/img/en/76_ext_roadmap_studio_compare.png)

**Comparar** pone cada escenario junto a la línea base de no hacer nada en coste
de funcionamiento en el horizonte, gasto de transformación, número de tarjetas y
exposición a fin de vida, con los **pros y contras** de cada plan escritos junto a
sus cifras. Una tasa de descuento opcional se aplica a los años futuros.

## Donde el plan se encuentra con la tarjeta

![El lugar de una tarjeta en los planes](../assets/img/en/77_ext_roadmap_studio_card_panel.png)

Abra cualquier tarjeta de su inventario y un chip le dirá qué planes la mencionan
y cómo: como algo que se retira, como el sucesor de una sustitución, o como una
tarjeta que un plan coloca bajo un nuevo padre.

## Revisión, decisión y aplicación

Este es el camino de gobernanza, y separa tres cosas genuinamente distintas: el
**consejo**, **la decisión** y **la escritura**.

### 1 · Pedir revisión

**Solicitar revisión** nombra a las personas cuya opinión quiere y crea una tarea
real para cada una, que llega a su página de Tareas y a su campana de
notificaciones. El selector abarca todo el directorio: un revisor es quien pueda
ayudar con *este* plan — el arquitecto de seguridad para uno, el socio financiero
para otro.

Cada revisor responde en la aplicación con **Respaldar**, **Solicitar cambios** o
**Comentar**, más una nota. Sus respuestas son consejo. No deciden nada, y por eso
ya no usan las palabras «aprobar» y «rechazar».

### 2 · Discutirlo

Cualquiera que pueda leer el plan puede escribir en su **discusión**. El hilo
lleva toda la historia en el orden en que ocurrió: comentarios, cada respuesta de
revisión (no solo la última) y, después, los envíos y los votos. El comité lee la
misma conversación que tuvieron los revisores, en vez de recibir un veredicto sin
los argumentos que lo sostienen.

### 3 · Enviarlo al comité de revisión

Un **comité de revisión** es un grupo de personas con nombre, asociado a una
transformación (véase más abajo). Cuando un plan tiene uno, **Enviar a decisión**
lo remite allí:

- el estado pasa a **Pendiente de decisión** y el contenido del plan se
  **bloquea**, para que todos voten sobre el mismo documento;
- cada miembro recibe una tarea *Decidir sobre …*, con la notificación de
  asignación habitual;
- aquí elige si la aprobación debe archivar un **registro de decisión** y crear
  las **iniciativas**: se decide al enviar, para que quienes votan vean qué creará
  su sí.

El **control de aprobación** (Admin → Configuración, véase más abajo) puede
retener un plan antes de su comité hasta que los revisores hayan respondido.

### 4 · El comité vota

Cada miembro vota **Aprobar**, **Rechazar** o **Abstenerse**, con una nota
opcional, y puede cambiar su voto mientras la ronda siga abierta. El diálogo
muestra el recuento, cuántas aprobaciones faltan y qué dijo cada miembro.

La ronda se resuelve en cuanto la **regla de decisión** del comité queda
determinada:

| Regla | Aprueba cuando | Rechaza cuando |
|---|---|---|
| **Mayoría** (por defecto) | Más de la mitad aprueba | Han rechazado tantos que la mayoría es imposible |
| **Unanimidad** | Todos los miembros aprueban | Un miembro rechaza **o** se abstiene |
| **Cualquier miembro** | Un miembro aprueba | Todos han votado y ninguno aprueba |

El rechazo llega en cuanto la aprobación se ha vuelto aritméticamente imposible,
y no después de que todos hayan votado sobre una cuestión ya resuelta.

Lo que permite votar es **pertenecer al comité**: `ext.roadmap-studio.apply` no
hace falta. El **autor del plan puede votar** sobre su propio plan; el diálogo lo
dice con claridad y el registro nombra quién votó.

**Retirar** saca un plan de manos del comité antes de que haya decidido. Pueden
hacerlo el autor, quien lo envió y cualquier miembro: un comité que quiere una
reelaboración no debería tener que rechazar el plan para pedirla. Las tareas de
los miembros se eliminan, no se marcan como hechas, y el plan vuelve a revisión.

### 5 · Qué hace la aprobación

El voto decisivo lo hace todo de una vez: los escenarios competidores de la misma
transformación quedan **rechazados**, el plan se **bloquea**, las solicitudes
abiertas se saldan, se crean las **iniciativas** (un programa para la
transformación, un proyecto por meseta) y se archiva un **registro de decisión**
en borrador en [Entrega EA → Decisiones](../guide/delivery.md), nombrando el
comité, su regla, el recuento, cada voto con su nota, los objetivos, las mesetas,
las cifras frente a no hacer nada y cada alternativa rechazada. Después se piden
firmas a los miembros que votaron a favor.

Un plan aprobado es de solo lectura hasta que alguien con
`ext.roadmap-studio.apply` lo **reabra**, lo que borra la aprobación.

### 6 · Aplicarlo

**Aplicar** escribe el plan en su inventario vivo, bajo
`ext.roadmap-studio.apply`. Es una acción aparte, a menudo meses después de la
decisión. Cada escritura pasa por la maquinaria de lotes auditada, así que aparece
en **Admin → Registro de auditoría** y puede revertirse. Un usuario con `.manage`
puede abrir el mismo plan en solo lectura para comprobar que se aplicaría
limpiamente.

### Escenarios sin comité de revisión

Un escenario fuera de una transformación, o cuya transformación no tiene comité,
mantiene el camino más simple: alguien con `ext.roadmap-studio.apply` lo aprueba
directamente. Un equipo pequeño sin un órgano de gobernanza que convocar no tiene
que inventarse uno.

## Comités de revisión

Los comités se gestionan en un solo sitio: **Configuración → Gobernanza →
Gestionar comités de revisión** dentro de la página Roadmap (requiere
`ext.roadmap-studio.admin`). Un comité tiene nombre, descripción, hasta 25
miembros y una **regla de decisión**. Asócielo a una o varias transformaciones
desde cualquiera de los dos lados.

Eliminar un comité desvincula las transformaciones que revisaba; nunca las
elimina, y nunca toca el registro de lo que decidió en el pasado.

## Configuración e historial

![Configuración e historial de actividad](../assets/img/en/79_ext_roadmap_studio_settings.png)

La pestaña **Configuración** de la página Roadmap (requiere
`ext.roadmap-studio.admin`) contiene:

| Ajuste | Qué hace |
|---|---|
| **Modelo de costes** | Qué atributo guarda el coste anual de funcionamiento de una tarjeta, qué tipos de tarjeta cuenta el indicador, hasta dónde mira la exposición a fin de vida y una tasa de descuento opcional |
| **Control de aprobación** | Si las respuestas de los revisores retienen un plan antes de su comité: nunca, mientras se pidan cambios, o hasta que todos hayan respondido |
| **Comités de revisión** | Abre el diálogo de comités |

La tarjeta **Historial** es un registro completo de actividad: cada plan,
tarjeta, cambio, meseta, solicitud de revisión, respuesta, envío, voto,
comentario y decisión, con quién lo hizo y qué cambió.

## Modo presentación y la baraja

![Modo presentación](../assets/img/en/78_ext_roadmap_studio_present.png)

El **modo presentación** lleva a una sala por el plan meseta a meseta, y la
exportación a PowerPoint sigue exactamente la secuencia que acaba de recorrer.

## Datos de demostración

Un clic en Configuración carga un paisaje de ejemplo completo con dos escenarios
competidores, para probarlo todo antes de introducir sus propios datos. Otro clic
elimina cualquier rastro.

## Permisos

| Permiso | Concede |
|---|---|
| `ext.roadmap-studio.view` | Ver escenarios, comparaciones, mesetas, la discusión y la decisión |
| `ext.roadmap-studio.manage` | Crear y editar planes, solicitar revisión, enviar a decisión, retirar |
| `ext.roadmap-studio.apply` | Aplicar un plan aprobado al inventario vivo, reabrirlo y aprobar un plan que no tiene comité de revisión |
| `ext.roadmap-studio.admin` | Configuración, comités de revisión y datos de demostración |

Votar no es un permiso: surge de la **pertenencia al comité** que decide sobre
ese plan, más `ext.roadmap-studio.view` para abrirlo. Cualquiera con `.view`
puede escribir en la discusión.

## Si la licencia caduca o la extensión se desactiva

La página Roadmap y su API desaparecen, pero **no se elimina nada**: escenarios,
planes, votos y la discusión permanecen en las tablas propias de la extensión.
Las tarjetas que la extensión creó en su inventario son tarjetas normales y no se
ven afectadas. Aplicar una licencia renovada lo devuelve todo.

## Notas y limitaciones

- **Un plan a la vez** llega al comité dentro de una misma transformación.
- **Sin presidencia ni votos ponderados.** Cada voto cuenta una vez y no hay voto
  de calidad.
- **Sin recordatorios.** Una ronda sigue abierta hasta que la regla la resuelve o
  alguien la retira.
- **El autor del plan puede votar** sobre su propio plan. Es deliberado: un
  comité pequeño cuyo arquitecto no pudiera votar no podría decidir nada, y cada
  voto queda nombrado en el registro.
- La extensión incluye código de backend, así que instalarla o actualizarla
  requiere un reinicio puntual del backend. Turbo EA muestra un aviso cuando
  procede.
