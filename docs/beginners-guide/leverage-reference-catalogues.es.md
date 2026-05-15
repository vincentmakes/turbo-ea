# Aproveche los catálogos de referencia

El error clásico en esta etapa: pasar tres semanas en talleres elaborando un modelo de capacidades de negocio a medida, dos semanas más alineándolo con los ejecutivos, y luego descubrir que el modelo es 80% idéntico al que usa cualquier otra empresa de su industria.

**No modele desde cero.** Turbo EA incluye tres catálogos curados que le brindan un punto de partida probado en batalla que puede adaptar en días en lugar de meses:

- **Catálogo de Capacidades de Negocio** — jerarquías de capacidades multinivel por industria (banca, retail, manufactura, seguros, sector público, etc.) más capacidades macro entre industrias.
- **Catálogo de Procesos** — procesos de negocio de referencia por industria, listos para importar como fichas `BusinessProcess`.
- **Catálogo de Flujos de Valor** — flujos de valor de extremo a extremo para enmarcar el mapa de capacidades.

Esta página se centra en el Catálogo de Capacidades de Negocio, porque es el que impulsa el Mapa de Calor de Capacidades en la página final. Los otros dos funcionan de la misma manera.

## Por qué comenzar con capacidades

Una **Capacidad de Negocio** es *lo que hace el negocio*, expresado en un lenguaje estable e independiente de la tecnología — "Gestión de Pedidos", "Incorporación de Clientes", "Gestión de Reclamaciones". Las capacidades apenas cambian a lo largo de los años; las aplicaciones cambian todo el tiempo. Por eso, el mapeo de aplicación a capacidad es la relación más útil de todo el metamodelo:

- Le permite preguntar **"¿cuántas aplicaciones soportan la Incorporación de Clientes?"** — y detectar redundancia.
- Le permite preguntar **"¿qué capacidades dependen de una sola aplicación envejecida?"** — y detectar fragilidad.
- Sobrevive a reorganizaciones, cambios de proveedores y migraciones a la nube.

No necesita 500 capacidades para obtener valor. Necesita **20–60 capacidades, dos o tres niveles de profundidad**, en su alcance.

## Importe un mapa de capacidades inicial

1. Navegue a **Catálogo de Capacidades** en el menú principal (bajo Guía del Usuario).
2. Use los filtros en la parte superior:
    - **Industria** — elija la suya (o "Entre industrias" si nada encaja).
    - **Nivel** — comience con L1 y L2 visibles. Siempre puede profundizar más tarde.
3. Explore el árbol. Expanda algunas ramas para tener una idea de la profundidad.
4. Marque las capacidades que desea importar. **La selección se propaga**: marcar un L1 marca sus descendientes; marcar un L2 también marca su ancestro L1 para que la jerarquía permanezca conectada.
5. Haga clic en **Crear fichas desde la selección**.

Turbo EA crea una ficha `BusinessCapability` por cada nodo marcado, conserva la jerarquía padre-hijo y estampa cada ficha con un `catalogueId` estable para que las reimportaciones sean **idempotentes** — ejecutar la importación dos veces no crea duplicados.

Referencia completa: [Catálogo de Capacidades](../guide/capability-catalogue.md).

!!! tip "Buena práctica"
    Elija un subárbol, no todo el catálogo. Para una Racionalización del portafolio de aplicaciones en el dominio de Ventas, importar la capacidad L1 "Ventas y Gestión de Clientes" más sus hijos L2 suele ser suficiente — eso son 10–15 capacidades, no 300.

## Qué tan profundo ir

La profundidad correcta depende de lo que hará con ella:

| Profundidad | Cuándo usarla | Cantidad típica de fichas |
|-------------|---------------|---------------------------|
| **Solo L1** | Resúmenes de nivel ejecutivo, alcances muy pequeños | 8–12 |
| **L1 + L2** | El punto óptimo para un primer despliegue — legible en una pantalla, útil en informes | 30–60 |
| **L1 + L2 + L3** | Planificación detallada basada en capacidades, grandes empresas | 100–250 |
| **L4 y más profundo** | Análisis específicos en profundidad, no para una línea base inicial | varía |

Vaya a **L1 + L2** para su primera pasada. Siempre puede importar niveles adicionales más tarde a través del mismo catálogo — la reimportación idempotente los encajará bajo los padres existentes.

## Una palabra sobre procesos y flujos de valor

El **Catálogo de Procesos** y el **Catálogo de Flujos de Valor** funcionan de la misma manera: filtre, marque, cree en masa. Si su primer caso de uso es la Racionalización del portafolio de aplicaciones, puede omitirlos por ahora — el mapeo de capacidades es suficiente para impulsar el análisis en la página final.

Los querrá cuando:

- Pase de "racionalizar aplicaciones" a "optimizar el flujo de valor de pedido a cobro".
- Comience a construir flujos de procesos BPMN sobre las fichas `BusinessProcess` resultantes (vea [BPM](../guide/bpm.md)).

## ¿Y si mi industria no está en el catálogo?

Dos opciones:

1. **Elija la industria más cercana** y recorte. Las entradas "Entre industrias" (Finanzas, RR. HH., TI, Compras) se aplican a prácticamente todas las empresas.
2. **Combine catálogos** — importe primero "Entre industrias", luego complete con algunos elementos de un catálogo de industria específica.

De cualquier manera, **importe primero, personalice después**. Renombrar una capacidad importada o agregar un hijo es mucho más rápido que escribir toda la estructura desde cero. Y conserva el `catalogueId` para que las futuras actualizaciones del catálogo se fusionen limpiamente.

!!! warning "No haga esto"
    No cree tipos de ficha personalizados para capacidades o procesos solo para "hacerlos suyos". Los tipos integrados vienen con los campos correctos, los tipos de relación correctos y los informes correctos — los equivalentes personalizados no.

## Verifique antes de avanzar

Ha terminado con esta página cuando:

- El mapa de capacidades para su alcance existe en el inventario (filtre por Tipo = `Business Capability`).
- La jerarquía está intacta — abra algunas capacidades L2 y verifique que la migaja de pan del padre muestre el L1 correcto.
- El conteo de capacidades está entre 20 y 60.

Aún no ha mapeado ninguna aplicación a las capacidades — eso está en la página final. Primero, agreguemos un campo personalizado a Aplicaciones para hacer el análisis realmente útil.

Siguiente: [Personalice el metamodelo — ligeramente](customise-the-metamodel.md).
