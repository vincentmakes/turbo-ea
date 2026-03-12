# Metamodelo

El **Metamodelo** define la estructura de datos completa de su plataforma — qué tipos de fichas existen, qué campos tienen, cómo se relacionan entre sí y cómo se organizan las páginas de detalle de fichas. Todo es **basado en datos**: usted configura el metamodelo a través de la interfaz de administración, no modificando código.

![Configuración del Metamodelo](../assets/img/es/20_admin_metamodelo.png)

Navegue a **Administración > Metamodelo** para acceder al editor. Tiene seis pestañas: **Tipos de Fichas**, **Tipos de Relación**, **Cálculos**, **Etiquetas**, **Principios EA** y **Grafo del Metamodelo**.

## Tipos de Fichas

La pestaña Tipos de Fichas lista todos los tipos en el sistema. Turbo EA incluye 14 tipos predefinidos en cuatro capas de arquitectura:

| Capa | Tipos |
|------|-------|
| **Estrategia y Transformación** | Objetivo, Plataforma, Iniciativa |
| **Arquitectura de Negocio** | Organización, Capacidad de Negocio, Contexto de Negocio, Proceso de Negocio |
| **Aplicación y Datos** | Aplicación, Interfaz, Objeto de Datos |
| **Arquitectura Técnica** | Componente TI, Categoría Tecnológica, Proveedor, Sistema |

### Crear un Tipo Personalizado

Haga clic en **+ Nuevo Tipo** para crear un tipo de ficha personalizado. Configure:

| Campo | Descripción |
|-------|-------------|
| **Clave** | Identificador único (minúsculas, sin espacios) — no se puede cambiar después de la creación |
| **Etiqueta** | Nombre para mostrar en la interfaz |
| **Icono** | Nombre del icono de Google Material Symbols |
| **Color** | Color de marca para el tipo (usado en inventario, informes y diagramas) |
| **Categoría** | Agrupación por capa de arquitectura |
| **Tiene Jerarquía** | Si las fichas de este tipo pueden tener relaciones padre/hijo |

### Editar un Tipo

Haga clic en cualquier tipo para abrir el **Panel de Detalle del Tipo**. Aquí puede configurar:

#### Campos

Los campos definen los atributos personalizados disponibles en fichas de este tipo. Cada campo tiene:

| Configuración | Descripción |
|---------------|-------------|
| **Clave** | Identificador único del campo |
| **Etiqueta** | Nombre para mostrar |
| **Tipo** | texto, número, costo, booleano, fecha, url, selección_única o selección_múltiple |
| **Opciones** | Para campos de selección: las opciones disponibles con etiquetas y colores opcionales |
| **Requerido** | Si el campo debe completarse para la puntuación de calidad de datos |
| **Peso** | Cuánto contribuye este campo a la puntuación de calidad de datos (0–10) |
| **Solo lectura** | Impide la edición manual (útil para campos calculados) |

Haga clic en **+ Agregar Campo** para crear un nuevo campo, o haga clic en un campo existente para editarlo en el **Diálogo Editor de Campos**.

#### Secciones

Los campos se organizan en **secciones** en la página de detalle de la ficha. Puede:

- Crear secciones con nombre para agrupar campos relacionados
- Configurar secciones con diseño de **1 columna** o **2 columnas**
- Organizar campos en **grupos** dentro de una sección (renderizados como sub-encabezados colapsables)
- Arrastrar campos entre secciones y reordenarlos

El nombre de sección especial `__description` agrega campos a la sección Descripción de la página de detalle.

#### Subtipos (Sub-plantillas)

Los subtipos actúan como **sub-plantillas** dentro de un tipo de ficha. Cada subtipo puede controlar qué campos son visibles para fichas de ese subtipo, mientras que todos los campos permanecen definidos a nivel del tipo de ficha.

Por ejemplo, el tipo Aplicación tiene subtipos: Aplicación de Negocio, Microservicio, Agente IA y Despliegue. Un administrador podría ocultar los campos relacionados con servidores para el subtipo SaaS, ya que no son relevantes.

**Configurar la visibilidad de campos por subtipo:**

1. Abra un tipo de ficha en la administración del metamodelo.
2. Haga clic en cualquier chip de subtipo para abrir el diálogo **Plantilla de subtipo**.
3. Active o desactive la visibilidad de los campos usando los interruptores — los campos desactivados se ocultarán para fichas de ese subtipo.
4. Los campos ocultos se excluyen de la puntuación de calidad de datos, de modo que los usuarios no son penalizados por campos que no pueden ver.

Cuando no se selecciona ningún subtipo en una ficha (o el tipo no tiene subtipos), todos los campos son visibles. Los campos ocultos conservan sus datos — si el subtipo de una ficha cambia, los valores previamente ocultos se mantienen.

#### Roles de Partes Interesadas

Defina roles personalizados para este tipo (ej., «Propietario de Aplicación», «Propietario Técnico»). Cada rol tiene **permisos a nivel de ficha** que se combinan con el rol a nivel de aplicación del usuario al acceder a una ficha. Ver [Usuarios y Roles](users.es.md) para más información sobre el modelo de permisos.

#### Traducciones

Haga clic en el botón **Traducir** en la barra de herramientas del cajón de tipo para abrir el **Diálogo de Traducciones**. Aquí puede proporcionar traducciones para todas las etiquetas del metamodelo en cada idioma soportado:

- **Etiqueta del tipo** — El nombre de visualización del tipo de ficha
- **Subtipos** — Etiquetas para cada subtipo
- **Secciones** — Encabezados de sección en la página de detalle de la ficha
- **Campos** — Etiquetas de campos y etiquetas de opciones de selección
- **Roles de Parte Interesada** — Nombres de roles mostrados en la interfaz de asignación de stakeholders

Las traducciones se almacenan junto con cada tipo de ficha y se resuelven en tiempo de renderizado según el idioma seleccionado por el usuario. Las etiquetas sin traducir recurren al valor predeterminado en inglés.

### Eliminar un Tipo

- Los **tipos predefinidos** se eliminan suavemente (se ocultan) y pueden restaurarse
- Los **tipos personalizados** se eliminan permanentemente

## Tipos de Relación

Los tipos de relación definen las conexiones permitidas entre tipos de fichas. Cada tipo de relación especifica:

| Campo | Descripción |
|-------|-------------|
| **Clave** | Identificador único |
| **Etiqueta** | Etiqueta de dirección directa (ej., «utiliza») |
| **Etiqueta Inversa** | Etiqueta de dirección inversa (ej., «es utilizado por») |
| **Tipo Origen** | El tipo de ficha en el lado «de» |
| **Tipo Destino** | El tipo de ficha en el lado «a» |
| **Cardinalidad** | n:m (muchos a muchos) o 1:n (uno a muchos) |

Haga clic en **+ Nuevo Tipo de Relación** para crear una relación, o haga clic en una existente para editar sus etiquetas y atributos.

## Cálculos

Los campos calculados usan fórmulas definidas por el administrador para calcular automáticamente valores cuando se guardan fichas. Ver [Cálculos](calculations.es.md) para la guía completa.

## Etiquetas

Los grupos de etiquetas y etiquetas se pueden gestionar desde esta pestaña. Ver [Etiquetas](tags.es.md) para la guía completa.

## Principios EA

La pestaña **Principios EA** permite definir los principios de arquitectura que gobiernan el paisaje de TI de su organización. Estos principios sirven como barandillas estratégicas — por ejemplo, «Reutilizar antes de comprar antes de construir» o «Si compramos, compramos SaaS».

Cada principio tiene cuatro campos:

| Campo | Descripción |
|-------|-------------|
| **Título** | Un nombre conciso para el principio |
| **Enunciado** | Qué establece el principio |
| **Justificación** | Por qué este principio es importante |
| **Implicaciones** | Consecuencias prácticas de seguir el principio |

Los principios se pueden **activar** o **desactivar** individualmente mediante el interruptor en cada tarjeta.

### Cómo los principios influyen en los insights de IA

Cuando genera **Insights IA del portafolio** en el [Informe de portafolio](../guide/reports.md#ai-portfolio-insights), todos los principios activos se incluyen en el análisis. La IA evalúa los datos de su portafolio frente a cada principio e informa:

- Si el portafolio **se alinea** o **viola** el principio
- Puntos de datos específicos como evidencia
- Acciones correctivas recomendadas

Por ejemplo, un principio «Comprar SaaS» haría que la IA señale aplicaciones alojadas on-premise o en IaaS y sugiera prioridades de migración a la nube.

## Grafo del Metamodelo

La pestaña **Grafo del Metamodelo** muestra un diagrama SVG visual de todos los tipos de fichas y sus tipos de relación. Esta es una visualización de solo lectura que ayuda a comprender las conexiones en su metamodelo de un vistazo.

## Editor de Disposición de Fichas

Para cada tipo de ficha, la sección **Diseño** en el panel del tipo controla cómo se estructura la página de detalle:

- **Orden de secciones** — Arrastre secciones (Descripción, EOL, Ciclo de Vida, Jerarquía, Relaciones y secciones personalizadas) para reordenarlas
- **Visibilidad** — Oculte secciones que no sean relevantes para un tipo
- **Expansión predeterminada** — Elija si cada sección comienza expandida o colapsada
- **Diseño de columnas** — Configure 1 o 2 columnas por sección personalizada
