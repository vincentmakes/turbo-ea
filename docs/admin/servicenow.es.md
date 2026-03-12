# Integración con ServiceNow

La integración con ServiceNow (**Administración > Configuración > ServiceNow**) permite la sincronización bidireccional entre Turbo EA y su CMDB de ServiceNow. Esta guía cubre todo, desde la configuración inicial hasta recetas avanzadas y mejores prácticas operativas.

## ¿Por qué integrar ServiceNow con Turbo EA?

ServiceNow CMDB y las herramientas de Arquitectura Empresarial sirven propósitos diferentes pero complementarios:

| | ServiceNow CMDB | Turbo EA |
|--|-----------------|----------|
| **Enfoque** | Operaciones de TI — qué está en ejecución, quién es responsable, qué incidentes ocurrieron | Planificación estratégica — ¿cómo debería verse el paisaje en 3 años? |
| **Mantenido por** | Operaciones de TI, Gestión de Activos | Equipo de EA, Arquitectos de Negocio |
| **Fortaleza** | Descubrimiento automatizado, flujos de trabajo ITSM, precisión operativa | Contexto de negocio, mapeo de capacidades, planificación de ciclo de vida, evaluaciones |
| **Datos típicos** | Nombres de host, IPs, estado de instalación, grupos de asignación, contratos | Criticidad de negocio, adecuación funcional, deuda técnica, hoja de ruta estratégica |

**Turbo EA es el sistema de registro** para su paisaje de arquitectura — nombres, descripciones, planes de ciclo de vida, evaluaciones y contexto de negocio viven aquí. ServiceNow complementa Turbo EA con metadatos operativos y técnicos (nombres de host, IPs, datos de SLA, estado de instalación) que provienen del descubrimiento automatizado y flujos de trabajo ITSM. La integración mantiene ambos sistemas conectados respetando que Turbo EA lidera.

### Lo que puede hacer

- **Sincronización pull** — Importar CIs desde ServiceNow a Turbo EA, luego tomar propiedad. Los pulls posteriores solo actualizan campos operativos (IPs, estado, SLAs) que SNOW descubre automáticamente
- **Sincronización push** — Exportar datos curados por EA de vuelta a ServiceNow (nombres, descripciones, evaluaciones, planes de ciclo de vida) para que los equipos ITSM vean el contexto de EA
- **Sincronización bidireccional** — Turbo EA lidera la mayoría de campos; SNOW lidera un pequeño conjunto de campos operativos/técnicos. Ambos sistemas se mantienen sincronizados
- **Mapeo de identidad** — Seguimiento persistente de referencias cruzadas (sys_id <-> UUID de ficha) que asegura que los registros permanezcan vinculados entre sincronizaciones

---

## Arquitectura de la Integración

```
+------------------+         HTTPS / Table API          +------------------+
|   Turbo EA       | <--------------------------------> |  ServiceNow      |
|                  |                                     |                  |
|  Fichas          |  Pull: CIs SNOW -> Fichas Turbo     |  CIs CMDB        |
|  (Aplicación,    |  Push: Fichas Turbo -> CIs SNOW     |  (cmdb_ci_appl,  |
|   Componente TI, |                                     |   cmdb_ci_server, |
|   Proveedor,...) |  Mapa de identidad: sys_id <-> UUID  |   core_company)  |
+------------------+                                     +------------------+
```

La integración utiliza la Table API de ServiceNow sobre HTTPS. Las credenciales se cifran en reposo usando Fernet (AES-128-CBC) derivado de su `SECRET_KEY`. Todas las operaciones de sincronización se registran como eventos con `source: "servicenow_sync"` para una pista de auditoría completa.

---

## Planificación de su Integración

Antes de configurar cualquier cosa, responda estas preguntas:

### 1. ¿Qué tipos de fichas necesitan datos de ServiceNow?

Comience con poco. Los puntos de integración más comunes son:

| Prioridad | Tipo Turbo EA | Fuente ServiceNow | Por qué |
|-----------|---------------|-------------------|---------|
| **Alta** | Aplicación | `cmdb_ci_business_app` | Las aplicaciones son el núcleo de EA — CMDB tiene nombres, propietarios y estado autorizados |
| **Alta** | Componente TI (Software) | `cmdb_ci_spkg` | Los productos de software alimentan el seguimiento EOL y el radar tecnológico |
| **Media** | Componente TI (Hardware) | `cmdb_ci_server` | Paisaje de servidores para mapeo de infraestructura |
| **Media** | Proveedor | `core_company` | Registro de proveedores para gestión de costos y relaciones |
| **Baja** | Interfaz | `cmdb_ci_endpoint` | Endpoints de integración (a menudo mantenidos manualmente en EA) |
| **Baja** | Objeto de Datos | `cmdb_ci_database` | Instancias de bases de datos |

### 2. ¿Qué sistema es la fuente de verdad para cada campo?

Esta es la decisión más importante. La regla predeterminada debe ser **Turbo EA lidera** — la herramienta de EA es el sistema de registro para su paisaje de arquitectura. ServiceNow solo debe liderar para un conjunto reducido de campos operativos y técnicos que provienen del descubrimiento automatizado o flujos de trabajo ITSM. Todo lo demás — nombres, descripciones, evaluaciones, planificación de ciclo de vida, costos — es propiedad del equipo de EA y se cura en Turbo EA.

**Modelo recomendado — «Turbo EA lidera, SNOW complementa»:**

| Tipo de campo | Fuente de verdad | Por qué |
|---------------|-----------------|---------|
| **Nombres y descripciones** | **Turbo lidera** | El equipo de EA cura nombres autorizados y escribe descripciones estratégicas; los nombres de CMDB pueden ser desordenados o autogenerados |
| **Criticidad de negocio** | **Turbo lidera** | Evaluación estratégica del equipo de EA — no datos operativos |
| **Adecuación funcional / técnica** | **Turbo lidera** | Las puntuaciones del modelo TIME son una preocupación de EA |
| **Ciclo de vida (todas las fases)** | **Turbo lidera** | Plan, puesta en marcha, activo, retirada gradual, fin de vida — todo son datos de planificación de EA |
| **Datos de costos** | **Turbo lidera** | EA rastrea el costo total de propiedad; CMDB puede tener líneas de contrato pero EA posee la vista consolidada |
| **Tipo de alojamiento, categoría** | **Turbo lidera** | EA clasifica aplicaciones por modelo de alojamiento para análisis estratégico |
| **Metadatos técnicos** | SNOW lidera | IPs, versiones de SO, nombres de host, números de serie — datos de descubrimiento automatizado que EA no mantiene |
| **SLA / estado operativo** | SNOW lidera | Estado de instalación, objetivos de SLA, métricas de disponibilidad — datos operativos ITSM |
| **Grupo de asignación / soporte** | SNOW lidera | Propiedad operativa rastreada en flujos de trabajo de ServiceNow |
| **Fechas de descubrimiento** | SNOW lidera | Primera/última vez descubierto, último escaneo — metadatos de automatización de CMDB |

### 3. ¿Con qué frecuencia debe sincronizar?

| Escenario | Frecuencia | Notas |
|-----------|-----------|-------|
| Importación inicial | Una vez | Modo aditivo, revise cuidadosamente |
| Gestión activa del paisaje | Diaria | Automatizado vía cron en horas de baja actividad |
| Informes de cumplimiento | Semanal | Antes de generar informes |
| Ad-hoc | Según necesidad | Antes de revisiones o presentaciones importantes de EA |

---

## Paso 1: Prerrequisitos de ServiceNow

### Crear una Cuenta de Servicio

En ServiceNow, cree una cuenta de servicio dedicada (nunca use cuentas personales):

| Rol | Propósito | ¿Requerido? |
|-----|-----------|-------------|
| `itil` | Acceso de lectura a tablas CMDB | Sí |
| `cmdb_read` | Leer Elementos de Configuración | Sí |
| `rest_api_explorer` | Útil para probar consultas | Recomendado |
| `import_admin` | Acceso de escritura a tablas destino | Solo para sincronización push |

**Mejor práctica**: Cree un rol personalizado con acceso de solo lectura únicamente a las tablas específicas que planea sincronizar. El rol `itil` es amplio — un rol personalizado con alcance limitado reduce el radio de impacto.

### Requisitos de Red

- El backend de Turbo EA debe poder alcanzar su instancia SNOW por HTTPS (puerto 443)
- Configure reglas de firewall y listas de IPs permitidas
- Formato de URL de instancia: `https://empresa.service-now.com` o `https://empresa.servicenowservices.com`

### Elegir Método de Autenticación

| Método | Ventajas | Desventajas | Recomendación |
|--------|----------|-------------|---------------|
| **Auth Básica** | Configuración simple | Credenciales enviadas en cada solicitud | Solo desarrollo/pruebas |
| **OAuth 2.0** | Basado en tokens, con alcance, auditable | Más pasos de configuración | **Recomendado para producción** |

Para OAuth 2.0:
1. En ServiceNow: **System OAuth > Application Registry**
2. Cree un nuevo endpoint OAuth API para clientes externos
3. Anote el Client ID y Client Secret
4. Rote los secretos en un ciclo de 90 días

---

## Paso 2: Crear una Conexión

Navegue a **Administración > ServiceNow > pestaña Conexiones**.

### Crear y Probar

1. Haga clic en **Agregar Conexión**
2. Complete:

| Campo | Valor de Ejemplo | Notas |
|-------|------------------|-------|
| Nombre | `CMDB Producción` | Etiqueta descriptiva para su equipo |
| URL de Instancia | `https://empresa.service-now.com` | Debe usar HTTPS |
| Tipo de Auth | Auth Básica u OAuth 2.0 | OAuth recomendado para producción |
| Credenciales | (según tipo de auth) | Cifradas en reposo vía Fernet |

3. Haga clic en **Crear**, luego haga clic en el **icono de prueba** (símbolo wifi) para verificar conectividad

- **Chip verde «Conectado»** — Listo para usar
- **Chip rojo «Fallido»** — Verifique credenciales, red y URL

### Múltiples Conexiones

Puede crear múltiples conexiones para:
- Instancias de **producción** vs **desarrollo**
- Instancias SNOW **regionales** (p. ej., EMEA, APAC)
- **Diferentes equipos** con cuentas de servicio separadas

Cada mapeo referencia una conexión específica.

---

## Paso 3: Diseñar sus Mapeos

Cambie a la pestaña **Mapeos**. Un mapeo conecta un tipo de ficha de Turbo EA con una tabla de ServiceNow.

### Crear un Mapeo

Haga clic en **Agregar Mapeo** y configure:

| Campo | Descripción | Ejemplo |
|-------|-------------|---------|
| **Conexión** | Qué instancia de ServiceNow usar | CMDB Producción |
| **Tipo de Ficha** | El tipo de ficha de Turbo EA a sincronizar | Aplicación |
| **Tabla SNOW** | El nombre API de la tabla de ServiceNow | `cmdb_ci_business_app` |
| **Dirección de Sincronización** | Qué operaciones están disponibles (ver abajo) | ServiceNow -> Turbo EA |
| **Modo de Sincronización** | Cómo manejar eliminaciones | Conservador |
| **Ratio Máximo de Eliminación** | Umbral de seguridad para eliminaciones masivas | 50% |
| **Consulta de Filtro** | Consulta codificada de ServiceNow para limitar alcance | `active=true^install_status=1` |
| **Omitir Staging** | Aplicar cambios directamente sin revisión | Desactivado (recomendado para sincronización inicial) |

### Mapeos Comunes de Tablas SNOW

| Tipo Turbo EA | Tabla ServiceNow | Descripción |
|---------------|------------------|-------------|
| Aplicación | `cmdb_ci_business_app` | Aplicaciones de negocio (más común) |
| Aplicación | `cmdb_ci_appl` | CIs de aplicaciones generales |
| Componente TI (Software) | `cmdb_ci_spkg` | Paquetes de software |
| Componente TI (Hardware) | `cmdb_ci_server` | Servidores físicos/virtuales |
| Componente TI (SaaS) | `cmdb_ci_cloud_service_account` | Cuentas de servicios en la nube |
| Proveedor | `core_company` | Proveedores / empresas |
| Interfaz | `cmdb_ci_endpoint` | Endpoints de integración |
| Objeto de Datos | `cmdb_ci_database` | Instancias de bases de datos |
| Sistema | `cmdb_ci_computer` | CIs de computadores |
| Organización | `cmn_department` | Departamentos |

### Ejemplos de Consultas de Filtro

Siempre filtre para evitar importar registros obsoletos o retirados:

```
# Solo CIs activos (filtro mínimo recomendado)
active=true

# CIs activos con estado de instalación «Instalado»
active=true^install_status=1

# Aplicaciones en uso productivo
active=true^used_for=Production

# CIs actualizados en los últimos 30 días
active=true^sys_updated_on>=javascript:gs.daysAgoStart(30)

# Grupo de asignación específico
active=true^assignment_group.name=IT Operations

# Excluir CIs retirados
active=true^install_statusNOT IN7,8
```

**Mejor práctica**: Incluya siempre `active=true` como mínimo. Las tablas CMDB a menudo contienen miles de registros retirados o descomisionados que no deben importarse a su paisaje de EA.

---

## Paso 4: Configurar Mapeos de Campos

Cada mapeo contiene **mapeos de campos** que definen cómo se traducen los campos individuales entre los dos sistemas. El campo Turbo EA proporciona sugerencias de autocompletado basadas en el tipo de ficha seleccionado — incluyendo campos principales, fechas de ciclo de vida y todos los atributos personalizados del esquema del tipo.

### Agregar Campos

Para cada mapeo de campo, configure:

| Configuración | Descripción |
|---------------|-------------|
| **Campo Turbo EA** | Ruta del campo en Turbo EA (autocompletado sugiere opciones según el tipo de ficha) |
| **Campo SNOW** | Nombre de columna API de ServiceNow (p. ej., `name`, `short_description`) |
| **Dirección** | Fuente de verdad por campo: SNOW lidera o Turbo lidera |
| **Transformación** | Cómo convertir valores: Directa, Mapa de Valores, Fecha, Booleano |
| **Identidad** (casilla ID) | Usado para emparejar registros durante la sincronización inicial |

### Rutas de Campos de Turbo EA

El autocompletado agrupa los campos por sección. Aquí está la referencia completa de rutas:

| Ruta | Destino | Valor de Ejemplo |
|------|---------|------------------|
| `name` | Nombre visible de la ficha | `"SAP S/4HANA"` |
| `description` | Descripción de la ficha | `"Sistema ERP principal para finanzas"` |
| `lifecycle.plan` | Ciclo de vida: Fecha de plan | `"2024-01-15"` |
| `lifecycle.phaseIn` | Ciclo de vida: Fecha de puesta en marcha | `"2024-03-01"` |
| `lifecycle.active` | Ciclo de vida: Fecha de activación | `"2024-06-01"` |
| `lifecycle.phaseOut` | Ciclo de vida: Fecha de retirada gradual | `"2028-12-31"` |
| `lifecycle.endOfLife` | Ciclo de vida: Fecha de fin de vida | `"2029-06-30"` |
| `attributes.<clave>` | Cualquier atributo personalizado del esquema de campos del tipo de ficha | Varía según el tipo de campo |

Por ejemplo, si su tipo Aplicación tiene un campo con clave `businessCriticality`, seleccione `attributes.businessCriticality` del desplegable.

### Campos de Identidad — Cómo funciona el emparejamiento

Marque uno o más campos como **Identidad** (icono de llave). Estos se usan durante la primera sincronización para emparejar registros de ServiceNow con fichas existentes de Turbo EA:

1. **Búsqueda en mapa de identidad** — Si ya existe un vínculo sys_id <-> UUID de ficha, se usa
2. **Coincidencia exacta por nombre** — Emparejamiento por el valor del campo de identidad (p. ej., coincidencia por nombre de aplicación)
3. **Coincidencia difusa** — Si no hay coincidencia exacta, se usa SequenceMatcher con umbral de similitud del 85%

**Mejor práctica**: Siempre marque el campo `name` como campo de identidad. Si los nombres difieren entre sistemas (p. ej., SNOW incluye números de versión como «SAP S/4HANA v2.1» pero Turbo EA tiene «SAP S/4HANA»), límpielos antes de la primera sincronización para mejor calidad de emparejamiento.

Después de la primera sincronización que establece los vínculos del mapa de identidad, las sincronizaciones posteriores usan el mapa de identidad persistente y no dependen del emparejamiento por nombre.

---

## Paso 5: Ejecutar su Primera Sincronización

Cambie a la pestaña **Panel de Sincronización**.

### Iniciar una Sincronización

Para cada mapeo activo, verá botones Pull y/o Push dependiendo de la dirección de sincronización configurada:

- **Pull** (icono de descarga de nube) — Obtiene datos de SNOW hacia Turbo EA
- **Push** (icono de carga de nube) — Envía datos de Turbo EA a ServiceNow

### Qué sucede durante una sincronización Pull

```
1. OBTENER     Recuperar todos los registros coincidentes de SNOW (lotes de 500)
2. EMPAREJAR   Emparejar cada registro con una ficha existente:
               a) Mapa de identidad (búsqueda persistente sys_id <-> UUID de ficha)
               b) Coincidencia exacta por nombre en campos de identidad
               c) Coincidencia difusa por nombre (umbral de similitud del 85%)
3. TRANSFORMAR Aplicar mapeos de campos para convertir formato SNOW -> Turbo EA
4. COMPARAR    Comparar datos transformados contra campos existentes de la ficha
5. PREPARAR    Asignar una acción a cada registro:
               - crear: Nuevo, no se encontró ficha coincidente
               - actualizar: Coincidencia encontrada, campos difieren
               - omitir: Coincidencia encontrada, sin diferencias
               - eliminar: En mapa de identidad pero ausente de SNOW
6. APLICAR     Ejecutar acciones preparadas (crear/actualizar/archivar fichas)
```

Cuando **Omitir Staging** está habilitado, los pasos 5 y 6 se fusionan — las acciones se aplican directamente sin escribir registros de staging.

### Revisión de Resultados de Sincronización

La tabla **Historial de Sincronización** muestra después de cada ejecución:

| Columna | Descripción |
|---------|-------------|
| Iniciado | Cuándo comenzó la sincronización |
| Dirección | Pull o Push |
| Estado | `completed`, `failed` o `running` |
| Obtenidos | Total de registros recuperados de ServiceNow |
| Creados | Nuevas fichas creadas en Turbo EA |
| Actualizados | Fichas existentes actualizadas |
| Eliminados | Fichas archivadas (eliminación suave) |
| Errores | Registros que fallaron al procesarse |
| Duración | Tiempo total transcurrido |

Haga clic en el **icono de lista** en cualquier ejecución para inspeccionar registros de staging individuales, incluyendo las diferencias campo por campo para cada actualización.

### Procedimiento Recomendado para la Primera Sincronización

```
1. Configure el mapeo en modo ADITIVO con staging ACTIVADO
2. Ejecute la sincronización pull
3. Revise los registros en staging — verifique que las creaciones sean correctas
4. Vaya al Inventario, verifique las fichas importadas
5. Ajuste mapeos de campos o consulta de filtro si es necesario
6. Ejecute nuevamente hasta estar satisfecho
7. Cambie a modo CONSERVADOR para uso continuo
8. Después de varias ejecuciones exitosas, habilite Omitir Staging
```

---

## Entender Dirección de Sincronización vs Dirección de Campo

Este es el concepto más comúnmente malentendido. Hay **dos niveles de dirección** que funcionan juntos:

### Nivel de Tabla: Dirección de Sincronización

Se configura en el mapeo mismo. Controla **qué operaciones de sincronización están disponibles** en el Panel de Sincronización:

| Dirección de Sincronización | ¿Botón Pull? | ¿Botón Push? | Usar cuando... |
|-----------------------------|--------------|--------------|----------------|
| **ServiceNow -> Turbo EA** | Sí | No | CMDB es la fuente maestra, solo importa |
| **Turbo EA -> ServiceNow** | No | Sí | La herramienta EA enriquece CMDB con evaluaciones |
| **Bidireccional** | Sí | Sí | Ambos sistemas contribuyen campos diferentes |

### Nivel de Campo: Dirección

Se configura **por mapeo de campo**. Controla **qué valor del sistema gana** durante una ejecución de sincronización:

| Dirección del Campo | Durante Pull (SNOW -> Turbo) | Durante Push (Turbo -> SNOW) |
|--------------------|--------------------------|---------------------------|
| **SNOW lidera** | El valor se importa desde ServiceNow | El valor se **omite** (no se envía) |
| **Turbo lidera** | El valor se **omite** (no se sobrescribe) | El valor se exporta a ServiceNow |

### Cómo funcionan juntos — Ejemplo

Mapeo: Aplicación <-> `cmdb_ci_business_app`, **Bidireccional**

| Campo | Dirección | Pull hace... | Push hace... |
|-------|-----------|-------------|-------------|
| `name` | **Turbo lidera** | Omite (EA cura nombres) | Envía nombre de EA -> SNOW |
| `description` | **Turbo lidera** | Omite (EA escribe descripciones) | Envía descripción -> SNOW |
| `lifecycle.active` | **Turbo lidera** | Omite (EA gestiona ciclo de vida) | Envía fecha de activación -> SNOW |
| `attributes.businessCriticality` | **Turbo lidera** | Omite (evaluación de EA) | Envía evaluación -> campo personalizado SNOW |
| `attributes.ipAddress` | SNOW lidera | Importa IP del descubrimiento | Omite (dato operativo) |
| `attributes.installStatus` | SNOW lidera | Importa estado operativo | Omite (dato ITSM) |

**Información clave**: La dirección a nivel de tabla determina *qué botones aparecen*. La dirección a nivel de campo determina *qué campos realmente se transfieren* durante cada operación. Un mapeo bidireccional donde Turbo EA lidera la mayoría de campos y SNOW solo lidera campos operativos/técnicos es la configuración más potente.

### Mejor Práctica: Dirección de Campo por Tipo de Dato

El valor predeterminado debe ser **Turbo lidera** para la gran mayoría de campos. Solo configure SNOW lidera para metadatos operativos y técnicos que provienen del descubrimiento automatizado o flujos de trabajo ITSM.

| Categoría de Dato | Dirección Recomendada | Justificación |
|--------------------|----------------------|---------------|
| **Nombres, etiquetas visibles** | **Turbo lidera** | El equipo de EA cura nombres autorizados y limpios — los nombres de CMDB a menudo son autogenerados o inconsistentes |
| **Descripción** | **Turbo lidera** | Las descripciones de EA capturan contexto estratégico, valor de negocio y significado arquitectónico |
| **Criticidad de negocio (modelo TIME)** | **Turbo lidera** | Evaluación central de EA — no datos operativos |
| **Adecuación funcional/técnica** | **Turbo lidera** | Puntuación específica de EA y clasificación de hoja de ruta |
| **Ciclo de vida (todas las fases)** | **Turbo lidera** | Plan, puesta en marcha, activo, retirada gradual, fin de vida son todas decisiones de planificación de EA |
| **Datos de costos** | **Turbo lidera** | EA rastrea el costo total de propiedad y asignación de presupuesto |
| **Tipo de alojamiento, clasificación** | **Turbo lidera** | Categorización estratégica mantenida por arquitectos |
| **Información de proveedor** | **Turbo lidera** | EA gestiona estrategia de proveedores, contratos y riesgos — SNOW puede tener un nombre de proveedor pero EA posee la relación |
| Metadatos técnicos (SO, IP, hostname) | SNOW lidera | Datos de descubrimiento automatizado — EA no mantiene esto |
| Objetivos de SLA, métricas de disponibilidad | SNOW lidera | Datos operativos de flujos de trabajo ITSM |
| Estado de instalación, estado operativo | SNOW lidera | CMDB rastrea si un CI está instalado, retirado, etc. |
| Grupo de asignación, equipo de soporte | SNOW lidera | Propiedad operativa gestionada en ServiceNow |
| Metadatos de descubrimiento (primera/última vez visto) | SNOW lidera | Marcas de tiempo de automatización de CMDB |

---

## Omitir Staging — Cuándo usarlo

Por defecto, las sincronizaciones pull siguen un flujo de **preparar-luego-aplicar**:

```
Obtener -> Emparejar -> Transformar -> Comparar -> PREPARAR -> Revisar -> APLICAR
```

Los registros se escriben en una tabla de staging, permitiéndole revisar qué cambiará antes de aplicar. Esto es visible en el Panel de Sincronización bajo «Ver registros preparados».

### Modo Omitir Staging

Cuando habilita **Omitir Staging** en un mapeo, los registros se aplican directamente:

```
Obtener -> Emparejar -> Transformar -> Comparar -> APLICAR DIRECTAMENTE
```

No se crean registros de staging — los cambios ocurren inmediatamente.

| | Staging (predeterminado) | Omitir Staging |
|--|--------------------------|----------------|
| **Paso de revisión** | Sí — inspeccionar diferencias antes de aplicar | No — los cambios se aplican inmediatamente |
| **Tabla de registros de staging** | Poblada con entradas de crear/actualizar/eliminar | No se puebla |
| **Pista de auditoría** | Registros de staging + historial de eventos | Solo historial de eventos |
| **Rendimiento** | Ligeramente más lento (escribe filas de staging) | Ligeramente más rápido |
| **Deshacer** | Puede abortar antes de aplicar | Debe revertir manualmente |

### Cuándo usar cada uno

| Escenario | Recomendación |
|-----------|---------------|
| Primera importación | **Usar staging** — Revise qué se crea antes de aplicar |
| Mapeo nuevo o modificado | **Usar staging** — Verifique que las transformaciones de campo produzcan salida correcta |
| Mapeo estable y bien probado | **Omitir staging** — No necesita revisar cada ejecución |
| Sincronizaciones diarias automatizadas (cron) | **Omitir staging** — Las ejecuciones desatendidas no pueden esperar revisión |
| CMDB grande (10.000+ CIs) | **Omitir staging** — Evita crear miles de filas de staging |
| Entorno sensible al cumplimiento | **Usar staging** — Mantener pista de auditoría completa en tabla de staging |

**Mejor práctica**: Comience con staging habilitado para sus primeras sincronizaciones. Una vez que tenga confianza en que el mapeo produce resultados correctos, habilite omitir staging para ejecuciones automatizadas.

---

## Modos de Sincronización y Seguridad de Eliminación

### Modos de Sincronización

| Modo | Crea | Actualiza | Elimina | Mejor para |
|------|------|-----------|---------|-----------|
| **Aditivo** | Sí | Sí | **Nunca** | Importaciones iniciales, entornos de bajo riesgo |
| **Conservador** | Sí | Sí | Solo fichas **creadas por sincronización** | Predeterminado para sincronizaciones continuas |
| **Estricto** | Sí | Sí | Todas las fichas vinculadas | Espejo completo de CMDB |

**Aditivo** nunca elimina fichas de Turbo EA, haciéndolo la opción más segura para importaciones iniciales y entornos donde Turbo EA contiene fichas que no están presentes en ServiceNow (fichas creadas manualmente, fichas de otras fuentes).

**Conservador** (predeterminado) rastrea si cada ficha fue creada originalmente por el motor de sincronización. Solo esas fichas pueden ser auto-archivadas si desaparecen de ServiceNow. Las fichas creadas manualmente en Turbo EA o importadas de otras fuentes nunca se tocan.

**Estricto** archiva cualquier ficha vinculada cuyo CI correspondiente de ServiceNow ya no aparece en los resultados de la consulta, independientemente de quién la creó. Use esto solo cuando ServiceNow es la fuente absoluta de verdad y desea que Turbo EA lo refleje exactamente.

### Ratio Máximo de Eliminación — Red de Seguridad

Como red de seguridad, el motor **omite todas las eliminaciones** si la cantidad excede el ratio configurado:

```
eliminaciones / total_vinculados > ratio_máximo_eliminación  ->  OMITIR TODAS LAS ELIMINACIONES
```

Ejemplo con 10 registros vinculados y umbral del 50%:

| Escenario | Eliminaciones | Ratio | Resultado |
|-----------|---------------|-------|-----------|
| 3 CIs eliminados normalmente | 3 / 10 = 30% | Bajo el umbral | Las eliminaciones proceden |
| 6 CIs eliminados a la vez | 6 / 10 = 60% | **Sobre el umbral** | Todas las eliminaciones se omiten |
| SNOW devuelve vacío (interrupción) | 10 / 10 = 100% | **Sobre el umbral** | Todas las eliminaciones se omiten |

Esto previene pérdida catastrófica de datos por cambios en consultas de filtro, interrupciones temporales de ServiceNow o nombres de tabla mal configurados.

**Mejor práctica**: Mantenga el ratio de eliminación al **50% o menos** para tablas con menos de 100 registros. Para tablas grandes (1.000+), puede configurarlo de manera segura al 25%.

### Progresión Recomendada

```
Semana 1:    Modo ADITIVO, staging ACTIVADO, ejecutar manualmente, revisar cada registro
Semana 2-4:  Modo CONSERVADOR, staging ACTIVADO, ejecutar diariamente, verificar resultados al azar
Mes 2+:      Modo CONSERVADOR, staging DESACTIVADO (omitir), cron diario automatizado
```

---

## Recetas Recomendadas por Tipo

### Receta 1: Aplicaciones desde CMDB (Más Común)

**Objetivo**: Importar el paisaje de aplicaciones desde ServiceNow, luego tomar propiedad de nombres, descripciones, evaluaciones y ciclo de vida en Turbo EA. SNOW solo lidera campos operativos.

**Mapeo:**

| Configuración | Valor |
|---------------|-------|
| Tipo de Ficha | Aplicación |
| Tabla SNOW | `cmdb_ci_business_app` |
| Dirección | Bidireccional |
| Modo | Conservador |
| Filtro | `active=true^install_status=1` |

**Mapeos de campos:**

| Campo Turbo EA | Campo SNOW | Dirección | Transformación | ¿ID? |
|----------------|------------|-----------|----------------|------|
| `name` | `name` | **Turbo lidera** | Directa | Sí |
| `description` | `short_description` | **Turbo lidera** | Directa | |
| `lifecycle.active` | `go_live_date` | **Turbo lidera** | Fecha | |
| `lifecycle.endOfLife` | `retirement_date` | **Turbo lidera** | Fecha | |
| `attributes.businessCriticality` | `busines_criticality` | **Turbo lidera** | Mapa de Valores | |
| `attributes.hostingType` | `hosting_type` | **Turbo lidera** | Directa | |
| `attributes.installStatus` | `install_status` | SNOW lidera | Directa | |
| `attributes.ipAddress` | `ip_address` | SNOW lidera | Directa | |

Configuración del mapa de valores para `businessCriticality`:

```json
{
  "mapping": {
    "1 - most critical": "missionCritical",
    "2 - somewhat critical": "businessCritical",
    "3 - less critical": "businessOperational",
    "4 - not critical": "administrativeService"
  }
}
```

**Consejo para la primera sincronización**: En el primer pull, los valores de SNOW pueblan todos los campos (ya que las fichas aún no existen). Después de eso, los campos donde Turbo lidera son propiedad del equipo de EA — los pulls posteriores solo actualizan los campos operativos donde SNOW lidera (estado de instalación, IP), mientras el equipo de EA gestiona todo lo demás directamente en Turbo EA.

**Después de la importación**: Refine los nombres de aplicaciones, escriba descripciones estratégicas, mapee a Capacidades de Negocio, agregue evaluaciones de adecuación funcional/técnica y configure fases de ciclo de vida — todo esto ahora es propiedad de Turbo EA y se enviará de vuelta a ServiceNow en sincronizaciones push.

---

### Receta 2: Componentes TI (Servidores)

**Objetivo**: Importar infraestructura de servidores para mapeo de infraestructura y análisis de dependencias. Los servidores son más operativos que las aplicaciones, así que más campos vienen de SNOW — pero Turbo EA aún lidera nombres y descripciones.

**Mapeo:**

| Configuración | Valor |
|---------------|-------|
| Tipo de Ficha | Componente TI |
| Tabla SNOW | `cmdb_ci_server` |
| Dirección | Bidireccional |
| Modo | Conservador |
| Filtro | `active=true^hardware_statusNOT IN6,7` |

**Mapeos de campos:**

| Campo Turbo EA | Campo SNOW | Dirección | Transformación | ¿ID? |
|----------------|------------|-----------|----------------|------|
| `name` | `name` | **Turbo lidera** | Directa | Sí |
| `description` | `short_description` | **Turbo lidera** | Directa | |
| `attributes.manufacturer` | `manufacturer.name` | **Turbo lidera** | Directa | |
| `attributes.operatingSystem` | `os` | SNOW lidera | Directa | |
| `attributes.ipAddress` | `ip_address` | SNOW lidera | Directa | |
| `attributes.serialNumber` | `serial_number` | SNOW lidera | Directa | |
| `attributes.hostname` | `host_name` | SNOW lidera | Directa | |

**Nota**: Para servidores, los campos operativos/de descubrimiento como SO, IP, número de serie y hostname provienen naturalmente del descubrimiento automatizado de SNOW. Pero el equipo de EA aún posee el nombre visible (que puede diferir del hostname) y la descripción para contexto estratégico.

**Después de la importación**: Vincule Componentes TI a Aplicaciones usando relaciones, lo que alimenta el gráfico de dependencias e informes de infraestructura.

---

### Receta 3: Productos de Software con Seguimiento EOL

**Objetivo**: Importar productos de software y combinar con la integración endoflife.date de Turbo EA. Turbo EA lidera en nombres, descripciones y proveedor — la versión es un campo factual donde SNOW puede liderar.

**Mapeo:**

| Configuración | Valor |
|---------------|-------|
| Tipo de Ficha | Componente TI |
| Tabla SNOW | `cmdb_ci_spkg` |
| Dirección | Bidireccional |
| Modo | Conservador |
| Filtro | `active=true` |

**Mapeos de campos:**

| Campo Turbo EA | Campo SNOW | Dirección | Transformación | ¿ID? |
|----------------|------------|-----------|----------------|------|
| `name` | `name` | **Turbo lidera** | Directa | Sí |
| `description` | `short_description` | **Turbo lidera** | Directa | |
| `attributes.version` | `version` | SNOW lidera | Directa | |
| `attributes.vendor` | `manufacturer.name` | **Turbo lidera** | Directa | |

**Después de la importación**: Vaya a **Administración > EOL** y use Búsqueda Masiva para emparejar automáticamente los Componentes TI importados contra productos de endoflife.date. Esto le brinda seguimiento automatizado de riesgo EOL que combina inventario CMDB con datos públicos de ciclo de vida.

---

### Receta 4: Proveedores (Bidireccional)

**Objetivo**: Mantener el registro de proveedores sincronizado. Turbo EA posee nombres de proveedores, descripciones y contexto estratégico. SNOW complementa con datos de contacto operativos.

**Mapeo:**

| Configuración | Valor |
|---------------|-------|
| Tipo de Ficha | Proveedor |
| Tabla SNOW | `core_company` |
| Dirección | Bidireccional |
| Modo | Aditivo |
| Filtro | `vendor=true` |

**Mapeos de campos:**

| Campo Turbo EA | Campo SNOW | Dirección | Transformación | ¿ID? |
|----------------|------------|-----------|----------------|------|
| `name` | `name` | **Turbo lidera** | Directa | Sí |
| `description` | `notes` | **Turbo lidera** | Directa | |
| `attributes.website` | `website` | **Turbo lidera** | Directa | |
| `attributes.contactEmail` | `email` | SNOW lidera | Directa | |

**Por qué Turbo lidera la mayoría de campos**: El equipo de EA cura la estrategia de proveedores, gestiona relaciones y rastrea riesgos — esto incluye el nombre visible del proveedor, descripción y presencia web. SNOW solo lidera datos de contacto operativos que pueden ser actualizados por equipos de adquisiciones o gestión de activos.

---

### Receta 5: Enviar Evaluaciones de EA de Vuelta a ServiceNow

**Objetivo**: Exportar evaluaciones específicas de EA a campos personalizados de ServiceNow para que los equipos ITSM puedan ver el contexto de EA.

**Mapeo:**

| Configuración | Valor |
|---------------|-------|
| Tipo de Ficha | Aplicación |
| Tabla SNOW | `cmdb_ci_business_app` |
| Dirección | Turbo EA -> ServiceNow |
| Modo | Aditivo |

**Mapeos de campos:**

| Campo Turbo EA | Campo SNOW | Dirección | Transformación | ¿ID? |
|----------------|------------|-----------|----------------|------|
| `name` | `name` | SNOW lidera | Directa | Sí |
| `attributes.businessCriticality` | `u_ea_business_criticality` | Turbo lidera | Mapa de Valores | |
| `attributes.functionalSuitability` | `u_ea_functional_fit` | Turbo lidera | Mapa de Valores | |
| `attributes.technicalSuitability` | `u_ea_technical_fit` | Turbo lidera | Mapa de Valores | |

> **Importante**: La sincronización push a campos personalizados (con prefijo `u_`) requiere que esas columnas ya existan en ServiceNow. Trabaje con su administrador de ServiceNow para crearlas antes de configurar el mapeo push. La cuenta de servicio necesita el rol `import_admin` para acceso de escritura.

**Por qué esto importa**: Los equipos ITSM ven evaluaciones de EA directamente en los flujos de trabajo de incidentes/cambios de ServiceNow. Cuando una aplicación «Misión Crítica» tiene un incidente, las reglas de escalación de prioridad pueden usar la puntuación de criticidad proporcionada por EA.

---

## Referencia de Tipos de Transformación

### Directa (predeterminada)

Pasa el valor sin cambios. Use para campos de texto que tienen el mismo formato en ambos sistemas.

### Mapa de Valores

Traduce valores enumerados entre sistemas. Configure con un mapeo JSON:

```json
{
  "mapping": {
    "1": "missionCritical",
    "2": "businessCritical",
    "3": "businessOperational",
    "4": "administrativeService"
  }
}
```

El mapeo se invierte automáticamente al enviar de Turbo EA a ServiceNow. Por ejemplo, durante push, `"missionCritical"` se convierte en `"1"`.

### Formato de Fecha

Trunca valores datetime de ServiceNow (`2024-06-15 14:30:00`) a solo fecha (`2024-06-15`). Use para fechas de fase de ciclo de vida donde la hora es irrelevante.

### Booleano

Convierte entre booleanos de cadena de ServiceNow (`"true"`, `"1"`, `"yes"`) y booleanos nativos. Útil para campos como «is_virtual», «active», etc.

---

## Mejores Prácticas de Seguridad

### Gestión de Credenciales

| Práctica | Detalles |
|----------|----------|
| **Cifrado en reposo** | Todas las credenciales cifradas vía Fernet (AES-128-CBC) derivado de `SECRET_KEY`. Si rota `SECRET_KEY`, vuelva a ingresar todas las credenciales de ServiceNow. |
| **Privilegio mínimo** | Cree una cuenta de servicio SNOW dedicada con acceso de solo lectura a tablas específicas. Solo otorgue acceso de escritura si usa sincronización push. |
| **OAuth 2.0 preferido** | Auth Básica envía credenciales en cada llamada API. OAuth usa tokens de corta duración con restricciones de alcance. |
| **Rotación de credenciales** | Rote contraseñas o secretos de cliente cada 90 días. |

### Seguridad de Red

| Práctica | Detalles |
|----------|----------|
| **HTTPS obligatorio** | Las URLs HTTP se rechazan en tiempo de validación. Todas las conexiones deben usar HTTPS. |
| **Validación de nombre de tabla** | Los nombres de tabla se validan contra `^[a-zA-Z0-9_]+$` para prevenir inyección. |
| **Validación de sys_id** | Los valores sys_id se validan como cadenas hexadecimales de 32 caracteres. |
| **Lista de IPs permitidas** | Configure el Control de Acceso por IP de ServiceNow para solo permitir la IP de su servidor Turbo EA. |

### Control de Acceso

| Práctica | Detalles |
|----------|----------|
| **Controlado por RBAC** | Todos los endpoints de ServiceNow requieren permiso `servicenow.manage`. |
| **Pista de auditoría** | Todos los cambios creados por sincronización publican eventos con `source: "servicenow_sync"`, visibles en el historial de fichas. |
| **Sin exposición de credenciales** | Las contraseñas y secretos nunca se devuelven en respuestas API. |

### Lista de Verificación para Producción

- [ ] Cuenta de servicio dedicada de ServiceNow (no una cuenta personal)
- [ ] OAuth 2.0 con otorgamiento de credenciales de cliente
- [ ] Calendario de rotación de credenciales (cada 90 días)
- [ ] Cuenta de servicio restringida solo a tablas mapeadas
- [ ] Lista de IPs permitidas de ServiceNow configurada para la IP del servidor Turbo EA
- [ ] Ratio máximo de eliminación configurado al 50% o menos
- [ ] Ejecuciones de sincronización monitoreadas por conteos inusuales de errores o eliminaciones
- [ ] Consultas de filtro incluyen `active=true` como mínimo

---

## Manual de Operaciones

### Secuencia de Configuración Inicial

```
1. Crear cuenta de servicio de ServiceNow con los roles mínimos requeridos
2. Verificar conectividad de red (¿puede Turbo EA alcanzar SNOW por HTTPS?)
3. Crear conexión en Turbo EA y probarla
4. Verificar que los tipos del metamodelo tengan todos los campos que desea sincronizar
5. Crear primer mapeo con modo ADITIVO, staging ACTIVADO
6. Usar el botón Vista Previa (vía API) para verificar que el mapeo produzca salida correcta
7. Ejecutar primera sincronización pull — revisar registros de staging en el Panel de Sincronización
8. Aplicar registros de staging
9. Verificar fichas importadas en el Inventario
10. Ajustar mapeos de campos si es necesario, volver a ejecutar
11. Cambiar mapeo a modo CONSERVADOR para uso continuo
12. Después de varias ejecuciones exitosas, habilitar Omitir Staging para automatización
```

### Operaciones Continuas

| Tarea | Frecuencia | Cómo |
|-------|-----------|------|
| Ejecutar sincronización pull | Diaria o semanal | Panel de Sincronización > botón Pull (o cron) |
| Revisar estadísticas de sincronización | Después de cada ejecución | Verificar conteos de errores/eliminaciones |
| Probar conexiones | Mensual | Hacer clic en botón de prueba en cada conexión |
| Rotar credenciales | Trimestral | Actualizar en SNOW y Turbo EA |
| Revisar mapa de identidad | Trimestral | Verificar entradas huérfanas vía estadísticas de sincronización |
| Auditar historial de fichas | Según necesidad | Filtrar eventos por fuente `servicenow_sync` |

### Configurar Sincronizaciones Automatizadas

Las sincronizaciones se pueden iniciar vía API para automatización:

```bash
# Sincronización pull diaria a las 2:00 AM
0 2 * * * curl -s -X POST \
  -H "Authorization: Bearer $TURBOEA_TOKEN" \
  "https://turboea.empresa.com/api/v1/servicenow/sync/pull/$MAPPING_ID" \
  >> /var/log/turboea-sync.log 2>&1
```

**Mejor práctica**: Ejecute sincronizaciones durante horas de baja actividad. Para tablas CMDB grandes (10.000+ CIs), espere de 2 a 5 minutos dependiendo de la latencia de red y la cantidad de registros.

### Planificación de Capacidad

| Tamaño de CMDB | Duración Esperada | Recomendación |
|-----------------|-------------------|---------------|
| < 500 CIs | < 30 segundos | Sincronizar diariamente, staging opcional |
| 500-5.000 CIs | 30s - 2 minutos | Sincronizar diariamente, omitir staging |
| 5.000-20.000 CIs | 2-5 minutos | Sincronizar cada noche, omitir staging |
| 20.000+ CIs | 5-15 minutos | Sincronizar semanalmente, usar consultas de filtro para dividir |

---

## Solución de Problemas

### Problemas de Conexión

| Síntoma | Causa | Solución |
|---------|-------|----------|
| `Connection failed: [SSL]` | Certificado autofirmado o expirado | Asegúrese de que SNOW use un certificado de CA pública válido |
| `HTTP 401: Unauthorized` | Credenciales incorrectas | Vuelva a ingresar usuario/contraseña; verifique que la cuenta no esté bloqueada |
| `HTTP 403: Forbidden` | Roles insuficientes | Otorgue `itil` y `cmdb_read` a la cuenta de servicio |
| `Connection failed: timed out` | Bloqueo de firewall | Verifique reglas; agregue la IP de Turbo EA a la lista permitida de SNOW |
| Prueba OK pero sincronización falla | Permisos a nivel de tabla | Otorgue acceso de lectura a la tabla CMDB específica |

### Problemas de Sincronización

| Síntoma | Causa | Solución |
|---------|-------|----------|
| 0 registros obtenidos | Tabla o filtro incorrecto | Verifique nombre de tabla; simplifique consulta de filtro |
| Todos los registros son «crear» | Error de identidad | Marque `name` como identidad; verifique que los nombres coincidan entre sistemas |
| Conteo alto de errores | Fallos de transformación | Revise registros de staging para mensajes de error |
| Eliminaciones omitidas | Ratio excedido | Aumente umbral o investigue por qué desaparecieron los CIs |
| Cambios no visibles | Caché del navegador | Recargue la página; verifique historial de ficha para eventos |
| Fichas duplicadas | Múltiples mapeos para el mismo tipo | Use un mapeo por tipo de ficha por conexión |
| Cambios push rechazados | Permisos SNOW faltantes | Otorgue rol `import_admin` a la cuenta de servicio |

### Herramientas de Diagnóstico

```bash
# Vista previa de cómo se mapearán los registros (5 muestras, sin efectos secundarios)
POST /api/v1/servicenow/mappings/{mapping_id}/preview

# Explorar tablas en la instancia SNOW
GET /api/v1/servicenow/connections/{conn_id}/tables?search=cmdb

# Inspeccionar columnas de una tabla
GET /api/v1/servicenow/connections/{conn_id}/tables/cmdb_ci_business_app/fields

# Filtrar registros de staging por acción o estado
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=create
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=update
GET /api/v1/servicenow/sync/runs/{run_id}/staged?status=error
```

---

## Referencia Rápida de la API

Todos los endpoints requieren `Authorization: Bearer <token>` y permiso `servicenow.manage`. Ruta base: `/api/v1`.

### Conexiones

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/servicenow/connections` | Listar conexiones |
| POST | `/servicenow/connections` | Crear conexión |
| GET | `/servicenow/connections/{id}` | Obtener conexión |
| PATCH | `/servicenow/connections/{id}` | Actualizar conexión |
| DELETE | `/servicenow/connections/{id}` | Eliminar conexión + todos los mapeos |
| POST | `/servicenow/connections/{id}/test` | Probar conectividad |
| GET | `/servicenow/connections/{id}/tables` | Explorar tablas SNOW |
| GET | `/servicenow/connections/{id}/tables/{table}/fields` | Listar columnas de tabla |

### Mapeos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/servicenow/mappings` | Listar mapeos con mapeos de campos |
| POST | `/servicenow/mappings` | Crear mapeo con mapeos de campos |
| GET | `/servicenow/mappings/{id}` | Obtener mapeo con mapeos de campos |
| PATCH | `/servicenow/mappings/{id}` | Actualizar mapeo (reemplaza campos si se proporcionan) |
| DELETE | `/servicenow/mappings/{id}` | Eliminar mapeo |
| POST | `/servicenow/mappings/{id}/preview` | Vista previa de prueba (5 registros de muestra) |

### Operaciones de Sincronización

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/servicenow/sync/pull/{mapping_id}` | Sincronización pull (`?auto_apply=true` predeterminado) |
| POST | `/servicenow/sync/push/{mapping_id}` | Sincronización push |
| GET | `/servicenow/sync/runs` | Listar historial de sincronización (`?limit=20`) |
| GET | `/servicenow/sync/runs/{id}` | Obtener detalles de ejecución + estadísticas |
| GET | `/servicenow/sync/runs/{id}/staged` | Listar registros de staging de una ejecución |
| POST | `/servicenow/sync/runs/{id}/apply` | Aplicar registros de staging pendientes |
