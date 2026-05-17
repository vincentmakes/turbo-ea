# Planifique su despliegue

Antes de crear una sola ficha, dedique una hora a responder cuatro preguntas. Los equipos que omiten este paso terminan con un inventario en el que nadie confía, porque nadie acordó para qué era.

## 1. Defina un alcance limitado

El mayor error en los despliegues de EA es intentar modelar toda la empresa de una vez. Elija **uno** de los siguientes:

- Un **dominio de negocio** (p. ej., Ventas, Finanzas, Servicio al Cliente, Manufactura).
- Una **entidad legal** o **región** (una filial, un país, una unidad de negocio recientemente adquirida).
- Una **plataforma** (p. ej., el stack de comercio electrónico, la plataforma de datos, el conjunto ERP).

Un buen primer alcance contiene aproximadamente **50–200 aplicaciones**. Menos que eso y no hay nada que analizar; más que eso y se quedará sin energía antes de llegar al análisis.

!!! warning "No haga esto"
    No elija "toda la empresa" o "toda la TI". Pasará tres meses persiguiendo datos y nunca llegará a un informe funcional.

## 2. Elija el primer caso de uso adecuado

El caso de uso decide qué campos importan, qué interesados necesita y qué informe mostrará al final. El más común — y el que esta guía asume a partir de la página 3 — es:

> **Racionalización del portafolio de aplicaciones**
>
> Inventariar las aplicaciones en el alcance, clasificar cada una por valor de negocio y aptitud técnica, y decidir qué **T**olerar, **I**nvertir, **M**igrar o **E**liminar (el marco TIME).

Otros primeros casos de uso válidos — pero elija **uno**:

| Caso de uso | Qué poblará principalmente | Qué omitirá |
|-------------|----------------------------|-------------|
| **Racionalización del portafolio de aplicaciones** | Aplicaciones, costos, ciclo de vida, valor de negocio | Modelo de procesos detallado, interfaces |
| **Planificación basada en capacidades** | Capacidades de Negocio, Aplicaciones, mapa de calor de capacidades | Detalle de costos, stack tecnológico |
| **Evaluación de migración a la nube** | Aplicaciones, Componentes de TI, modelo de implementación | Valor de negocio, procesos |
| **Integración de M&A** | Ambos portafolios como Aplicaciones, análisis de solapamiento | Fechas de ciclo de vida a largo plazo |

Si no está seguro, **elija Racionalización del portafolio de aplicaciones**. Es el punto de partida más universalmente útil y el resto de esta guía está escrita en torno a él.

## 3. Identifique a sus interesados

Turbo EA tiene un modelo de **Interesados** integrado (vea [Detalles de la ficha](../guide/card-details.md)): cada ficha lleva una lista de personas en roles definidos (Propietario de Negocio, Propietario Técnico, etc.), definidos por tipo de ficha en el metamodelo. Decida desde el principio quién ocupa cada rol para una Aplicación:

- **Propietario de la Aplicación** — responsable de la aplicación en el negocio. Una persona por aplicación. Aprueba la disposición TIME.
- **Propietario Técnico** — responsable de mantenerla en funcionamiento. A menudo el gerente de ingeniería.
- **Arquitecto** — usted, probablemente. Actúa como revisor del lado de EA y aprueba las fichas.

No necesita asignar interesados el primer día para cada ficha, pero sí necesita saber quiénes *serán* — porque en la tercera semana les estará enviando encuestas para validar los datos.

!!! tip "Buena práctica"
    Un nombre real en el rol de Propietario de la Aplicación vale más que diez campos personalizados perfectamente completados. Si solo va a poblar un campo más allá del nombre y el ciclo de vida, que sea el Propietario de la Aplicación.

## 4. Establezca un objetivo realista de calidad de datos

Turbo EA calcula una puntuación de **Calidad de Datos** (0–100%) para cada ficha, basada en los campos ponderados definidos en el metamodelo. Es el mejor indicador adelantado de si su inventario es utilizable.

Objetivos realistas para los primeros 90 días:

| Fase | Calidad promedio de datos objetivo (Aplicaciones) | Qué se ha llenado |
|------|--------------------------------------------------|-------------------|
| Final de la semana 2 (Gatear) | **40–60%** | Nombre, Fase del ciclo de vida, Descripción, Propietario de Negocio |
| Final de la semana 6 (Caminar) | **60–75%** | + Mapeo de capacidades, Costo, disposición TIME |
| Final del mes 3 (Correr) | **75–90%** | + Stack tecnológico, interfaces, campos personalizados del dominio |

No empuje hacia el 100%. El último 10% cuesta más que el primer 60% y rara vez cambia una decisión.

## 5. Comprométase con un único entregable

Termine su sesión de planificación con una declaración escrita como:

> *"Para el final de la semana 6, el inventario del dominio de Ventas contendrá todas las aplicaciones con un costo anual > 50k€, cada una mapeada al menos a una Capacidad de Negocio y con una disposición TIME. Presentaremos el Informe de Portafolio al CIO de Ventas en la semana 7."*

Péguelo en una wiki, en una diapositiva de inicio, en la descripción de un canal de Slack — en algún lugar visible. Esa frase es lo que evita que el despliegue se desvíe al purgatorio de "todavía estamos recopilando datos".

Siguiente: [Comience con su inventario de aplicaciones](start-with-applications.md).
