# EU AI Act Register

El Reglamento de IA de la UE se aplica por etapas, y todo proveedor y responsable
del despliegue de sistemas de IA tiene que responder a las mismas cuatro
preguntas: cuáles de sus sistemas son sistemas de IA, qué nivel de riesgo tiene
cada uno, qué obligaciones se derivan de su rol y dónde está la evidencia.

**EU AI Act Register** las responde sobre las tarjetas que su repositorio de EA ya
contiene. Está pensado para proveedores y responsables del despliegue de sistemas
de IA y de modelos de IA de uso general (GPAI) que mantienen, o quieren mantener,
su panorama de TI en Turbo EA.

!!! warning "Registra su evaluación — no es asesoramiento jurídico"
    El registro está estructurado conforme al Reglamento (UE) 2024/1689, en su
    versión modificada por el Reglamento (UE) 2026/1744. Registra y organiza el
    trabajo de cumplimiento propio de su organización y las decisiones de su
    gente. No es asesoramiento jurídico y no garantiza la conformidad.

## El registro vive en sus tarjetas

El registro **no mantiene tablas propias** para su contenido. Cada atributo
regulatorio es un campo de una tarjeta, que se edita en la propia vista de
tarjeta de Turbo EA con un texto de ayuda que cita el artículo:

| Objeto del registro | En Turbo EA |
|---|---|
| Sistemas de IA | Tarjetas de **Aplicación** con *In AI Act scope* activado |
| Modelos de IA de uso general | Tarjetas de **Componente de TI** con *GPAI model (Art. 3(63))* activado |
| Gobernanza de la IA de una organización | Tarjetas de **Organización** |

La extensión añade estas secciones:

| Tipo de tarjeta | Sección | Contiene |
|---|---|---|
| **Aplicación** | EU AI Act | In AI Act scope, Operator role, Risk tier, Annex III category, Annex I regime, Placed on the market before the high-risk date (Art. 111(2)), Art. 6(3) derogation claimed, Art. 6(3) rationale, Intended purpose, Art. 50 transparency duties, Substantially modified (Art. 25), AI Act classification completeness (%) |
| **Aplicación** | EU AI Act — Provider obligations | un estado por obligación del proveedor, del Art. 9 al Art. 73 |
| **Aplicación** | EU AI Act — Deployer obligations | un estado por obligación del responsable del despliegue del Art. 26, la FRIA (FRIA required, su estado y fecha) y el registro del Art. 49(3) |
| **Componente de TI** | EU AI Act — GPAI / Model | GPAI model (Art. 3(63)), Model origin, Systemic risk (Art. 51), Training compute (log10 FLOPs), los estados de las obligaciones de los Art. 53 y Art. 55, AI Act classification completeness (%) |
| **Organización** | AI governance (EU AI Act) | AI literacy programme (Art. 4), Body governed by public law, AI governance contact |

Cada estado de obligación es uno de **Not started**, **In progress**,
**Implemented** o **Not applicable**.

Los campos solo se muestran donde son relevantes. Una Aplicación muestra solo el
interruptor *In AI Act scope* hasta que se guarda como dentro del ámbito. Después,
cada estado de obligación aparece solo donde su obligación puede aplicarse al rol,
al nivel de riesgo y a las condiciones de la tarjeta, el campo *Placed on the
market before the high-risk date (Art. 111(2))* aparece en los sistemas de alto
riesgo, y los campos GPAI de un Componente de TI siguen a su interruptor GPAI. Un
estado ya rellenado permanece visible para poder borrarlo, y los valores ocultos se
conservan, nunca se eliminan.

**El chip de la cabecera.** Cada tarjeta de sistema de IA y de modelo GPAI muestra
**Obligations implemented** en su cabecera — por ejemplo *Obligations implemented:
0 of 1*. Su tooltip enumera lo que sigue abierto, con el estado y la fecha límite
de cada obligación, y nombra cualquier dato de clasificación que falte; un clic
abre las obligaciones abiertas de ese sistema en el espacio de trabajo. Donde no
hay nada que contar, indica **No AI Act obligations apply**, **AI Act obligations:
classify first** o **Prohibited practice (Art. 5)**.

![Una tarjeta de sistema de IA con su sección EU AI Act y el chip de la cabecera](../assets/img/en/107_ext_eu_ai_act_card.png)

### Dos medidas

El registro informa de dos cifras, y responden a preguntas distintas — un sistema
puede estar totalmente clasificado y no tener nada implementado.

| | Classification completeness | Obligations implemented |
|---|---|---|
| **Pregunta** | ¿Cuánto de la clasificación está registrado? | ¿Cuántas de las obligaciones aplicables se cumplen? |
| **Sistemas de IA** | Operator role, nivel de riesgo, finalidad prevista y, en los sistemas de alto riesgo, la categoría del anexo III o el régimen del anexo I | Las obligaciones que se aplican al sistema según rol, nivel de riesgo y deberes seleccionados |
| **Modelos GPAI** | Origen del modelo y clasificación de riesgo sistémico | Las obligaciones del Art. 53, más las del Art. 55 para un modelo de riesgo sistémico |
| **Se muestra** | El campo de tarjeta *AI Act classification completeness (%)*, el panel | El chip de la cabecera de la tarjeta, el panel, el Registro y la pestaña Obligations |

**Implemented** y **Not applicable** cuentan como cumplidas; **In progress** y
**Not started** no. Donde no hay porcentaje, el registro dice por qué: **No
obligations apply**, **Classify first** (rol o nivel de riesgo aún sin definir) o
**Prohibited practice** (nada que implementar — el sistema debe retirarse o
rediseñarse para salir del Art. 5).

## De un vistazo

| | |
|---|---|
| **Licencia** | Comercial — se requiere un derecho de uso firmado |
| **Versión mínima de Turbo EA** | 2.186.0 |
| **Permisos** | `ext.eu-ai-act.view`, `ext.eu-ai-act.manage`, `ext.eu-ai-act.submit`, `ext.eu-ai-act.admin` |
| **Concesiones de acceso a datos** | `core.cards.read`, `core.cards.write`, `core.users.read`, `metamodel.custom_field_types` |
| **Requiere reinicio del backend** | Sí — incluye código de backend |
| **Dónde aparece** | **Reglamento de IA de la UE** en el menú **GRC**, con siete pestañas (una entrada de primer nivel cuando el menú GRC no está disponible para usted) · **Informes → Reglamento de IA de la UE - Panel** (el panel como informe guardable) · las secciones EU AI Act y el chip **Obligations implemented** en las tarjetas · cuatro plantillas de encuesta · el libro de Excel del registro y los documentos Word Annex IV / FRIA |

También enriquece la normativa **EU AI Act** del
[escáner de cumplimiento](../guide/compliance.md) del núcleo, cuyos hallazgos de IA
alimentan las [Sugerencias](#sugerencias).

## Primeros pasos

1. **Abra EU AI Act → Settings.** Revise la **Taxonomy baseline**, defina una
   **Reference date** si los plazos deben evaluarse respecto a una fecha distinta
   de hoy y, opcionalmente, cargue los datos de demostración.
2. **Encuentre los sistemas de IA que ya tiene.** En **Suggestions**, pulse **Find
   suggestions** y acepte los sistemas y modelos que pertenezcan al ámbito.
3. **Clasifique cada sistema** en **Classify** y acepte el resultado sobre su
   tarjeta.
4. **Siga las obligaciones** en **Obligations**, registrando cada estado en la
   tarjeta.
5. **Congele una instantánea** en **Audit** y descargue el libro del registro, y
   los documentos Annex IV y FRIA desde el **Register**.

!!! tip "Recoja los datos de quienes los poseen"
    Cuatro plantillas de encuesta en **Administración → Encuestas → Nuevo desde
    plantilla** recogen los campos del AI Act de los propietarios de las tarjetas:
    **AI system intake (EU AI Act)**, **Provider obligations check (EU AI Act)**,
    **Deployer obligations check (EU AI Act)** y **GPAI model check (EU AI Act)**.
    Cada una se abre como borrador, dirigida a las partes interesadas responsables
    de las tarjetas.

## El espacio de trabajo

**Reglamento de IA de la UE** en el menú **GRC** tiene siete pestañas: **Dashboard**,
**Register**, **Classify**, **Obligations**, **Suggestions**, **Audit** y
**Settings**. Cada lista es una cuadrícula de Turbo EA con la misma barra lateral
que el Inventario — una pestaña **Filters** (búsqueda en todas las columnas, más
facetas como nivel de riesgo, rol, estado, gravedad o plazo) y una pestaña
**Columns** (mostrar, ocultar e inmovilizar columnas, recordado por cuadrícula).
Una fila que nombra una tarjeta la abre en el panel de tarjeta.

### Panel

Cinco mosaicos — **AI systems in scope**, **High-risk**, **Unclassified**, **GPAI
models** y **Overdue obligations** — que abren cada uno las filas detrás de su
cifra, y una línea **Validation** con los hallazgos bloqueantes y las
advertencias, y un enlace **Open audit**. Debajo:

- **Risk-tier distribution** sobre los sistemas dentro del ámbito.
- **Compliance quadrant** — cada sistema situado según la exposición regulatoria
  (las obligaciones aplicables) frente a **Obligations implemented**, en cuatro
  zonas: **Act now**, **On track**, **Monitor** y **Comfortable**. Los sistemas en
  la misma posición comparten un disco que indica cuántos hay. Los sistemas sin
  porcentaje no se representan; una línea bajo el gráfico los cuenta.
- **Ranked by urgency** — los mismos sistemas como lista, con una columna para cada
  medida. Al pulsar un sistema se abre su **cuadro de estado**: las dos medidas con
  su desglose, los datos de clasificación que aún faltan y las obligaciones
  abiertas con estado y fecha límite, con **Open card** y **Show in Obligations**.
- **Applicability timeline (Art. 113)** — los hitos de la tabla de
  [Obligaciones](#obligaciones), cada uno marcado como en vigor o en cuenta atrás.

![El panel de EU AI Act](../assets/img/en/104_ext_eu_ai_act_dashboard.png)

### Registro

Dos vistas — **AI systems** y **GPAI models** — cada una una cuadrícula de las
tarjetas del registro. Para un sistema muestra el nivel de riesgo, el rol, la base
de clasificación, **Obligations implemented** (un clic abre las obligaciones
abiertas de ese sistema) y el número de vencidas; para un modelo, su origen,
riesgo sistémico, capacidad de cómputo de entrenamiento y los sistemas que lo
usan. **New AI system** y **New GPAI model** crean una tarjeta del tipo correcto
con el interruptor preconfigurado, y **Open in inventory** lista las mismas
tarjetas en el Inventario. Una fila del registro *es* su tarjeta: púlsela para
editar las secciones del AI Act en el detalle de la tarjeta.

La columna **Documents** de la vista AI systems ofrece dos descargas Word por
sistema, rellenadas de antemano desde el repositorio: **Annex IV.docx**, la
documentación técnica del anexo IV, y **FRIA.docx**, el esqueleto de la evaluación
de impacto en los derechos fundamentales del Art. 27. Ambos empiezan con una nota
sobre el formulario simplificado del anexo IV para pymes y pequeñas empresas de
mediana capitalización (Art. 11(1)) y sobre la reutilización de la evaluación de
impacto relativa a la protección de datos (Art. 27(4)).

### Classify

El asistente de clasificación hace un conjunto guiado de preguntas sobre un sistema
y propone un nivel de riesgo, con el artículo detrás de cada motivo. Elija el
sistema en **Classify a system** y responda:

1. **AI system or not** — ¿es un sistema de IA en el sentido del Art. 3(1)? Si no,
   el resultado es **Out of scope**.
2. **Role** — el rol de operador de su organización para este sistema, y si lo ha
   modificado sustancialmente, lo ha puesto con su marca o ha cambiado su finalidad
   prevista (lo que puede convertirle en su proveedor según el Art. 25).
3. **Prohibited practices (Art. 5)** — incluidas las dos prácticas que el
   Reglamento (UE) 2026/1744 prohíbe desde el 2 de diciembre de 2026: material
   íntimo o sexualmente explícito realista de una persona identificable sin su
   consentimiento (Art. 5(1)(ba)) y material de abuso sexual infantil
   (Art. 5(1)(bb)). Cada una indica quién está afectado, como proveedor o como
   responsable del despliegue. A un proveedor de un sistema que genera imágenes,
   vídeo, audio o texto también se le pregunta si el sistema podría producir ese
   material y si unas salvaguardas lo impiden de forma fiable; solo la respuesta de
   que esas salvaguardas no existen lo convierte en una práctica prohibida.
4. **High risk under Annex I** — un producto, o el componente de seguridad de un
   producto, conforme a la legislación de la Unión enumerada. Tras un régimen, el
   asistente pregunta si un motivo del Art. 6(1a)–(1c) saca al sistema del
   Art. 6(1): se usa únicamente para aspectos no relacionados con la seguridad, o el
   producto es evaluado por un tercero solo por riesgos distintos de la salud y la
   seguridad.
5. **High risk under Annex III** — si la finalidad prevista corresponde a un caso de
   uso del anexo III, y si el sistema elabora perfiles de personas físicas.
6. **The Art. 6(3) derogation** — si se aplica una condición de excepción. Una
   excepción invocada debe documentarse en **Art. 6(4) rationale**; ese texto se
   escribe en la tarjeta, y la validación bloquea sin él.
7. **Transparency duties (Art. 50)** — información sobre chatbots, marcado de
   contenido sintético, avisos de reconocimiento de emociones, etiquetado de
   deepfakes y de textos de interés público.

**Evaluate** muestra la **Proposed classification** con sus motivos respaldados por
artículos, y no escribe nada en la tarjeta. **Accept & write to card** escribe los
campos de clasificación en la tarjeta — rol, nivel de riesgo, base, excepción y
deberes de transparencia — y registra la evaluación como la aceptada.

Ejecutar el asistente requiere el permiso de gestión de la extensión y una tarjeta
que usted pueda abrir; aceptar requiere además derechos de edición sobre esa
tarjeta. Si puede abrir la tarjeta pero no editarla, aún puede ejecutar el asistente
y ver la propuesta, pero **Accept & write to card** aparece atenuado e indica el
motivo: *You may not edit this card, so the classification cannot be written to it.*

![El asistente de clasificación con una clasificación propuesta](../assets/img/en/105_ext_eu_ai_act_classify.png)

**El historial de evaluaciones es la pista de auditoría.** Cada ejecución se
conserva — quién clasificó qué sistema, cuándo y por qué — de modo que la pregunta
*«¿por qué este sistema es de alto riesgo y quién lo decidió?»* siga siendo
respondible años después. Cada fila nombra la tarjeta (una tarjeta archivada se
marca como **archived**, una tarjeta que ya no existe indica **Deleted card**), la
persona que la ejecutó en **By**, el nivel de riesgo y el estado: **Draft**,
**Accepted** o **Superseded**. Volver a ejecutar el asistente añade una entrada
nueva; aceptarla marca la aceptada anteriormente como **Superseded** y nunca la
modifica. Los detalles de una evaluación muestran **Run by**, **Accepted by** y,
cuando una posterior la sustituyó, **Superseded by** con la fecha — una entrada
sustituida conserva quién la aceptó. En las entradas sustituidas antes de la versión
1.6.0 solo se conoce a la persona que las sustituyó, por lo que **Accepted by**
muestra «—». El historial solo lista evaluaciones de tarjetas que usted puede abrir.
La columna **Taxonomy baseline** está oculta por defecto; actívela en **Columns**.

### Obligaciones

Cada obligación aplicable de cada sistema de IA — o, al cambiar a **GPAI model**, de
cada modelo GPAI — en una sola cuadrícula: la tarjeta, el grupo, la obligación, el
artículo, el estado, la fecha límite, el hito y un **Evidence hint** que indica qué
prueba espera la obligación. Filtre por estado, grupo y plazo (vencida, **Due
soon**, **Later**), o elija una única tarjeta en la barra de herramientas. Los
estados son campos de tarjeta, así que se registran abriendo la tarjeta; una
obligación no cumplida a su fecha está vencida, y una aún no vencida muestra **Due
soon** desde 180 días antes de su fecha.

Qué obligaciones se aplican depende del rol, el nivel de riesgo y las condiciones
de cada sistema — 32 obligaciones en total para proveedores, responsables del
despliegue y modelos GPAI, sobre la base modificada. Sus fechas están escalonadas
según las modifica el Reglamento (UE) 2026/1744:

| Fecha | Hito | Artículo |
|---|---|---|
| 2 de febrero de 2025 | Prácticas prohibidas y alfabetización en IA | Art. 113(a) |
| 2 de agosto de 2025 | Obligaciones de los modelos de IA de uso general | Art. 113(b) |
| 2 de agosto de 2026 | Aplicación general (incl. transparencia del Art. 50) | Art. 113 |
| 2 de diciembre de 2026 | Otras prácticas prohibidas (Art. 5(1)(ba), (bb)) | Art. 113(a) |
| 2 de diciembre de 2027 | Sistemas de IA de alto riesgo del anexo III | Art. 113(c)(i) |
| 2 de agosto de 2028 | IA de alto riesgo en productos regulados del anexo I | Art. 113(c)(ii) |
| 2 de agosto de 2030 | IA de alto riesgo ya comercializada, destinada a autoridades públicas | Art. 111(2) |

Los plazos se evalúan respecto a la **Reference date** de Settings (hoy cuando está
vacía). Tres reglas dan forma a la lista:

- **Anexo I sección B (Art. 2(2)).** Un sistema que es de alto riesgo solo a través
  de un producto cubierto por el anexo I sección B — vehículos, aviación, equipos
  marinos, ferrocarril y maquinaria — no tiene ninguna obligación del AI Act en el
  registro e indica **No obligations apply**. Los estados ya registrados permanecen
  en la tarjeta, sin contarse. Un sistema que además entra en un caso de uso del
  anexo III conserva todas sus obligaciones.
- **Sistemas ya comercializados (Art. 111(2)).** Registre en la tarjeta de un
  sistema de alto riesgo si fue *Placed on the market before the high-risk date
  (Art. 111(2))*. Comercializado antes de esa fecha sin cambio significativo de su
  diseño: las obligaciones de alto riesgo se apartan (la transparencia del Art. 50
  sigue contando); comercializado antes de esa fecha y destinado a ser usado por
  autoridades públicas: se trasladan al 2 de agosto de 2030; modificado de forma
  significativa, no comercializado antes de esa fecha o dejado vacío: se aplican
  íntegramente.
- **Registrar un sistema exceptuado (Art. 49(2)).** Un proveedor que invoca la
  excepción del Art. 6(3) tiene una obligación más: registrar el sistema en la base
  de datos de la UE como evaluado como no de alto riesgo.

![La pestaña Obligations de todos los sistemas de IA](../assets/img/en/106_ext_eu_ai_act_obligations.png)

### Sugerencias

**Find suggestions** recorre sus tarjetas y propone decisiones de registro, cada una
con su evidencia:

- **AI Act scope** — una Aplicación sobre la que aún no se ha decidido, con uno de
  los subtipos de IA del núcleo (**AI Agent**, **MCP Server**) o señalada por el
  escáner de cumplimiento como con funciones de IA.
- **GPAI check** — un Componente de TI sobre el que aún no se ha decidido, con el
  subtipo **AI Model**, una señal del escáner, o usado por sistemas ya dentro del
  ámbito.
- **Bootstrap checklist** — un sistema de alto riesgo en el que ninguna de sus
  obligaciones aplicables tiene aún un estado; aceptarla pone cada una en **Not
  started**, para que el trabajo se haga visible.

Una franja sobre la lista enlaza los hallazgos de EU AI Act del propio escáner de
cumplimiento.

No se escribe nada en una tarjeta hasta que una persona pulsa **Accept** en una
fila; **Dismiss** la quita de la lista. El estado — **Proposed**, **Accepted** o
**Dismissed** — se elige en la barra lateral. Aceptar requiere derechos de edición
sobre la tarjeta además del permiso de gestión; sin ellos **Accept** aparece
atenuado e indica: *You may not edit this card, so the suggestion cannot be written
to it.*

### Audit

- **Live validation** — los hallazgos del registro tal como está en la fecha de
  referencia, cada uno con su gravedad (**Blocking** o **Warning**), regla,
  artículo, tarjeta y mensaje; **Open card** abre la tarjeta que hay que corregir.
- **Rule coverage** — las reglas que una máquina no puede comprobar. Se informan
  como no ejecutadas, porque necesitan a una persona, en lugar de omitirse en
  silencio.
- **Snapshots** — **Freeze snapshot** captura el registro en una **Reference date**.
  Cada instantánea pasa entonces por tres estados:
    1. **Draft** — pulse **Validate** para comprobarla.
    2. **Validated** — pulse **Finalize**. Se rechaza mientras quede algún hallazgo
       bloqueante.
    3. **Final** — la instantánea es inmutable, forma parte de la pista de
       auditoría y ya no puede validarse de nuevo ni eliminarse.

  **XLSX** descarga una instantánea como libro de Excel del registro (requiere el
  permiso de envío). Una instantánea final siempre se descarga sin cambios: su
  contenido se comprueba contra el hash fijado al finalizarla. Una instantánea en
  borrador conserva las fechas y los hallazgos con los que se tomó — tome una nueva
  tras una actualización que cambie las reglas.

### Ajustes

**Taxonomy baseline** — la normativa de la que derivan todas las proyecciones y
plazos. **ai-act-2026-omnibus**, el reglamento modificado por el Reglamento (UE)
2026/1744, es el valor por defecto; **ai-act-2024**, el reglamento tal como se
adoptó con sus fechas originales, sigue siendo seleccionable para que las
evaluaciones e instantáneas tomadas con él sigan siendo legibles.

**Reference date** — los plazos se evalúan respecto a esta fecha; vacío significa
hoy.

**Demo data** — **Load demo data** siembra un pequeño panorama de demostración:
todos los niveles de riesgo, un modelo GPAI de riesgo sistémico, una pista de
evaluaciones aceptadas y material para sugerencias. Todas las tarjetas de demo
llevan *(AI demo)* en su nombre; **Remove demo data** las elimina de nuevo.

## Quién ve y puede hacer qué

- **Solo ve los sistemas cuyas tarjetas puede abrir.** El registro, las
  obligaciones, las cifras y la cronología del panel, los hallazgos, las
  sugerencias, el historial de evaluaciones y los documentos Annex IV / FRIA
  muestran a una persona solo los sistemas cuyas tarjetas puede abrir en el
  Inventario, y cada cifra — recuentos, porcentajes, elementos vencidos, hallazgos
  bloqueantes — se calcula sobre lo que puede ver. Una tarjeta a la que remite un
  sistema visible pero que usted no puede abrir indica **Card not accessible**.
  Donde se ha omitido algo, el panel y el Registro lo dicen en una línea: *Some
  systems are not shown because you do not have access to their cards.* Donde no
  queda nada que mostrar, el panel y la pestaña Obligations muestran la misma línea
  en lugar de una lista vacía. Un rol que solo tiene el permiso de la extensión y
  ningún acceso a las tarjetas no ve, por tanto, ningún sistema.
- **Las instantáneas cubren todo el registro.** Las instantáneas y sus descargas de
  Excel son el registro oficial: contienen todos los sistemas y nunca se filtran,
  quienquiera que mire. Todas las personas con el permiso de visualización ven la
  lista de instantáneas en la pestaña Audit; descargar una requiere el permiso de
  envío. A través de la API, el contenido almacenado de una instantánea se devuelve
  a quienes tienen el permiso de envío y a quienes el registro no les oculta nada;
  los demás reciben solo su fecha, base de referencia y estado.
- **Aceptar requiere dos derechos.** **Accept & write to card**, y aceptar una
  sugerencia, requieren el permiso `ext.eu-ai-act.manage` de la extensión **y**
  derechos de edición sobre la tarjeta. Quien puede abrir la tarjeta pero no
  editarla aún puede ejecutar el asistente y ver la propuesta; el botón aparece
  atenuado con su motivo y no se escribe nada. Para permitirle aceptar, dé a su rol
  derechos de edición sobre el tipo de tarjeta, o conviértalo en parte interesada de
  la tarjeta con un rol que pueda editar. Ejecutar el asistente, o aceptar o
  descartar una sugerencia, en una tarjeta que no puede abrir se rechaza.
- **El historial de la tarjeta nombra a quien aceptó.** En Turbo EA 2.209.0 y
  posteriores, un cambio hecho por **Accept & write to card** o por una sugerencia
  aceptada se registra en la pestaña Historial de la tarjeta con el nombre de la
  persona que lo hizo, con el chip **Extension**. Las versiones anteriores muestran
  **System**. Cargar o eliminar los datos de demo se registra como la extensión.
- **El historial de evaluaciones muestra solo nombres para mostrar** — nunca un
  correo electrónico. Donde no se pueden leer los nombres, muestra «—».

## Permisos

| Permiso | Concede |
|---|---|
| `ext.eu-ai-act.view` | Ver el registro de sistemas de IA, los paneles y los resultados de validación |
| `ext.eu-ai-act.manage` | Ejecutar clasificaciones, editar datos del AI Act y decidir sobre sugerencias |
| `ext.eu-ai-act.submit` | Congelar instantáneas del registro y descargar exportaciones del registro |
| `ext.eu-ai-act.admin` | Configurar los ajustes del AI Act (versión de la taxonomía, fecha de referencia, datos de demo) |

Editar los propios datos del registro también usa sus derechos normales de edición
de tarjetas, ya que cada campo del AI Act vive en una tarjeta.

## Si la licencia caduca o la extensión se desactiva

El espacio de trabajo y su informe desaparecen, pero **no se elimina nada**. Sus
datos del AI Act viven en tarjetas ordinarias, de modo que cada valor permanece
exactamente donde está, visible y editable en el inventario. Aplicar una licencia
renovada restablece el espacio de trabajo de inmediato.

## Notas y limitaciones

- La validación cubre lo que una máquina puede comprobar. Las reglas que no puede
  comprobar figuran en **Rule coverage** como no ejecutadas; trate una validación
  limpia como una lista de comprobación, no como un veredicto de conformidad.
- Los campos de tarjeta son compartidos por ambas bases de referencia, y una tarjeta
  no puede saber cuál está seleccionada. Con **ai-act-2024**, una tarjeta de alto
  riesgo con un régimen del anexo I sección B oculta estados de obligación que esa
  base aún cuenta, y el campo del Art. 111(2) se muestra aunque esa base lo ignora.
  El registro, el panel y las exportaciones siguen siempre la base de referencia
  seleccionada.
- Las opciones de respuesta del asistente se muestran en su idioma cuando la base de
  referencia ofrece una traducción.
- Tras actualizar desde una versión anterior, vuelva a ejecutar el asistente para la
  IA en productos regulados (los motivos del anexo I) y para los sistemas
  generadores de contenido (la pregunta de las salvaguardas), y registre el estado
  del Art. 111(2) de los sistemas de alto riesgo ya comercializados.
