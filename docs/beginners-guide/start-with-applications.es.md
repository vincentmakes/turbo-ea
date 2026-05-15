# Comience con su inventario de aplicaciones

Turbo EA viene con 13 tipos de ficha listos para usar. Estará tentado a poblarlos todos. No lo haga.

**Comience con Aplicaciones**. Las Aplicaciones son el tipo de ficha con mayor apalancamiento en cualquier primer despliegue:

- Son las más fáciles de obtener — los departamentos de TI casi siempre tienen una lista en algún lugar (CMDB, rastreador de licencias, sistema financiero, incluso una hoja de cálculo).
- Anclan todas las demás capas — una vez que tenga Aplicaciones, mapearlas a Capacidades, Procesos y Componentes de TI se convierte en un enriquecimiento incremental en lugar de un ejercicio desde cero.
- Impulsan el primer informe útil (Racionalización del Portafolio) con las menores dependencias.

Otros tipos de ficha vienen después. Una segunda ola común son las Capacidades de Negocio (página 4) y luego las Interfaces u Objetos de Datos.

## Cómo se ve lo "mínimo viable"

Para cada ficha de Aplicación en su alcance inicial, pueble estos campos y **solo** estos campos:

| Campo | Por qué importa | De dónde viene |
|-------|-----------------|----------------|
| **Nombre** | Identidad. Use el nombre que la gente realmente utiliza, no la etiqueta de licencia. | Su fuente existente |
| **Descripción** | Una oración: ¿qué hace esta aplicación para el negocio? | Entrevista con el propietario, o sugerencia de IA (vea [Inventario](../guide/inventory.md#ai-description-suggestions)) |
| **Fase del ciclo de vida** | Plan / Fase de incorporación / Activo / Fase de salida / Fin de vida | CMDB, o entrevista con el propietario |
| **Propietario de Negocio** (interesado) | La persona responsable de la aplicación | Organigrama |
| **Costo — Total Anual** | Usado por el Informe de Portafolio y la fórmula TIME | Finanzas, o estimación aproximada |

Cinco campos. Eso es todo. El anillo de Calidad de Datos marcará ~50% y eso está bien — puede refinar en la segunda pasada.

!!! warning "No haga esto"
    No intente completar la **fecha de Fin de Vida**, el **Proveedor**, el **Stack tecnológico** y 12 campos personalizados en la primera pasada. Se agotará alrededor de la ficha 30.

## Tres formas de poblar el inventario

Elija el camino que coincida con su fuente de datos. Puede mezclarlos — importe el grueso y luego corrija manualmente la cola larga.

### Camino A — Importación Excel / CSV (recomendada para la mayoría de los inicios)

Si sus aplicaciones viven en una hoja de cálculo (o puede exportarlas desde un CMDB), este es el camino más rápido. **No empiece elaborando la hoja a mano** — deje que Turbo EA le proporcione la plantilla.

1. **Cree primero una ficha de Aplicación ficticia de forma manual**. Vaya a **Inventario → + Crear**, Tipo = `Application`, póngale un nombre como *«_TEMPLATE — eliminar»*. Rellene los cinco campos mínimos (descripción, ciclo de vida, propietario, coste) para que la exportación contenga valores reales que sirvan de ejemplo.
2. **Filtre el inventario por Tipo = `Application`** y haga clic en **Exportar** en la barra de herramientas. Obtendrá un archivo `.xlsx` con una fila de datos reales y una columna por campo — esa es su plantilla. Los encabezados de columna coinciden con las claves de campo que espera el importador.
3. **Edite la hoja sin conexión**: mantenga la estructura de columnas, sustituya la fila única por todas sus aplicaciones reales y elimine la fila ficticia al final (o déjela — eliminará la ficha de Turbo EA tras la importación).
4. **Importe el archivo editado**: **Inventario → Importar**, arrastre el `.xlsx`. El informe de validación le muestra exactamente qué filas crearán nuevas fichas, cuáles actualizarán fichas existentes (coincidencia por nombre o ID) y cuáles fallarán.
5. Ejecute la importación y archive la ficha `_TEMPLATE`.

Referencia completa: [Inventario → Importación Excel](../guide/inventory.md#excel-import).

**Consejo para la primera importación:** incluya solo los cinco campos mínimos, más una columna para el correo electrónico del Propietario de Negocio (el importador intentará hacerlo coincidir con usuarios existentes). Omita todo lo demás. Puede hacer una segunda importación más tarde con más columnas repitiendo el bucle exportar-editar-importar.

### Camino B — Sincronización con ServiceNow

Si tiene un CMDB de ServiceNow y acceso de administrador a su API, la integración extrae los registros de Aplicación directamente.

1. Vaya a **Admin → Integración ServiceNow**.
2. Cree una conexión (URL, credenciales — las credenciales se almacenan cifradas).
3. Defina un mapeo: ServiceNow `cmdb_ci_business_app` → Turbo EA `Application`, con reglas a nivel de campo.
4. Ejecute una sincronización de **extracción**. De forma predeterminada, los registros llegan a un área de **staging** para revisión del administrador antes de aplicarse.

Vea [Admin → Integración ServiceNow](../admin/servicenow.md) para la configuración completa. Trate la primera sincronización como exploratoria — revise lo que llegó, refine el mapeo y luego ejecútela en serio.

### Camino C — Entrada manual

Para parques pequeños (menos de ~30 aplicaciones) o cuando no existe una fuente utilizable:

1. **Inventario** → **+ Crear** (arriba a la derecha).
2. Tipo = **Application**, complete el Nombre y (opcionalmente) la Descripción.
3. Haga clic en **Sugerir con IA** si desea una descripción inicial obtenida de una búsqueda web.
4. Guarde y siga adelante. Completará el resto desde la página de detalle de la ficha.

La entrada manual es lenta pero produce datos de la más alta calidad porque cada ficha es tocada por el propietario al ingresarla.

## Use el flujo de aprobación como puerta de calidad

Cada ficha lleva un **Estado de aprobación**: Borrador → Aprobado → (Roto si se edita sustancialmente después de la aprobación).

Un flujo de trabajo práctico:

1. Las nuevas fichas llegan como **Borrador**. El Arquitecto (usted) hace una revisión rápida — nombre correcto, descripción sensata, ciclo de vida correcto.
2. Una vez que los campos mínimos están completos, **apruebe** la ficha. Esto le indica a los consumidores posteriores que la ficha es confiable.
3. Si alguien luego edita un campo sustancial, Turbo EA cambia automáticamente el estado a **Roto** hasta que se vuelva a aprobar.

Filtre el inventario por `Estado de aprobación = Aprobado` para obtener una vista limpia para el informe de portafolio al final de esta guía.

!!! tip "Buena práctica"
    Apruebe en lotes al final de cada día. Le obliga a releer lo que importó y detectar los peores problemas de calidad de datos temprano.

## Cuándo dejar de poblar y avanzar

Ha terminado con esta página cuando:

- Cada aplicación en su alcance tiene una ficha.
- Cada ficha tiene los cinco campos mínimos completos.
- La calidad de datos promedio en el conjunto es **≥ 40%**.
- Al menos el 50% de las fichas están aprobadas.

No espere la perfección. Pase a la siguiente página — [Aproveche los catálogos de referencia](leverage-reference-catalogues.md) — y vuelva a enriquecer después de haber mapeado las capacidades.
