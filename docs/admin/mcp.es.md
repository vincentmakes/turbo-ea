# Integración MCP (acceso para herramientas de IA)

Turbo EA incluye un **servidor MCP** (Model Context Protocol) integrado que permite a herramientas de IA — como Claude Desktop, GitHub Copilot, Cursor y VS Code — consultar los datos de EA directamente. Los usuarios se autentican a través de su proveedor SSO existente, y cada consulta respeta sus permisos individuales.

Esta función es **opcional** y **no se inicia automáticamente**. Requiere que SSO esté configurado, que el perfil MCP esté activado en Docker Compose y que un administrador lo active en la interfaz de configuración.

---

## Cómo funciona

```
Herramienta de IA (Claude, Copilot, etc.)
    │
    │  Protocolo MCP (HTTP + SSE)
    ▼
Servidor MCP de Turbo EA (:8001, interno)
    │
    │  OAuth 2.1 con PKCE
    │  delega al proveedor SSO
    ▼
Backend de Turbo EA (:8000)
    │
    │  RBAC por usuario
    ▼
PostgreSQL
```

1. Un usuario agrega la URL del servidor MCP a su herramienta de IA.
2. En la primera conexión, la herramienta abre una ventana del navegador para la autenticación SSO.
3. Tras el inicio de sesión, el servidor MCP emite su propio token de acceso (respaldado por el JWT del usuario en Turbo EA).
4. La herramienta de IA usa este token para todas las solicitudes posteriores. Los tokens se renuevan automáticamente.
5. Cada consulta pasa por el sistema de permisos normal de Turbo EA — los usuarios solo ven los datos a los que tienen acceso.

---

## Requisitos previos

Antes de habilitar MCP, debe tener:

- **SSO configurado y funcionando** — MCP delega la autenticación a su proveedor SSO (Microsoft Entra ID, Google Workspace, Okta o OIDC genérico). Consulte la guía de [Autenticación y SSO](sso.md).
- **HTTPS con un dominio público** — El flujo OAuth requiere una URI de redirección estable. Despliegue detrás de un proxy inverso con terminación TLS (Caddy, Traefik, Cloudflare Tunnel, etc.).

---

## Configuración

### Paso 1: Iniciar el servicio MCP

El servidor MCP es un perfil opcional de Docker Compose. Agregue `--profile mcp` a su comando de inicio:

```bash
docker compose --profile mcp up --build -d
```

Esto inicia un contenedor Python ligero (puerto 8001, solo interno) junto al backend y frontend. Nginx redirige automáticamente las solicitudes `/mcp/` hacia él.

### Paso 2: Configurar variables de entorno

Agregue estas a su archivo `.env`:

```dotenv
TURBO_EA_PUBLIC_URL=https://su-dominio.ejemplo.com
MCP_PUBLIC_URL=https://su-dominio.ejemplo.com/mcp
```

| Variable | Predeterminado | Descripción |
|----------|---------------|-------------|
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | La URL pública de su instancia de Turbo EA |
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` | La URL pública del servidor MCP (usada en URIs de redirección OAuth) |
| `MCP_PORT` | `8001` | Puerto interno del contenedor MCP (raramente necesita cambio) |

### Paso 3: Agregar la URI de redirección OAuth a su aplicación SSO

En el registro de aplicación de su proveedor SSO (el mismo que configuró para el inicio de sesión de Turbo EA), agregue esta URI de redirección:

```
https://su-dominio.ejemplo.com/mcp/oauth/callback
```

Esto es necesario para el flujo OAuth que autentica a los usuarios cuando se conectan desde su herramienta de IA.

### Paso 4: Habilitar MCP en la configuración de administrador

1. Vaya a **Configuración** en el área de administración y seleccione la pestaña **IA**.
2. Desplácese hasta la sección **Integración MCP (Acceso a herramientas IA)**.
3. Active el interruptor para **habilitar** MCP.
4. La interfaz mostrará la URL del servidor MCP e instrucciones de configuración para compartir con su equipo.

!!! warning
    El interruptor está deshabilitado si SSO no está configurado. Configure SSO primero.

---

## Conectar herramientas de IA

Una vez habilitado MCP, comparta la **URL del servidor MCP** con su equipo. Cada usuario la agrega a su herramienta de IA:

### Claude Desktop

1. Abra **Configuración > Conectores > Agregar conector personalizado**.
2. Ingrese la URL del servidor MCP: `https://su-dominio.ejemplo.com/mcp`
3. Haga clic en **Conectar** — se abre una ventana del navegador para el inicio de sesión SSO.
4. Tras la autenticación, Claude puede consultar sus datos de EA.

### VS Code (GitHub Copilot / Cursor)

Agregue a su `.vscode/mcp.json` del espacio de trabajo:

```json
{
  "servers": {
    "turbo-ea": {
      "type": "http",
      "url": "https://su-dominio.ejemplo.com/mcp/mcp"
    }
  }
}
```

El doble `/mcp/mcp` es intencional — el primer `/mcp/` es la ruta del proxy Nginx, el segundo es el punto de acceso del protocolo MCP.

---

## Prueba local (modo stdio)

Para desarrollo local o pruebas sin SSO/HTTPS, puede ejecutar el servidor MCP en **modo stdio** — Claude Desktop lo inicia directamente como proceso local.

**1. Instalar el paquete del servidor MCP:**

```bash
pip install ./mcp-server
```

**2. Agregar a la configuración de Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "turbo-ea": {
      "command": "python",
      "args": ["-m", "turbo_ea_mcp", "--stdio"],
      "env": {
        "TURBO_EA_URL": "http://localhost:8000",
        "TURBO_EA_EMAIL": "su@correo.com",
        "TURBO_EA_PASSWORD": "su-contraseña"
      }
    }
  }
}
```

En este modo, el servidor se autentica con correo/contraseña y renueva el token automáticamente en segundo plano.

---

## Capacidades disponibles

El servidor MCP proporciona acceso **solo de lectura** a los datos de EA. No puede crear, modificar ni eliminar nada.

### Herramientas

| Herramienta | Descripción |
|-------------|-------------|
| `search_cards` | Buscar y filtrar fichas por tipo, estado o texto libre |
| `get_card` | Obtener detalles completos de una ficha por UUID |
| `get_card_relations` | Obtener todas las relaciones conectadas a una ficha |
| `get_card_hierarchy` | Obtener ancestros e hijos de una ficha |
| `list_card_types` | Listar todos los tipos de ficha del metamodelo |
| `get_relation_types` | Listar tipos de relación, opcionalmente filtrados por tipo de ficha |
| `get_dashboard` | Obtener datos del panel de KPIs (conteos, calidad de datos, aprobaciones) |
| `get_landscape` | Obtener fichas agrupadas por un tipo relacionado |

### Recursos

| URI | Descripción |
|-----|-------------|
| `turbo-ea://types` | Todos los tipos de ficha del metamodelo |
| `turbo-ea://relation-types` | Todos los tipos de relación |
| `turbo-ea://dashboard` | KPIs del panel y estadísticas resumidas |

### Prompts guiados

| Prompt | Descripción |
|--------|-------------|
| `analyze_landscape` | Análisis paso a paso: resumen del panel, tipos, relaciones |
| `find_card` | Buscar una ficha por nombre, obtener detalles y relaciones |
| `explore_dependencies` | Mapear de qué depende una ficha y qué depende de ella |

---

## Permisos

| Rol | Acceso |
|-----|--------|
| **Administrador** | Configurar ajustes MCP (permiso `admin.mcp`) |
| **Todos los usuarios autenticados** | Consultar datos de EA a través del servidor MCP (respeta sus permisos existentes a nivel de ficha y aplicación) |

El permiso `admin.mcp` controla quién puede gestionar la configuración de MCP. Solo está disponible para el rol de Administrador por defecto. Los roles personalizados pueden recibir este permiso a través de la página de administración de Roles.

El acceso a datos a través de MCP sigue el mismo modelo RBAC que la interfaz web — no hay permisos de datos específicos de MCP.

---

## Seguridad

- **Autenticación delegada por SSO**: Los usuarios se autentican a través de su proveedor SSO corporativo. El servidor MCP nunca ve ni almacena contraseñas.
- **OAuth 2.1 con PKCE**: El flujo de autenticación utiliza Proof Key for Code Exchange (S256) para prevenir la interceptación de códigos de autorización.
- **RBAC por usuario**: Cada consulta MCP se ejecuta con los permisos del usuario autenticado. Sin cuentas de servicio compartidas.
- **Acceso solo de lectura**: El servidor MCP solo puede leer datos. No puede crear, actualizar ni eliminar fichas, relaciones ni ningún otro recurso.
- **Rotación de tokens**: Los tokens de acceso expiran después de 1 hora. Los tokens de renovación duran 30 días. Los códigos de autorización son de un solo uso y expiran después de 10 minutos.
- **Puerto solo interno**: El contenedor MCP expone el puerto 8001 solo en la red interna de Docker. Todo acceso externo pasa por el proxy inverso Nginx.

---

## Solución de problemas

| Problema | Solución |
|----------|----------|
| El interruptor MCP está deshabilitado en la configuración | SSO debe estar configurado primero. Vaya a Configuración > pestaña Autenticación y configure un proveedor SSO. |
| «host not found» en los registros de Nginx | El servicio MCP no está en ejecución. Inícielo con `docker compose --profile mcp up -d`. La configuración de Nginx maneja esto de forma elegante (respuesta 502, sin caída). |
| La devolución de llamada OAuth falla | Verifique que agregó `https://su-dominio.ejemplo.com/mcp/oauth/callback` como URI de redirección en el registro de su aplicación SSO. |
| La herramienta de IA no puede conectarse | Verifique que `MCP_PUBLIC_URL` coincide con la URL accesible desde la máquina del usuario. Asegúrese de que HTTPS funciona. |
| El usuario obtiene resultados vacíos | MCP respeta los permisos RBAC. Si un usuario tiene acceso restringido, solo verá las fichas que su rol permite. |
| La conexión se interrumpe después de 1 hora | La herramienta de IA debería manejar la renovación de tokens automáticamente. Si no, reconecte. |
