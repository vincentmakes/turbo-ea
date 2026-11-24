# API Reference

Turbo EA exposes a complete **REST API** that powers everything you can do in the web UI. You can use it to automate inventory updates, integrate with CI/CD pipelines, build custom dashboards, or pull EA data into other tools (BI, GRC, ITSM, spreadsheets).

The complete OpenAPI 3 specification is rendered live further down this page — every endpoint, parameter, and response shape, regenerated from the backend source on every release.

---

## Base URL

All API endpoints live under the `/api/v1` prefix:

```
https://your-domain.example.com/api/v1
```

Locally (default Docker setup):

```
http://localhost:8920/api/v1
```

The single exception is the health endpoint, which is mounted at `/api/health` (no version prefix).

---

## Live OpenAPI Reference

The interactive Swagger UI below is generated directly from the FastAPI source on every release and ships with the user manual — no backend instance required to browse it. Use the filter box to narrow endpoints by tag, expand any operation to see parameters, request/response schemas, and example payloads. The raw spec is downloadable as JSON at [`/api/openapi.json`](/api/openapi.json) for code generators such as `openapi-generator-cli`.

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

!!! info "Trying endpoints against your own instance"
    Try-it-out is intentionally disabled here — the docs site doesn't proxy your API. To send real requests, run Turbo EA in development mode (`ENVIRONMENT=development`) and open `/api/docs` on your own instance: click **Authorize**, paste a JWT (without the `Bearer ` prefix), and use **Try it out**. In production deployments those endpoints are disabled for security; this page remains the read-only browser.

---

## Authentication

All endpoints except `/auth/*`, the health check, and public web portals require a JSON Web Token sent in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

### Obtaining a token

`POST /api/v1/auth/login` with your email and password:

```bash
curl -X POST https://your-domain.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "your-password"}'
```

The response contains an `access_token`:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

Tokens are valid for 24 hours by default (`ACCESS_TOKEN_EXPIRE_MINUTES`). Use `POST /api/v1/auth/refresh` to extend a session without re-entering credentials.

!!! tip "SSO users"
    If your organisation uses Single Sign-On, you cannot log in with email/password. Either ask an administrator to create a service account with a local password for automation, or capture the JWT from the browser's session storage after a normal SSO login (development use only).

### Using the token

```bash
curl https://your-domain.example.com/api/v1/cards \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

---

## Permissions

The API enforces the **same RBAC rules as the web UI**. Every mutating endpoint checks both the caller's app-level role and any stakeholder roles they hold on the affected card. There are no separate "API permissions" or service-account bypasses — automation scripts run with the permissions of the user whose token they use.

If a request fails with `403 Forbidden`, the token is valid but the user lacks the required permission. See the [Users & Roles](users.md) page for the permission registry.

---

## Common Endpoint Groups

The live reference above is the full source of truth; the table below is a quick map of the most-used groups:

| Prefix | Purpose |
|--------|---------|
| `/auth` | Login, register, SSO callback, token refresh, current user info |
| `/cards` | CRUD on cards (the core entity), hierarchy, history, approval, CSV export |
| `/relations` | CRUD on relations between cards |
| `/metamodel` | Card types, fields, sections, subtypes, relation types |
| `/reports` | Dashboard KPIs, portfolio, matrix, lifecycle, dependencies, cost, data quality |
| `/bpm` | Business Process Management — diagrams, elements, flow versions, assessments |
| `/ppm` | Project Master List — initiatives, status reports, WBS, tasks, costs, risks |
| `/turbolens` | AI-powered analysis (vendors, duplicates, security, architecture AI) |
| `/risks` | EA Risk Register (TOGAF Phase G) |
| `/diagrams` | DrawIO diagrams |
| `/soaw` | Statement of Architecture Work documents |
| `/adr` | Architecture Decision Records |
| `/users`, `/roles` | User and role administration (admin only) |
| `/settings` | Application settings (logo, currency, SMTP, AI, module toggles) |
| `/servicenow` | Bi-directional ServiceNow CMDB sync |
| `/events`, `/notifications` | Audit trail and user notifications (incl. SSE stream) |

---

## Pagination, Filtering, and Sorting

List endpoints accept a consistent set of query parameters:

| Parameter | Description |
|-----------|-------------|
| `page` | Page number (1-based) |
| `page_size` | Items per page (default 50, max 200) |
| `sort_by` | Field to sort by (e.g. `name`, `updated_at`) |
| `sort_dir` | `asc` or `desc` |
| `search` | Free-text filter (where supported) |

Resource-specific filters are documented per endpoint in the live reference above (e.g. `/cards` accepts `type`, `status`, `parent_id`, `approval_status`).

---

## Real-Time Events (Server-Sent Events)

`GET /api/v1/events/stream` is a long-lived SSE connection that pushes events as they happen (card created, updated, approved, etc.). The web UI uses it to refresh badges and lists without polling. Any HTTP client that supports SSE can subscribe — useful for building real-time dashboards or external notification bridges.

---

## Code Generation

Because the API is fully described by OpenAPI 3, you can generate type-safe clients in any major language:

```bash
# Download the schema (no running instance needed)
curl https://docs.turbo-ea.org/api/openapi.json -o turbo-ea-openapi.json

# Generate a Python client
openapi-generator-cli generate \
  -i turbo-ea-openapi.json \
  -g python \
  -o ./turbo-ea-client-py

# …or TypeScript, Go, Java, C#, etc.
```

For Python automation, the easiest path is usually `httpx` or `requests` with hand-written calls — the API is small enough that a generator is rarely worth the dependency.

---

## Rate Limiting

Auth-sensitive endpoints (login, register, password reset) are rate-limited via `slowapi` to protect against brute-force attacks. Other endpoints are not rate-limited by default; if you need to throttle a heavy automation script, do so on the client side or behind your reverse proxy.

---

## Versioning and Stability

- The API is versioned via the `/api/v1` prefix. A breaking change would introduce `/api/v2` alongside it.
- Within `v1`, additive changes (new endpoints, new optional fields) can ship in minor and patch releases. Removals or contract changes are reserved for a major version bump.
- The current version is reported by `GET /api/health` so you can detect upgrades from automation.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `/api/docs` returns 404 on your own instance | Swagger UI is disabled in production. Set `ENVIRONMENT=development` and restart the backend, or use the live reference above. |
| Live reference above is empty | Check the browser console — the embed loads `/api/openapi.json`; corporate proxies or strict ad-blockers occasionally block CDN-hosted scripts. |
| `401 Unauthorized` | Token is missing, malformed, or expired. Re-authenticate via `/auth/login` or `/auth/refresh`. |
| `403 Forbidden` | Token is valid but the user lacks the required permission. Check the user's role in [Users & Roles](users.md). |
| `422 Unprocessable Entity` | Pydantic validation failed. The response body lists which fields are invalid and why. |
| CORS errors from a browser app | Add your frontend origin to `ALLOWED_ORIGINS` in `.env` and restart the backend. |
