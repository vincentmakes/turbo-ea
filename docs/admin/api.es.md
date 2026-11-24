# Referencia de la API

Turbo EA expone una **API REST** completa que impulsa todo lo que se puede hacer en la interfaz web. Puede usarla para automatizar actualizaciones de inventario, integrarse con pipelines CI/CD, construir paneles personalizados o llevar datos EA a otras herramientas (BI, GRC, ITSM, hojas de cálculo).

La especificación OpenAPI 3 completa se renderiza en vivo más abajo en esta página: cada endpoint, parámetro y forma de respuesta, regenerada desde el código del backend en cada versión.

---

## URL base

Todos los endpoints de la API viven bajo el prefijo `/api/v1`:

```
https://su-dominio.example.com/api/v1
```

En local (configuración Docker por defecto):

```
http://localhost:8920/api/v1
```

La única excepción es el endpoint de salud, montado en `/api/health` (sin prefijo de versión).

---

## Referencia OpenAPI en vivo

La Swagger UI interactiva siguiente se genera directamente desde el código fuente de FastAPI en cada versión y se entrega con el manual de usuario: no hace falta una instancia de backend para consultarla. Use el filtro para acotar endpoints por etiqueta, despliegue cualquier operación para ver parámetros, esquemas de petición/respuesta y ejemplos. El esquema en bruto se puede descargar en JSON desde [`/api/openapi.json`](/api/openapi.json) para generadores de código como `openapi-generator-cli`.

<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
window.addEventListener('DOMContentLoaded', function () {
  window.SwaggerUIBundle({
    url: '/api/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    filter: true,
    docExpansion: 'list',
    defaultModelsExpandDepth: 1,
    supportedSubmitMethods: []
  });
});
</script>

!!! info "Probar endpoints contra su propia instancia"
    «Try it out» está deliberadamente desactivado aquí: el sitio de documentación no actúa como proxy de su API. Para enviar peticiones reales, ejecute Turbo EA en modo desarrollo (`ENVIRONMENT=development`) y abra `/api/docs` en su propia instancia: haga clic en **Authorize**, pegue un JWT (sin el prefijo `Bearer `) y use **Try it out**. En despliegues de producción esos endpoints están deshabilitados por seguridad; esta página sigue siendo el navegador de solo lectura.

---

## Autenticación

Todos los endpoints excepto `/auth/*`, el chequeo de salud y los portales web públicos requieren un JSON Web Token enviado en la cabecera `Authorization`:

```
Authorization: Bearer <access_token>
```

### Obtener un token

`POST /api/v1/auth/login` con su correo y contraseña:

```bash
curl -X POST https://su-dominio.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "usted@example.com", "password": "su-contraseña"}'
```

La respuesta contiene un `access_token`:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

Los tokens son válidos durante 24 horas por defecto (`ACCESS_TOKEN_EXPIRE_MINUTES`). Use `POST /api/v1/auth/refresh` para extender una sesión sin reintroducir credenciales.

!!! tip "Usuarios SSO"
    Si su organización utiliza inicio de sesión único, no podrá iniciar sesión con correo y contraseña. Pida a un administrador que cree una cuenta de servicio con contraseña local para la automatización, o capture el JWT desde el session storage del navegador tras un inicio SSO normal (solo para desarrollo).

### Usar el token

```bash
curl https://su-dominio.example.com/api/v1/cards \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

---

## Permisos

La API aplica **las mismas reglas RBAC que la interfaz web**. Cada endpoint que muta datos comprueba tanto el rol de aplicación del llamante como cualquier rol de parte interesada que tenga sobre la ficha afectada. No existen «permisos de API» separados ni atajos de cuenta de servicio: los scripts de automatización corren con los permisos del usuario cuyo token usan.

Si una petición falla con `403 Forbidden`, el token es válido pero al usuario le falta el permiso requerido. Consulte la página [Usuarios y roles](users.md) para ver el registro de permisos.

---

## Grupos de endpoints comunes

La referencia en vivo de arriba es la fuente completa de verdad; la siguiente tabla es un mapa rápido de los grupos más usados:

| Prefijo | Propósito |
|---------|-----------|
| `/auth` | Inicio de sesión, registro, callback SSO, refresco de token, datos del usuario actual |
| `/cards` | CRUD de fichas (entidad central), jerarquía, historial, aprobación, exportación CSV |
| `/relations` | CRUD de relaciones entre fichas |
| `/metamodel` | Tipos de ficha, campos, secciones, subtipos, tipos de relación |
| `/reports` | KPI del panel, portafolio, matriz, ciclo de vida, dependencias, coste, calidad de datos |
| `/bpm` | Gestión de procesos de negocio: diagramas, elementos, versiones de flujo, evaluaciones |
| `/ppm` | Lista maestra de proyectos — iniciativas, informes de estado, WBS, tareas, costes y riesgos |
| `/turbolens` | Análisis impulsado por IA (proveedores, duplicados, seguridad, IA de arquitectura) |
| `/risks` | Registro de riesgos EA (Fase G de TOGAF) |
| `/diagrams` | Diagramas DrawIO |
| `/soaw` | Documentos Statement of Architecture Work |
| `/adr` | Architecture Decision Records |
| `/users`, `/roles` | Administración de usuarios y roles (solo admin) |
| `/settings` | Ajustes de la aplicación (logo, divisa, SMTP, IA, interruptores de módulos) |
| `/servicenow` | Sincronización bidireccional con la CMDB de ServiceNow |
| `/events`, `/notifications` | Pista de auditoría y notificaciones de usuario (incluido el flujo SSE) |

---

## Paginación, filtrado y ordenación

Los endpoints de listado aceptan un conjunto coherente de parámetros de consulta:

| Parámetro | Descripción |
|-----------|-------------|
| `page` | Número de página (empieza en 1) |
| `page_size` | Elementos por página (por defecto 50, máximo 200) |
| `sort_by` | Campo de ordenación (por ejemplo `name`, `updated_at`) |
| `sort_dir` | `asc` o `desc` |
| `search` | Filtro de texto libre (donde se admita) |

Los filtros específicos de cada recurso están documentados por endpoint en la referencia en vivo de arriba (p. ej. `/cards` admite `type`, `status`, `parent_id`, `approval_status`).

---

## Eventos en tiempo real (Server-Sent Events)

`GET /api/v1/events/stream` es una conexión SSE de larga duración que envía eventos a medida que ocurren (ficha creada, actualizada, aprobada, etc.). La interfaz web la usa para refrescar contadores y listas sin sondeo. Cualquier cliente HTTP compatible con SSE puede suscribirse: útil para construir paneles en tiempo real o puentes de notificación externos.

---

## Generación de código

Como la API está totalmente descrita por OpenAPI 3, puede generar clientes con tipado estático en cualquier lenguaje principal:

```bash
# Descargar el esquema (no hace falta una instancia en ejecución)
curl https://docs.turbo-ea.org/api/openapi.json -o turbo-ea-openapi.json

# Generar un cliente Python
openapi-generator-cli generate \
  -i turbo-ea-openapi.json \
  -g python \
  -o ./turbo-ea-client-py

# … o TypeScript, Go, Java, C#, etc.
```

Para automatización en Python, lo más sencillo suele ser `httpx` o `requests` con llamadas escritas a mano: la API es lo bastante pequeña como para que rara vez compense un generador.

---

## Limitación de tasa

Los endpoints sensibles a la autenticación (login, registro, restablecimiento de contraseña) están limitados con `slowapi` para protegerse de ataques de fuerza bruta. Los demás endpoints no están limitados por defecto; si necesita ralentizar un script de automatización pesado, hágalo del lado del cliente o detrás de su proxy inverso.

---

## Versionado y estabilidad

- La API se versiona mediante el prefijo `/api/v1`. Un cambio incompatible introduciría un `/api/v2` en paralelo.
- Dentro de `v1`, los cambios aditivos (nuevos endpoints, nuevos campos opcionales) pueden llegar en versiones menores y de parche. Las eliminaciones o cambios de contrato se reservan para un cambio de versión mayor.
- La versión actual se reporta en `GET /api/health` para que la automatización pueda detectar actualizaciones.

---

## Resolución de problemas

| Problema | Solución |
|----------|----------|
| `/api/docs` devuelve 404 en su propia instancia | Swagger UI está deshabilitada en producción. Defina `ENVIRONMENT=development` y reinicie el backend, o use la referencia en vivo de arriba. |
| La referencia de arriba aparece vacía | Revise la consola del navegador: el embed carga `/api/openapi.json`; ocasionalmente, proxies corporativos o bloqueadores estrictos bloquean los scripts servidos por CDN. |
| `401 Unauthorized` | El token falta, está mal formado o ha expirado. Reautentíquese vía `/auth/login` o `/auth/refresh`. |
| `403 Forbidden` | El token es válido pero al usuario le falta el permiso requerido. Compruebe el rol en [Usuarios y roles](users.md). |
| `422 Unprocessable Entity` | Falló la validación de Pydantic. El cuerpo de la respuesta lista los campos inválidos y el motivo. |
| Errores CORS desde una app de navegador | Añada el origen del frontend a `ALLOWED_ORIGINS` en `.env` y reinicie el backend. |
