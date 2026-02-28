# MCP Integration (AI Tool Access)

Turbo EA includes a built-in **MCP server** (Model Context Protocol) that allows AI tools — such as Claude Desktop, GitHub Copilot, Cursor, and VS Code — to query your EA data directly. Users authenticate through your existing SSO provider, and every query respects their individual permissions.

This feature is **optional** and **does not start automatically**. It requires SSO to be configured, the MCP profile to be activated in Docker Compose, and an admin to toggle it on in the settings UI.

---

## How It Works

```
AI Tool (Claude, Copilot, etc.)
    │
    │  MCP protocol (HTTP + SSE)
    ▼
Turbo EA MCP Server (:8001, internal)
    │
    │  OAuth 2.1 with PKCE
    │  delegates to your SSO provider
    ▼
Turbo EA Backend (:8000)
    │
    │  Per-user RBAC
    ▼
PostgreSQL
```

1. A user adds the MCP server URL to their AI tool.
2. On first connection, the AI tool opens a browser window for SSO authentication.
3. After login, the MCP server issues its own access token (backed by the user's Turbo EA JWT).
4. The AI tool uses this token for all subsequent requests. Tokens refresh automatically.
5. Every query goes through the normal Turbo EA permission system — users only see data they have access to.

---

## Prerequisites

Before enabling MCP, you must have:

- **SSO configured and working** — MCP delegates authentication to your SSO provider (Microsoft Entra ID, Google Workspace, Okta, or generic OIDC). See the [Authentication & SSO](sso.md) guide.
- **HTTPS with a public domain** — The OAuth flow requires a stable redirect URI. Deploy behind a TLS-terminating reverse proxy (Caddy, Traefik, Cloudflare Tunnel, etc.).

---

## Setup

### Step 1: Start the MCP service

The MCP server is an opt-in Docker Compose profile. Add `--profile mcp` to your startup command:

```bash
docker compose --profile mcp up --build -d
```

This starts a lightweight Python container (port 8001, internal only) alongside the backend and frontend. Nginx proxies `/mcp/` requests to it automatically.

### Step 2: Configure environment variables

Add these to your `.env` file:

```dotenv
TURBO_EA_PUBLIC_URL=https://your-domain.example.com
MCP_PUBLIC_URL=https://your-domain.example.com/mcp
```

| Variable | Default | Description |
|----------|---------|-------------|
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | The public URL of your Turbo EA instance |
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` | The public URL of the MCP server (used in OAuth redirect URIs) |
| `MCP_PORT` | `8001` | Internal port for the MCP container (rarely needs changing) |

### Step 3: Add the OAuth redirect URI to your SSO app

In your SSO provider's app registration (the same one you set up for Turbo EA login), add this redirect URI:

```
https://your-domain.example.com/mcp/oauth/callback
```

This is required for the OAuth flow that authenticates users when they connect from their AI tool.

### Step 4: Enable MCP in admin settings

1. Go to **Settings** in the admin area.
2. Scroll to the **MCP Integration** section.
3. Toggle the switch to **enable** MCP.
4. The UI will show the MCP Server URL and setup instructions to share with your team.

!!! warning
    The toggle is disabled if SSO is not configured. Set up SSO first.

---

## Connecting AI Tools

Once MCP is enabled, share the **MCP Server URL** with your team. Each user adds it to their AI tool:

### Claude Desktop

1. Open **Settings > Connectors > Add custom connector**.
2. Enter the MCP server URL: `https://your-domain.example.com/mcp`
3. Click **Connect** — a browser window opens for SSO login.
4. After authentication, Claude can query your EA data.

### VS Code (GitHub Copilot / Cursor)

Add to your workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "turbo-ea": {
      "type": "http",
      "url": "https://your-domain.example.com/mcp/mcp"
    }
  }
}
```

The double `/mcp/mcp` is intentional — the first `/mcp/` is the Nginx proxy path, the second is the MCP protocol endpoint.

---

## Local Testing (stdio mode)

For local development or testing without SSO/HTTPS, you can run the MCP server in **stdio mode** — Claude Desktop spawns it directly as a local process.

**1. Install the MCP server package:**

```bash
pip install ./mcp-server
```

**2. Add to your Claude Desktop config** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "turbo-ea": {
      "command": "python",
      "args": ["-m", "turbo_ea_mcp", "--stdio"],
      "env": {
        "TURBO_EA_URL": "http://localhost:8000",
        "TURBO_EA_EMAIL": "your@email.com",
        "TURBO_EA_PASSWORD": "your-password"
      }
    }
  }
}
```

In this mode, the server authenticates with email/password and refreshes the token automatically in the background.

---

## Available Capabilities

The MCP server provides **read-only** access to EA data. It cannot create, modify, or delete anything.

### Tools

| Tool | Description |
|------|-------------|
| `search_cards` | Search and filter cards by type, status, or free text |
| `get_card` | Get full details of a card by UUID |
| `get_card_relations` | Get all relations connected to a card |
| `get_card_hierarchy` | Get ancestors and children of a card |
| `list_card_types` | List all card types in the metamodel |
| `get_relation_types` | List relation types, optionally filtered by card type |
| `get_dashboard` | Get KPI dashboard data (counts, data quality, approvals) |
| `get_landscape` | Get cards grouped by a related type |

### Resources

| URI | Description |
|-----|-------------|
| `turbo-ea://types` | All card types in the metamodel |
| `turbo-ea://relation-types` | All relation types |
| `turbo-ea://dashboard` | Dashboard KPIs and summary statistics |

### Guided Prompts

| Prompt | Description |
|--------|-------------|
| `analyze_landscape` | Multi-step analysis: dashboard overview, types, relationships |
| `find_card` | Search for a card by name, get details and relations |
| `explore_dependencies` | Map what a card depends on and what depends on it |

---

## Permissions

| Role | Access |
|------|--------|
| **Admin** | Configure MCP settings (`admin.mcp` permission) |
| **All authenticated users** | Query EA data through the MCP server (respects their existing card-level and app-level permissions) |

The `admin.mcp` permission controls who can manage MCP settings. It is only available to the Admin role by default. Custom roles can be granted this permission through the Roles administration page.

Data access through MCP follows the same RBAC model as the web UI — there are no separate MCP-specific data permissions.

---

## Security

- **SSO-delegated authentication**: Users authenticate via their corporate SSO provider. The MCP server never sees or stores passwords.
- **OAuth 2.1 with PKCE**: The authentication flow uses Proof Key for Code Exchange (S256) to prevent authorization code interception.
- **Per-user RBAC**: Every MCP query is executed with the authenticated user's permissions. No shared service accounts.
- **Read-only access**: The MCP server can only read data. It cannot create, update, or delete cards, relations, or any other resources.
- **Token rotation**: Access tokens expire after 1 hour. Refresh tokens last 30 days. Authorization codes are single-use and expire after 10 minutes.
- **Internal-only port**: The MCP container exposes port 8001 only on the internal Docker network. All external access goes through the Nginx reverse proxy.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| MCP toggle is disabled in settings | SSO must be configured first. Go to Settings > Authentication & SSO and set up an SSO provider. |
| "host not found" in Nginx logs | The MCP service is not running. Start it with `docker compose --profile mcp up -d`. The Nginx config handles this gracefully (502 response, no crash). |
| OAuth callback fails | Verify you added `https://your-domain.example.com/mcp/oauth/callback` as a redirect URI in your SSO app registration. |
| AI tool cannot connect | Check that `MCP_PUBLIC_URL` matches the URL accessible from the user's machine. Ensure HTTPS is working. |
| User gets empty results | MCP respects RBAC permissions. If a user has restricted access, they will only see the cards their role allows. |
| Connection drops after 1 hour | The AI tool should handle token refresh automatically. If not, reconnect. |
