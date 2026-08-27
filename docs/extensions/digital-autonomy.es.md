# Digital Autonomy Assessment

**Digital Autonomy Assessment** incorpora a Turbo EA el **Digital Autonomy
Assessment Framework (DAAF)** de la Universidad de Utrecht, a nivel de
aplicación. Añade una sección **Autonomía digital** a cada tarjeta de Aplicación
— 22 indicadores ponderados repartidos entre exposición al riesgo, capacidad de
mitigación e importancia estratégica, cada uno puntuado de 1 a 5 según la rúbrica
original del DAAF y con ayuda contextual —, calcula automáticamente una
puntuación de autonomía de 1 a 10 y sitúa toda su cartera en un **cuadrante de
autonomía**.

Responde a una pregunta que la mayoría de los inventarios deja abierta: *si este
proveedor dejara mañana de estar disponible, de ser asequible o de poder usarse
legalmente, ¿cuánto nos afectaría y qué podríamos hacer realmente?*

## De un vistazo

| | |
|---|---|
| **Licencia** | **Gratuita** — funciona sin ningún derecho de licencia |
| **Versión mínima de Turbo EA** | 2.17.0 |
| **Permiso** | `ext.digital-autonomy.view` |
| **Permisos de acceso a datos** | ninguno |
| **Requiere reiniciar el backend** | no |
| **Dónde aparece** | Secciones **Autonomía digital** y **Puntuación de autonomía digital** en las tarjetas de Aplicación · **Informes → Autonomía digital** · **Nuevo desde plantilla** en la página de encuestas |

## Primeros pasos

1. Instale la extensión desde **Admin → Extensiones**. No hay licencia que aplicar
   ni reinicio: los campos aparecen de inmediato.
2. Conceda `ext.digital-autonomy.view` en **Admin → Usuarios y roles** a los roles
   que deban ver el informe. Los administradores ya lo tienen.
3. Decida si quiere la evaluación **rápida** o la **completa** — véase
   [Evaluación rápida o completa](#evaluacion-rapida-o-completa). La versión
   completa de 22 indicadores viene activada de fábrica.
4. Puntúe sus aplicaciones, tarjeta a tarjeta o
   [mediante encuesta](#recoger-puntuaciones-mediante-encuestas).

## Los indicadores

La sección **Autonomía digital** aparece en cada tarjeta de Aplicación, agrupada
en ocho dimensiones (A–H). Cada indicador se puntúa de **1 a 5** con su propia
rúbrica.

![La sección «Autonomía digital» en una tarjeta de Aplicación](../assets/img/en/65_ext_digital_autonomy_indicators.png)

Pulse un número para puntuar; vuelva a pulsar el número seleccionado para borrar
la puntuación. Al pasar el ratón sobre un número se muestra el texto de la
rúbrica para ese nivel, y cada indicador incluye una **ayuda** desplegable con la
nota explicativa del DAAF y las definiciones de los términos que emplea
(*decisión de adecuación*, *CLOUD Act*, *FISA 702*, entre otros).

Los indicadores marcados como **Rápido** componen la evaluación rápida.

| Dimensión | Indicador | Peso | Rápido |
|---|---|---|---|
| **A · Riesgo geopolítico y de cumplimiento legal** | A1 · Jurisdicción del proveedor | 3 | ✔ |
| | A2 · Sanciones y riesgo geopolítico | 2 | |
| | A3 · Alojamiento y ubicación de los datos | 2 | ✔ |
| **B · Dependencias de proveedor y cadena de suministro** | B1 · Concentración de proveedores | 3 | ✔ |
| **C · Resiliencia técnica** | C1 · Alternativa disponible | 3 | ✔ |
| | C2 · Migrabilidad | 3 | |
| | C3 · Portabilidad de los datos | 3 | |
| | C4 · Gestión del cifrado | 2 | |
| | C5 · Transparencia y apertura del software | 3 | |
| **D · Resiliencia organizativa** | D1 · Experiencia interna y continuidad del conocimiento | 3 | ✔ |
| | D2 · Plan de salida establecido | 3 | |
| | D3 · Estrategia de copias de seguridad | 2 | |
| **E · Resiliencia contractual** | E1 · Cláusulas de salida y acuerdo de transición | 3 | ✔ |
| | E2 · Flexibilidad contractual | 2 | |
| **F · Importancia organizativa** | F1 · Impacto de una interrupción | 3 | ✔ |
| | F2 · Dependencias de integración | 2 | |
| **G · Sensibilidad de los datos, gestión de accesos y política** | G1 · Datos personales | 3 | ✔ |
| | G2 · Datos de investigación y seguridad del conocimiento | 3 | |
| | G3 · Propiedad intelectual | 2 | |
| **H · Impacto académico** | H1 · Libertad académica | 3 | ✔ |
| | H2 · Colaboración en investigación | 2 | |
| | H3 · Archivo a largo plazo | 2 | |

!!! note "¿Qué dirección es la buena?"
    Las rúbricas no están todas orientadas igual, y el control las colorea en
    consecuencia. En los indicadores de **riesgo** (A, B, F, G, H) **1 es lo
    mejor** — por ejemplo, el nivel 1 de A1 es «Jurisdicción UE/EEE. Sin
    reclamaciones extraterritoriales. Protección plena de la UE.» y el nivel 5
    «Sin decisión de adecuación ni garantías. Acceso directo por parte de
    gobiernos extranjeros.» En los indicadores de **capacidad** (C, D, E) **5 es
    lo mejor**. No hace falta recordarlo: los botones están graduados por color y
    llevan las leyendas **Bajo** y **Alto**.

## La puntuación

La sección de solo lectura **Puntuación de autonomía digital** está bajo los
indicadores y se recalcula automáticamente cada vez que guarda.

![La puntuación de autonomía digital calculada en una tarjeta de Aplicación](../assets/img/en/64_ext_digital_autonomy_score.png)

| Campo | Significado |
|---|---|
| **Exposición al riesgo** | Media ponderada de las dimensiones A (geopolítica) y B (concentración de proveedores) |
| **Capacidad de mitigación** | Media ponderada de la resiliencia técnica (C), organizativa (D) y contractual (E) |
| **Importancia estratégica** | Media ponderada de F (importancia organizativa), G (sensibilidad de los datos) y H (impacto académico) |
| **Puntuación de autonomía** | Una cifra única de 1 a 10, mostrada como indicador |

**Cuanto más alto, mejor** — 10 es óptimo, 1 es urgente.

!!! warning "Una evaluación parcial no produce ninguna puntuación"
    Todas las fórmulas están protegidas: si falta aunque sea un indicador
    necesario, la puntuación queda vacía en lugar de mostrar una cifra engañosa.
    Una aplicación solo aparece en el informe de cuadrante cuando su evaluación
    está completa.

Como las puntuaciones se guardan en la tarjeta igual que cualquier otro campo,
están disponibles en todas partes: el inventario, los filtros, las exportaciones y
sus propios informes.

## Evaluación rápida o completa

La extensión incluye **dos variantes de los mismos cuatro cálculos**: una lee los
22 indicadores y otra solo los nueve de la evaluación rápida. El par que esté
**activo** determina tanto lo que se calcula *como* cuántos indicadores muestra la
tarjeta.

Cambie de modo en **Admin → Metamodelo → Cálculos**:

- **Evaluación completa (predeterminada)** — las cuatro filas
  *Digital Autonomy — … (full)* están activas y las *(quick)* inactivas. Las
  tarjetas muestran los 22 indicadores.
- **Evaluación rápida** — active las cuatro filas *Digital Autonomy — … (quick)* y
  desactive las cuatro *(full)*. Las tarjetas muestran solo los nueve indicadores
  rápidos y la puntuación se calcula a partir de ellos.

!!! tip "No hay un interruptor de visualización aparte"
    Esta única decisión en los cálculos constituye todo el conmutador. La tarjeta
    oculta automáticamente los 13 indicadores exclusivos de la evaluación completa
    en cuanto el conjunto rápido está activo, y el informe sigue la misma
    configuración. No active nunca ambas variantes a la vez: escriben en los
    mismos campos.

## Recoger puntuaciones mediante encuestas

En lugar de rellenar 22 indicadores para cada aplicación usted mismo, pregunte a
quienes lo saben. En **Admin → Encuestas**, use **Nuevo desde plantilla**:

- **New DAAF survey — Quick (9)** crea el borrador *DAAF Quick Scan*.
- **New DAAF survey — Full (22)** crea el borrador *DAAF Full Assessment*.

Ambas apuntan a tarjetas de Aplicación y se abren como **borrador** en el editor
de encuestas, de modo que no se envía nada hasta que usted lo revise. Elija el rol
de parte interesada que debe recibirla (y los filtros que quiera — una fase del
ciclo de vida, un subtipo) y envíela. Quienes respondan verán el mismo control de
puntuación 1–5 y la misma ayuda contextual que en la tarjeta; al aplicar las
respuestas, las puntuaciones se escriben en las tarjetas.

Puede generar una encuesta nueva desde una plantilla tantas veces como quiera: una
reevaluación anual es solo un clic.

## El informe de cuadrante de autonomía

**Informes → Autonomía digital** representa cada aplicación completamente
evaluada.

![El informe «Cuadrante de autonomía»](../assets/img/en/63_ext_digital_autonomy_quadrant.png)

El eje horizontal es **riesgo × importancia estratégica** y el vertical la
**capacidad de mitigación** (alta arriba), lo que da cuatro cuadrantes:

| Cuadrante | Qué significa | Qué hacer |
|---|---|---|
| **Óptimo** | Poca exposición, mitigación sólida | Mantener y supervisar periódicamente. |
| **Manejable** | Mucha exposición, pero con un plan de respaldo sólido | Riesgos aceptados con un respaldo sólido. |
| **Atención** | Poca exposición, mitigación débil | Construir mitigación o aceptar el riesgo deliberadamente. |
| **Crítico** | Mucha exposición, mitigación débil | Acción urgente: migrar o mitigar. |

Cada punto está numerado y se corresponde con una fila de la lista contigua al
gráfico, **ordenada por puntuación ascendente: primero los más urgentes**. Al
pulsar un punto o una fila se abre la aplicación en un panel lateral sin salir del
informe.

**Filtros y ejes**

- Los selectores **Exposición al riesgo**, **Capacidad de mitigación** e
  **Importancia estratégica** permiten situar otros campos numéricos en cada eje,
  útil si mantiene sus propios equivalentes. Su elección se recuerda en el
  navegador.
- **Ciclo de vida** y **Subtipo** acotan el conjunto.

El informe se guarda, comparte, imprime y exporta como de costumbre. Una vista
guardada aparece en **Informes → Guardados**.

## Permisos

| Permiso | Permite |
|---|---|
| `ext.digital-autonomy.view` | Ver el informe **Informes → Autonomía digital** |

Puntuar los indicadores utiliza sus derechos normales de **edición** de tarjetas
de Aplicación: quien pueda editar una aplicación puede puntuarla. Cambiar entre
evaluación rápida y completa, así como crear encuestas desde las plantillas,
requiere los permisos de administrador habituales de **Cálculos** y **Encuestas**.

## Si la extensión se desactiva o se elimina

Al desactivarla o desinstalarla se retiran las dos secciones del tipo de tarjeta,
pero **nunca se tocan los valores guardados en sus tarjetas**. Vuelva a activar la
extensión y todas las puntuaciones reaparecen exactamente igual. Los campos se
fusionan de forma aditiva, de modo que también se conservan los campos que sus
administradores hayan añadido por su cuenta a esas secciones.

## Idiomas

Las etiquetas de los indicadores, las preguntas, las rúbricas y la ayuda están
disponibles en **inglés, alemán, francés, español, italiano y danés**. En
portugués, chino, ruso y árabe el contenido del marco recurre al inglés: el marco
original no ofrece esos idiomas.

## Atribución y licencia

Esta extensión reproduce el **Digital Autonomy Assessment Framework (DAAF)**,
creado en la **Universidad de Utrecht** por **Tim van Neerbos** (Lead Enterprise
Architect) como parte del proyecto Digital Autonomy.

- Fuente: <https://github.com/utrechtuniversity/digital-autonomy-assessment-tool>
- Herramienta original: <https://utrechtuniversity.github.io/digital-autonomy-assessment-tool/>
- Licencia: **Creative Commons Atribución-NoComercial-CompartirIgual 4.0
  Internacional (CC BY-NC-SA 4.0)** —
  <https://creativecommons.org/licenses/by-nc-sa/4.0/>
- © 2026 Universiteit Utrecht — Tim van Neerbos

**Se han realizado cambios.** Los indicadores, ponderaciones, rúbricas, notas de
ayuda y la puntuación de 1 a 10 del marco se adaptaron para funcionar de forma
nativa dentro de Turbo EA a nivel de tarjeta de Aplicación: un tipo de campo de
puntuación 1–5 propio, los cálculos de niveles y de puntuación, las plantillas de
encuesta y el informe de cuadrante de autonomía.

Las traducciones multilingües de las rúbricas y la ayuda proceden del proyecto
DAAF (elaboradas con la colaboración de **Thomas Steenbergen, SIVON**; el alemán,
el francés, el español, el italiano y el danés son, según la fuente, traducciones
realizadas con la mejor intención y todavía no revisadas por hablantes nativos).

Conforme a la cláusula **NoComercial** del marco, esta extensión se distribuye de
forma **gratuita**, y conforme a **CompartirIgual**, el contenido adaptado del
DAAF que incorpora sigue estando bajo licencia CC BY-NC-SA 4.0.
