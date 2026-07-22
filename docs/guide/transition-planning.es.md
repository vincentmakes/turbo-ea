# Planificación de transición

La planificación de transición es una herramienta manual de planificación en **EA Delivery** para modelar cambios en su panorama — reemplazar una aplicación por otra para una organización determinada, retirar un sistema heredado o introducir una nueva plataforma — y comunicarlos como un **único diagrama antes/después**. Ofrece un resultado similar al TurboLens Architect, pero sin ninguna IA: usted mantiene el control total de cada cambio propuesto.

El resultado es una Layered Dependency View que muestra el estado actual y el planificado en una sola imagen, con indicadores de cambio:

- **Cruz roja** — una tarjeta o relación marcada para eliminación
- **Más verde** — una tarjeta o relación recién añadida
- **Flechas de intercambio azules** — un reemplazo: la tarjeta sucesora y las conexiones que hereda

!!! info "Disponibilidad"
    La creación, edición y confirmación de planes de transición se desbloquea mediante una extensión instalada y con licencia (véase **Admin → Extensiones**). Ver los planes existentes siempre está disponible: si la extensión se elimina o su licencia caduca, los planes siguen siendo legibles y no se borra nada.

## Crear un plan

Abra **EA Delivery** y use **Añadir → Nuevo plan de transición** en una iniciativa (o cree un plan sin vincular y adjúntelo más tarde). Un plan se construye en cuatro pasos:

1. **Objetivos de negocio** *(opcional)* — nombre las tarjetas Objetivo que respalda este cambio. Aparecen en la capa de Estrategia del diagrama, de modo que cada interesado ve el *porqué* junto al *qué*, y rellenan previamente los enlaces de la iniciativa al confirmar el plan.
2. **Alcance y línea base** — elija una o más tarjetas de alcance (una organización, una capacidad de negocio, aplicaciones individuales, …) y una profundidad de dependencias (1–3). **Capturar línea base** toma una instantánea del panorama circundante como imagen «antes». La instantánea mantiene el diagrama estable aunque el inventario cambie; use **Actualizar línea base** para recapturarla más tarde — cualquier cambio planificado cuyo destino haya desaparecido queda señalado.
3. **Cambios planificados** — aplique operaciones de cambio desde la caja de herramientas:
    - **Añadir tarjeta** — traiga una tarjeta existente a la imagen, o proponga una completamente nueva (nombre + tipo).
    - **Quitar tarjeta** — marque una tarjeta para su retirada. Sus conexiones se vuelven rojas.
    - **Reemplazar tarjeta** — elija la tarjeta a reemplazar y su sucesora (existente o propuesta). La sucesora hereda las relaciones de la predecesora, mostradas como aristas de intercambio azules; corte relaciones heredadas individuales con **Quitar relación**.
    - **Añadir / quitar relación** — trace nuevas conexiones o corte las existentes. Los tipos de relación se validan contra el metamodelo.
4. **Vista previa en vivo** — el diagrama antes/después fusionado se actualiza mientras planifica. Guarde el plan en cualquier momento; aparece en la sección **Entregables** de la iniciativa.

## Entender las consecuencias

La planificación de transición es más que un editor de diagramas: mientras planifica, un panel de **Consecuencias** hace visible el impacto arquitectónico. Las mismas cifras aparecen en la vista previa compartible y se integran en el ADR confirmado:

- **Análisis de brechas** — un resumen estilo TOGAF Añadido / Eliminado / Modificado / Conservado.
- **Impacto / radio de afectación** — quitar o reemplazar una tarjeta muestra qué depende de ella («*N aplicaciones, M interfaces dependen de esto*»), a partir del análisis de impacto de la tarjeta.
- **Brechas de cobertura de capacidades** — si una capacidad de negocio pierde *todas* sus aplicaciones de soporte en el estado objetivo, se señala.
- **Diferencias de coste y riesgo** — el coste anual estimado antes → después (con la diferencia) y el número de riesgos abiertos en las tarjetas afectadas. Las tarjetas propuestas aportan su coste estimado, que también se escribe en la tarjeta creada al confirmar.

## Confirmar un plan

Un plan en borrador puede **confirmarse** (requiere el permiso *Confirmar planes de transición*). La confirmación:

- crea una tarjeta **Iniciativa** (con el nombre y las fechas de inicio/fin elegidos) vinculada a los objetivos respaldados,
- crea las **tarjetas propuestas** y **relaciones** seleccionadas, vinculando cada tarjeta nueva a la iniciativa,
- estampa una fecha de **fin de vida** (la fecha de fin de la iniciativa) en las tarjetas retiradas y reemplazadas, para que los informes de ciclo de vida y las hojas de ruta reflejen el plan,
- opcionalmente crea un **borrador de Architecture Decision Record** que documenta cada cambio — incluidas las relaciones cortadas, que solo se documentan y nunca se eliminan.

!!! note
    La confirmación nunca archiva ni elimina nada. Las tarjetas retiradas reciben una fecha de fin de vida; su retirada real sigue siendo un paso humano deliberado a través de los flujos normales del inventario.

Tras la confirmación, el plan pasa a ser de solo lectura y enlaza con la iniciativa creada.

## Permisos

| Permiso | Concede |
|---------|---------|
| `transition_plans.view` | Ver planes de transición |
| `transition_plans.manage` | Crear, editar y eliminar planes |
| `transition_plans.commit` | Confirmar un plan (crear la iniciativa, tarjetas, relaciones, borrador de ADR, estampar fechas de fin de vida) |

Los miembros pueden ver, gestionar y confirmar planes de forma predeterminada; los observadores solo pueden verlos.
