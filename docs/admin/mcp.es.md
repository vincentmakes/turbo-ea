# Integracion MCP (acceso para herramientas de IA)

Turbo EA incluye un **servidor MCP** (Model Context Protocol) integrado que permite a herramientas de IA — como Claude Desktop, GitHub Copilot, Cursor y VS Code — consultar los datos de EA directamente. Los usuarios se autentican a traves de su proveedor SSO existente, y cada consulta respeta sus permisos individuales.

Esta funcion es **opcional** y **no se inicia automaticamente**. Requiere que SSO este configurado, que el perfil MCP este activado en Docker Compose y que un administrador lo active en la interfaz de configuracion.

---

## Como funciona

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
2. En la primera conexion, la herramienta abre una ventana del navegador para la autenticacion SSO.
3. Tras el inicio de sesion, el servidor MCP emite su propio token de acceso (respaldado por el JWT del usuario en Turbo EA).
4. La herramienta de IA usa este token para todas las solicitudes posteriores. Los tokens se renuevan automaticamente.
5. Cada consulta pasa por el sistema de permisos normal de Turbo EA — los usuarios solo ven los datos a los que tienen acceso.

---

## Requisitos previos

Antes de habilitar MCP, debe tener:

- **SSO configurado y funcionando** — MCP delega la autenticacion a su proveedor SSO (Microsoft Entra ID, Google Workspace, Okta o OIDC generico). Consulte la guia de [Autenticacion y SSO](sso.md).
- **HTTPS con un dominio publico** — El flujo OAuth requiere una URI de redireccion estable. Despliegue detras de un proxy inverso con terminacion TLS (Caddy, Traefik, Cloudflare Tunnel, etc.).

---

## Configuracion

### Paso 1: Iniciar el servicio MCP

El servidor MCP es un perfil opcional de Docker Compose. Agregue `--profile mcp` a su comando de inicio:

```bash
docker compose --profile mcp up --build -d
```

Esto inicia un contenedor Python ligero (puerto 8001, solo interno) junto al backend y frontend. Nginx redirige automaticamente las solicitudes `/mcp/` hacia el.

### Paso 2: Configurar variables de entorno

Agregue estas a su archivo `.env`:

```dotenv
TURBO_EA_PUBLIC_URL=https://su-dominio.ejemplo.com
MCP_PUBLIC_URL=https://su-dominio.ejemplo.com/mcp
```

| Variable | Predeterminado | Descripcion |
|----------|---------------|-------------|
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | La URL publica de su instancia de Turbo EA |
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` | La URL publica del servidor MCP (usada en URIs de redireccion OAuth) |
| `MCP_PORT` | `8001` | Puerto interno del contenedor MCP (raramente necesita cambio) |

### Paso 3: Agregar la URI de redireccion OAuth a su aplicacion SSO

En el registro de aplicacion de su proveedor SSO (el mismo que configuro para el inicio de sesion de Turbo EA), agregue esta URI de redireccion:

```
https://su-dominio.ejemplo.com/mcp/oauth/callback
```

Esto es necesario para el flujo OAuth que autentica a los usuarios cuando se conectan desde su herramienta de IA.

### Paso 4: Habilitar MCP en la configuracion de administrador

1. Vaya a **Configuracion** en el area de administracion.
2. Desplacese hasta la seccion **Integracion MCP**.
3. Active el interruptor para **habilitar** MCP.
4. La interfaz mostrara la URL del servidor MCP e instrucciones de configuracion para compartir con su equipo.

!!! warning
    El interruptor esta deshabilitado si SSO no esta configurado. Configure SSO primero.

---

## Conectar herramientas de IA

Una vez habilitado MCP, comparta la **URL del servidor MCP** con su equipo. Cada usuario la agrega a su herramienta de IA:

### Claude Desktop

1. Abra **Configuracion > Conectores > Agregar conector personalizado**.
2. Ingrese la URL del servidor MCP: `https://su-dominio.ejemplo.com/mcp`
3. Haga clic en **Conectar** — se abre una ventana del navegador para el inicio de sesion SSO.
4. Tras la autenticacion, Claude puede consultar sus datos de EA.

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

**2. Agregar a la configuracion de Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "turbo-ea": {
      "command": "python",
      "args": ["-m", "turbo_ea_mcp", "--stdio"],
      "env": {
        "TURBO_EA_URL": "http://localhost:8000",
        "TURBO_EA_EMAIL": "su@correo.com",
        "TURBO_EA_PASSWORD": "su-contrasena"
      }
    }
  }
}
```

En este modo, el servidor se autentica con correo/contrasena y renueva el token automaticamente en segundo plano.

---

## Capacidades disponibles

El servidor MCP proporciona acceso **solo de lectura** a los datos de EA. No puede crear, modificar ni eliminar nada.

### Herramientas

| Herramienta | Descripcion |
|-------------|-------------|
| `search_cards` | Buscar y filtrar fichas por tipo, estado o texto libre |
| `get_card` | Obtener detalles completos de una ficha por UUID |
| `get_card_relations` | Obtener todas las relaciones conectadas a una ficha |
| `get_card_hierarchy` | Obtener ancestros e hijos de una ficha |
| `list_card_types` | Listar todos los tipos de ficha del metamodelo |
| `get_relation_types` | Listar tipos de relacion, opcionalmente filtrados por tipo de ficha |
| `get_dashboard` | Obtener datos del panel de KPIs (conteos, calidad de datos, aprobaciones) |
| `get_landscape` | Obtener fichas agrupadas por un tipo relacionado |

### Recursos

| URI | Descripcion |
|-----|-------------|
| `turbo-ea://types` | Todos los tipos de ficha del metamodelo |
| `turbo-ea://relation-types` | Todos los tipos de relacion |
| `turbo-ea://dashboard` | KPIs del panel y estadisticas resumidas |

### Prompts guiados

| Prompt | Descripcion |
|--------|-------------|
| `analyze_landscape` | Analisis paso a paso: resumen del panel, tipos, relaciones |
| `find_card` | Buscar una ficha por nombre, obtener detalles y relaciones |
| `explore_dependencies` | Mapear de que depende una ficha y que depende de ella |

---

## Permisos

| Rol | Acceso |
|-----|--------|
| **Administrador** | Configurar ajustes MCP (permiso `admin.mcp`) |
| **Todos los usuarios autenticados** | Consultar datos de EA a traves del servidor MCP (respeta sus permisos existentes a nivel de ficha y aplicacion) |

El permiso `admin.mcp` controla quien puede gestionar la configuracion de MCP. Solo esta disponible para el rol de Administrador por defecto. Los roles personalizados pueden recibir este permiso a traves de la pagina de administracion de Roles.

El acceso a datos a traves de MCP sigue el mismo modelo RBAC que la interfaz web — no hay permisos de datos especificos de MCP.

---

## Seguridad

- **Autenticacion delegada por SSO**: Los usuarios se autentican a traves de su proveedor SSO corporativo. El servidor MCP nunca ve ni almacena contrasenas.
- **OAuth 2.1 con PKCE**: El flujo de autenticacion utiliza Proof Key for Code Exchange (S256) para prevenir la intercepcion de codigos de autorizacion.
- **RBAC por usuario**: Cada consulta MCP se ejecuta con los permisos del usuario autenticado. Sin cuentas de servicio compartidas.
- **Acceso solo de lectura**: El servidor MCP solo puede leer datos. No puede crear, actualizar ni eliminar fichas, relaciones ni ningun otro recurso.
- **Rotacion de tokens**: Los tokens de acceso expiran despues de 1 hora. Los tokens de renovacion duran 30 dias. Los codigos de autorizacion son de un solo uso y expiran despues de 10 minutos.
- **Puerto solo interno**: El contenedor MCP expone el puerto 8001 solo en la red interna de Docker. Todo acceso externo pasa por el proxy inverso Nginx.

---

## Solucion de problemas

| Problema | Solucion |
|----------|----------|
| El interruptor MCP esta deshabilitado en la configuracion | SSO debe estar configurado primero. Vaya a Configuracion > Autenticacion y SSO y configure un proveedor SSO. |
| «host not found» en los registros de Nginx | El servicio MCP no esta en ejecucion. Inicielo con `docker compose --profile mcp up -d`. La configuracion de Nginx maneja esto de forma elegante (respuesta 502, sin caida). |
| La devolucion de llamada OAuth falla | Verifique que agrego `https://su-dominio.ejemplo.com/mcp/oauth/callback` como URI de redireccion en el registro de su aplicacion SSO. |
| La herramienta de IA no puede conectarse | Verifique que `MCP_PUBLIC_URL` coincide con la URL accesible desde la maquina del usuario. Asegurese de que HTTPS funciona. |
| El usuario obtiene resultados vacios | MCP respeta los permisos RBAC. Si un usuario tiene acceso restringido, solo vera las fichas que su rol permite. |
| La conexion se interrumpe despues de 1 hora | La herramienta de IA deberia manejar la renovacion de tokens automaticamente. Si no, reconecte. |
