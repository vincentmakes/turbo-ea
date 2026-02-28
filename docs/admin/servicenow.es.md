# Integración con ServiceNow

La integración con ServiceNow (**Administración > Configuración > ServiceNow**) permite la sincronización bidireccional entre Turbo EA y su CMDB de ServiceNow. Esta guía cubre todo, desde la configuración inicial hasta recetas avanzadas y mejores prácticas operativas.

## ¿Por qué integrar ServiceNow con Turbo EA?

ServiceNow CMDB y las herramientas de Arquitectura Empresarial sirven propósitos diferentes pero complementarios:

| | ServiceNow CMDB | Turbo EA |
|--|-----------------|----------|
| **Enfoque** | Operaciones de TI — qué está en ejecución, quién es responsable, qué incidentes ocurrieron | Planificación estratégica — cómo debería verse el paisaje en 3 años |
| **Mantenido por** | Operaciones de TI, Gestión de Activos | Equipo de EA, Arquitectos de Negocio |
| **Fortaleza** | Descubrimiento automatizado, flujos de trabajo ITSM, precisión operativa | Contexto de negocio, mapeo de capacidades, planificación de ciclo de vida |

**Turbo EA es el sistema de registro** para su paisaje de arquitectura. ServiceNow complementa Turbo EA con metadatos operativos y técnicos (nombres de host, IPs, datos de SLA, estado de instalación) que provienen del descubrimiento automatizado y flujos de trabajo ITSM.

### Lo que puede hacer

- **Sincronización pull** — Importar CIs desde ServiceNow a Turbo EA, luego tomar propiedad. Los pulls posteriores solo actualizan campos operativos
- **Sincronización push** — Exportar datos curados por EA de vuelta a ServiceNow (nombres, descripciones, evaluaciones, planes de ciclo de vida)
- **Sincronización bidireccional** — Turbo EA lidera la mayoría de campos; SNOW lidera un pequeño conjunto de campos operativos/técnicos
- **Mapeo de identidad** — Seguimiento persistente de referencias cruzadas (sys_id <-> UUID de ficha)

---

## Planificación de su Integración

### ¿Qué tipos de fichas necesitan datos de ServiceNow?

| Prioridad | Tipo Turbo EA | Fuente ServiceNow | Por qué |
|-----------|---------------|-------------------|---------|
| **Alta** | Aplicación | `cmdb_ci_business_app` | Las aplicaciones son el núcleo de EA |
| **Alta** | Componente TI (Software) | `cmdb_ci_spkg` | Productos de software para seguimiento EOL |
| **Media** | Componente TI (Hardware) | `cmdb_ci_server` | Paisaje de servidores |
| **Media** | Proveedor | `core_company` | Registro de proveedores |

### ¿Qué sistema es la fuente de verdad para cada campo?

La regla predeterminada: **Turbo EA lidera** — nombres, descripciones, evaluaciones, ciclo de vida, costos. ServiceNow solo lidera para metadatos operativos y técnicos (IPs, estado de instalación, datos de SLA).

---

## Paso 1: Prerrequisitos de ServiceNow

### Crear una Cuenta de Servicio

En ServiceNow, cree una cuenta de servicio dedicada (nunca use cuentas personales):

| Rol | Propósito | ¿Requerido? |
|-----|-----------|-------------|
| `itil` | Acceso de lectura a tablas CMDB | Sí |
| `cmdb_read` | Leer elementos de configuración | Sí |
| `import_admin` | Acceso de escritura a tablas destino | Solo para sincronización push |

---

## Paso 2: Crear una Conexión

Navegue a **Administración > Configuración > ServiceNow > Conexiones**.

1. Haga clic en **Agregar Conexión**
2. Complete: Nombre, URL de instancia (debe usar HTTPS), tipo de autenticación y credenciales
3. Haga clic en **Crear**, luego haga clic en el **icono de prueba** para verificar conectividad

---

## Paso 3: Diseñar sus Mapeos

Cambie a la pestaña **Mapeos**. Un mapeo conecta un tipo de ficha de Turbo EA con una tabla de ServiceNow.

| Campo | Descripción |
|-------|-------------|
| **Conexión** | Qué instancia de ServiceNow usar |
| **Tipo de Ficha** | El tipo de ficha de Turbo EA a sincronizar |
| **Tabla SNOW** | El nombre API de la tabla de ServiceNow |
| **Dirección de Sincronización** | ServiceNow → Turbo EA, Turbo EA → ServiceNow, o Bidireccional |
| **Modo de Sincronización** | Cómo manejar eliminaciones: Aditivo, Conservador o Estricto |
| **Ratio Máximo de Eliminación** | Umbral de seguridad para eliminaciones masivas |
| **Consulta de Filtro** | Consulta codificada de ServiceNow para limitar el alcance |
| **Omitir Staging** | Aplicar cambios directamente sin revisión |

---

## Paso 4: Configurar Mapeos de Campos

Cada mapeo contiene mapeos de campos que definen cómo se traducen los campos individuales entre los dos sistemas.

| Configuración | Descripción |
|---------------|-------------|
| **Campo Turbo EA** | Ruta del campo en Turbo EA (autocompletado sugiere opciones) |
| **Campo SNOW** | Nombre de columna API de ServiceNow |
| **Dirección** | Fuente de verdad por campo: SNOW lidera o Turbo lidera |
| **Transformación** | Cómo convertir valores: Directa, Mapa de Valores, Fecha, Booleano |
| **Identidad** | Usado para emparejar registros durante la sincronización inicial |

---

## Paso 5: Ejecutar su Primera Sincronización

Cambie a la pestaña **Panel de Sincronización**.

### Procedimiento Recomendado para la Primera Sincronización

1. Configure el mapeo en modo **ADITIVO** con staging **ACTIVADO**
2. Ejecute la sincronización pull
3. Revise los registros en staging — verifique que las creaciones sean correctas
4. Vaya al Inventario, verifique las fichas importadas
5. Ajuste mapeos de campos o consulta de filtro si es necesario
6. Ejecute nuevamente hasta estar satisfecho
7. Cambie a modo **CONSERVADOR** para uso continuo
8. Después de varias ejecuciones exitosas, habilite Omitir Staging

---

## Dirección de Sincronización vs Dirección de Campo

Hay **dos niveles de dirección** que funcionan juntos:

**Nivel de tabla (Dirección de Sincronización)** — Controla qué operaciones están disponibles (botones Pull y/o Push).

**Nivel de campo (Dirección)** — Controla qué valor del sistema gana durante una ejecución de sincronización:

| Dirección del Campo | Durante Pull (SNOW → Turbo) | Durante Push (Turbo → SNOW) |
|--------------------|--------------------------|---------------------------|
| **SNOW lidera** | El valor se importa desde ServiceNow | El valor se **omite** (no se envía) |
| **Turbo lidera** | El valor se **omite** (no se sobrescribe) | El valor se exporta a ServiceNow |

---

## Modos de Sincronización y Seguridad de Eliminación

| Modo | Crea | Actualiza | Elimina | Mejor para |
|------|------|-----------|---------|-----------|
| **Aditivo** | Sí | Sí | **Nunca** | Importaciones iniciales |
| **Conservador** | Sí | Sí | Solo fichas **creadas por sincronización** | Sincronizaciones continuas (predeterminado) |
| **Estricto** | Sí | Sí | Todas las fichas vinculadas | Espejo completo de CMDB |

### Ratio Máximo de Eliminación — Red de Seguridad

El motor **omite todas las eliminaciones** si la cantidad excede el ratio configurado. Esto previene pérdida catastrófica de datos por cambios en consultas de filtro, interrupciones temporales de ServiceNow o nombres de tabla mal configurados.

---

## Mejores Prácticas de Seguridad

- **Cifrado en reposo** — Todas las credenciales cifradas vía Fernet derivado de `SECRET_KEY`
- **Privilegio mínimo** — Cuenta de servicio SNOW dedicada con acceso de solo lectura a tablas específicas
- **OAuth 2.0 preferido** — Tokens de corta duración con restricciones de alcance
- **HTTPS obligatorio** — Las URLs HTTP se rechazan en tiempo de validación
- **Controlado por RBAC** — Todos los endpoints requieren permiso `servicenow.manage`

---

## Solución de Problemas

### Problemas de Conexión

| Síntoma | Causa | Solución |
|---------|-------|----------|
| `HTTP 401: Unauthorized` | Credenciales incorrectas | Vuelva a ingresar usuario/contraseña |
| `HTTP 403: Forbidden` | Roles insuficientes | Otorgue `itil` y `cmdb_read` a la cuenta |
| `Connection failed: timed out` | Bloqueo de firewall | Verifique reglas y lista de IPs permitidas |

### Problemas de Sincronización

| Síntoma | Causa | Solución |
|---------|-------|----------|
| 0 registros obtenidos | Tabla o filtro incorrecto | Verifique nombre de tabla; simplifique consulta |
| Todos los registros son «crear» | Error de identidad | Marque `name` como campo de identidad |
| Conteo alto de errores | Fallos de transformación | Revise registros en staging para mensajes de error |
| Eliminaciones omitidas | Ratio excedido | Aumente umbral o investigue por qué desaparecieron CIs |
