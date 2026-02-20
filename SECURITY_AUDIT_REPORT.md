# Security Audit Report — Turbo EA

**Date:** 2026-02-20
**Scope:** Full codebase review (backend API, frontend client, infrastructure)
**Method:** Manual source code analysis

---

## Executive Summary

Turbo EA has a **moderate security posture** with several well-implemented controls (account lockout, rate limiting, parameterized queries, non-root containers). However, the audit identified **5 Critical**, **7 High**, **9 Medium**, and **5 Low** severity findings that should be addressed before production deployment.

The most impactful findings are unauthenticated endpoints leaking real-time data, XML External Entity injection, missing authorization checks allowing any user to modify any todo, and absent security headers that leave the frontend vulnerable to XSS.

---

## Findings Summary

| ID | Severity | Category | Title | File |
|----|----------|----------|-------|------|
| C-1 | **Critical** | AuthZ | Unauthenticated SSE event stream | `backend/app/api/v1/events.py:18` |
| C-2 | **Critical** | AuthZ | Unauthenticated relations listing | `backend/app/api/v1/relations.py:39` |
| C-3 | **Critical** | AuthZ | Unauthenticated card todos listing | `backend/app/api/v1/todos.py:60` |
| C-4 | **Critical** | Injection | XXE in BPMN XML parser | `backend/app/services/bpmn_parser.py:47` |
| C-5 | **Critical** | AuthZ | No ownership check on todo update/delete | `backend/app/api/v1/todos.py:103,151` |
| H-1 | High | Headers | Missing Content-Security-Policy header | `frontend/nginx.conf` |
| H-2 | High | Headers | Missing Strict-Transport-Security header | `frontend/nginx.conf` |
| H-3 | High | AuthZ | Todo listing filter bypass (view any user's todos) | `backend/app/api/v1/todos.py:38` |
| H-4 | High | AuthZ | Public portal exposes stakeholder names | `backend/app/api/v1/web_portals.py` |
| H-5 | High | Validation | No URL validation on document links (stored XSS) | `backend/app/schemas/common.py:63` |
| H-6 | High | Validation | No length limit on comment content | `backend/app/schemas/common.py:13` |
| H-7 | High | Secrets | SSO client_secret stored in plaintext in database | `backend/app/api/v1/settings.py:64` |
| M-1 | Medium | Validation | Unbounded JSONB dict fields (attributes, lifecycle) | `backend/app/schemas/card.py:15-16` |
| M-2 | Medium | Validation | Search parameter lacks length limit | `backend/app/api/v1/cards.py` |
| M-3 | Medium | Validation | Report query params not whitelisted | `backend/app/api/v1/reports.py` |
| M-4 | Medium | Secrets | SMTP password stored in plaintext in database | `backend/app/api/v1/settings.py:54` |
| M-5 | Medium | Config | Default database password in docker-compose | `docker-compose.yml:14` |
| M-6 | Medium | Error | Exception details leaked in email test endpoint | `backend/app/api/v1/settings.py` |
| M-7 | Medium | AuthZ | Public portal relation options returns all cards | `backend/app/api/v1/web_portals.py` |
| M-8 | Medium | Infra | No Docker container security options (cap_drop, etc.) | `docker-compose.yml` |
| M-9 | Medium | Deps | xlsx library has known HIGH vulnerability (no upstream fix) | `frontend/package.json` |
| L-1 | Low | Auth | Bcrypt rounds implicit (uses default 12) | `backend/app/core/security.py` |
| L-2 | Low | Validation | UUID parameters not pre-validated (500 instead of 400) | Multiple endpoints |
| L-3 | Low | Logging | Missing structured audit logging for security events | Multiple files |
| L-4 | Low | Config | Long default token expiration (24h) | `backend/app/config.py` |
| L-5 | Low | Docs | CLAUDE.md incorrectly states localStorage (actual: sessionStorage) | `CLAUDE.md` |

---

## Critical Findings

### C-1: Unauthenticated SSE Event Stream

**File:** `backend/app/api/v1/events.py:18-34`

The `/api/v1/events/stream` SSE endpoint requires **no authentication**. Any anonymous client can connect and receive all real-time events broadcast to the system, including card updates, comments, approval changes, and user activity.

```python
@router.get("/stream")
async def event_stream(request: Request):
    # No get_current_user dependency — completely open
    async def generate():
        async for data in event_bus.subscribe():
            if await request.is_disconnected():
                break
            yield data
```

**Impact:** Full information disclosure of all real-time system activity.

**Mitigation:** Add authentication dependency:
```python
@router.get("/stream")
async def event_stream(request: Request, user: User = Depends(get_current_user)):
```

---

### C-2: Unauthenticated Relations Listing

**File:** `backend/app/api/v1/relations.py:39-58`

The `GET /relations` endpoint has **no `get_current_user` dependency**, allowing unauthenticated users to enumerate all relationships between fact sheets.

```python
@router.get("", response_model=list[RelationResponse])
async def list_relations(
    db: AsyncSession = Depends(get_db),
    card_id: str | None = Query(None),
    type: str | None = Query(None),
):
    # No authentication — open to anyone
```

**Impact:** Complete enumeration of the organization's IT architecture relationships.

**Mitigation:** Add authentication and permission check:
```python
async def list_relations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    card_id: str | None = Query(None),
    type: str | None = Query(None),
):
    await PermissionService.require_permission(db, user, "relations.view")
```

---

### C-3: Unauthenticated Card Todos Listing

**File:** `backend/app/api/v1/todos.py:60-65`

The `GET /cards/{card_id}/todos` endpoint has **no authentication at all** — no `get_current_user` dependency, no permission check.

```python
@router.get("/cards/{card_id}/todos")
async def list_card_todos(card_id: str, db: AsyncSession = Depends(get_db)):
    # Completely unauthenticated
    result = await db.execute(
        select(Todo).where(Todo.card_id == uuid.UUID(card_id)).order_by(Todo.created_at.desc())
    )
```

**Impact:** Unauthenticated users can read all todos for any card, potentially exposing internal tasks, assignees, and due dates.

**Mitigation:** Add authentication dependency and permission check.

---

### C-4: XXE in BPMN XML Parser

**File:** `backend/app/services/bpmn_parser.py:47`

The BPMN parser uses `xml.etree.ElementTree.fromstring()` without disabling external entity processing. The `# noqa: S314` comment indicates awareness but no mitigation.

```python
root = ET.fromstring(bpmn_xml)  # noqa: S314
```

**Impact:** An attacker can upload a crafted BPMN XML containing DOCTYPE/ENTITY declarations to:
- Read arbitrary local files from the server
- Perform Billion Laughs denial-of-service attacks
- Exfiltrate data via entity expansion

**Mitigation:** Use `defusedxml`:
```python
from defusedxml.ElementTree import fromstring
root = fromstring(bpmn_xml)
```

---

### C-5: No Ownership Check on Todo Update/Delete

**File:** `backend/app/api/v1/todos.py:103-148` (update), `151-162` (delete)

Both `PATCH /todos/{todo_id}` and `DELETE /todos/{todo_id}` allow **any authenticated user** to modify or delete **any todo in the system**. There is no check that the user is the assignee or creator.

```python
@router.patch("/todos/{todo_id}")
async def update_todo(todo_id: str, body: TodoUpdate, ...):
    result = await db.execute(select(Todo).where(Todo.id == uuid.UUID(todo_id)))
    todo = result.scalar_one_or_none()
    if not todo:
        raise HTTPException(404, "Todo not found")
    # NO ownership check — any user can update any todo
    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(todo, field, value)
```

**Impact:** Any authenticated user can reassign, close, or delete any other user's todos. This is an Insecure Direct Object Reference (IDOR) vulnerability.

**Mitigation:** Add ownership verification:
```python
if todo.assigned_to != user.id and todo.created_by != user.id:
    if not await PermissionService.check_permission(db, user, "admin.todos"):
        raise HTTPException(403, "Not enough permissions")
```

---

## High Findings

### H-1: Missing Content-Security-Policy Header

**File:** `frontend/nginx.conf:7-12`

The nginx configuration includes several security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-XSS-Protection`) but is **missing** `Content-Security-Policy`. Without CSP, inline scripts and eval are unrestricted, significantly increasing XSS risk.

**Mitigation:** Add CSP header to nginx.conf:
```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; frame-src 'self'" always;
```
Note: The DrawIO iframe requires `frame-src 'self'`. Adjust CSP directives based on actual frontend requirements (e.g., if MUI injects inline styles, `'unsafe-inline'` for `style-src` may be needed).

---

### H-2: Missing Strict-Transport-Security Header

**File:** `frontend/nginx.conf`

No HSTS header is configured. Even if deployed behind a TLS-terminating proxy, the browser has no instruction to enforce HTTPS-only access, leaving users vulnerable to SSL-stripping attacks.

**Mitigation:** Add to nginx.conf:
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

---

### H-3: Todo Listing Filter Bypass

**File:** `backend/app/api/v1/todos.py:38-57`

The `GET /todos` endpoint defaults to showing only the current user's todos (`mine=True`), but any user can query `?assigned_to=<other-user-uuid>` to see all todos assigned to any other user.

```python
if assigned_to:
    q = q.where(Todo.assigned_to == uuid.UUID(assigned_to))
elif mine:
    q = q.where(
        (Todo.assigned_to == user.id) | (Todo.created_by == user.id)
    )
```

**Impact:** Any authenticated user can enumerate all todos for any other user by providing their UUID.

**Mitigation:** Validate that `assigned_to` matches the current user or require admin permission:
```python
if assigned_to:
    target_id = uuid.UUID(assigned_to)
    if target_id != user.id:
        await PermissionService.require_permission(db, user, "admin.todos")
    q = q.where(Todo.assigned_to == target_id)
```

---

### H-4: Public Portal Exposes Stakeholder Names

**File:** `backend/app/api/v1/web_portals.py`

The `GET /web-portals/public/{slug}/cards` endpoint (no auth required) returns stakeholder `display_name` values to anonymous visitors. This exposes organizational information (who is responsible for which systems) to the public.

**Mitigation:** Add a `show_stakeholders` toggle to portal `card_config` (similar to existing `show_logo`), defaulting to `false`. Only include stakeholder data in the response when explicitly enabled.

---

### H-5: No URL Validation on Document Links

**File:** `backend/app/schemas/common.py:63-66`

The `DocumentCreate` schema accepts any string as a URL with no validation:

```python
class DocumentCreate(BaseModel):
    name: str
    url: str | None = None  # No validation
    type: str = "link"
```

**Impact:** Allows storing `javascript:`, `data:`, or other dangerous URI schemes. When rendered as clickable links in the frontend, this enables stored XSS.

**Mitigation:** Use Pydantic's `HttpUrl` type:
```python
from pydantic import HttpUrl

class DocumentCreate(BaseModel):
    name: str
    url: HttpUrl | None = None
    type: str = "link"
```

---

### H-6: No Length Limit on Comment Content

**File:** `backend/app/schemas/common.py:13-15`

```python
class CommentCreate(BaseModel):
    content: str  # No max_length
    parent_id: str | None = None
```

**Impact:** Unbounded string input allows arbitrarily large comments to be stored, potentially causing database bloat and denial-of-service. Combined with the lack of backend HTML sanitization, this also increases XSS surface area.

**Mitigation:**
```python
from pydantic import Field

class CommentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)
    parent_id: str | None = None
```

---

### H-7: SSO Client Secret Stored in Plaintext

**File:** `backend/app/api/v1/settings.py:64-68`

The SSO `client_secret` is stored unencrypted in the `app_settings.general_settings` JSONB column. While the GET endpoint masks it for display (`"••••••••"`), the plaintext value is in the database.

```python
class SsoSettingsPayload(BaseModel):
    enabled: bool = False
    client_id: str = ""
    client_secret: str = ""
    tenant_id: str = "organizations"
```

**Impact:** Database backups, leaks, or unauthorized database access exposes the SSO client secret, potentially allowing authentication bypass.

**Mitigation:** Encrypt secrets before storing in the database using `cryptography.fernet` or an external secrets manager.

---

## Medium Findings

### M-1: Unbounded JSONB Dict Fields

**File:** `backend/app/schemas/card.py:15-16`

The `CardCreate` and `CardUpdate` schemas accept `lifecycle: dict | None` and `attributes: dict | None` with no validation on depth, key count, or total size. Deeply nested or extremely large dicts can exhaust memory.

**Mitigation:** Add a Pydantic validator limiting key count and nesting depth. Alternatively, validate against the metamodel's `fields_schema` at the API layer.

---

### M-2: Search Parameter Lacks Length Limit

**File:** `backend/app/api/v1/cards.py`

The `search` query parameter in the card listing endpoint has no `max_length`. Combined with the `%{search}%` LIKE pattern, very long strings can slow down database queries.

**Mitigation:** Add `max_length=200` to the `search` Query parameter.

---

### M-3: Report Query Parameters Not Whitelisted

**File:** `backend/app/api/v1/reports.py`

The portfolio report endpoint accepts arbitrary strings for `x_axis`, `y_axis`, `size_field`, and `color_field` parameters. While SQLAlchemy prevents SQL injection, invalid field names can cause unexpected errors.

**Mitigation:** Validate these parameters against a whitelist of known field keys.

---

### M-4: SMTP Password Stored in Plaintext

**File:** `backend/app/api/v1/settings.py:50-57`

Same issue as H-7 but for SMTP credentials. The `smtp_password` is stored unencrypted in `app_settings.email_settings` JSONB.

**Mitigation:** Encrypt SMTP credentials before database storage.

---

### M-5: Default Database Password in Docker Compose

**File:** `docker-compose.yml:14`

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
```

The `POSTGRES_PASSWORD` has a weak default fallback `changeme`. Note: `SECRET_KEY` correctly uses `${SECRET_KEY:?...}` (required), but POSTGRES_PASSWORD does not.

**Mitigation:** Change to required syntax:
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env}
```

---

### M-6: Exception Details Leaked in Email Test

**File:** `backend/app/api/v1/settings.py`

The test email endpoint exposes internal exception details to the client:
```python
raise HTTPException(502, f"Failed to send test email: {exc}") from exc
```

**Mitigation:** Return a generic error message and log the details server-side.

---

### M-7: Public Portal Relation Options Unrestricted

**File:** `backend/app/api/v1/web_portals.py`

The `GET /web-portals/public/{slug}/relation-options` endpoint returns all active cards of a type regardless of portal filters, potentially exposing card names that should not be visible through the portal.

**Mitigation:** Apply the portal's configured filters to the relation options query.

---

### M-8: No Docker Container Security Options

**File:** `docker-compose.yml`

Neither container has `cap_drop`, `security_opt`, or resource limits configured.

**Mitigation:** Add to both services:
```yaml
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
deploy:
  resources:
    limits:
      memory: 512M
```

---

### M-9: Known Vulnerability in xlsx Library

**File:** `frontend/package.json`

The `xlsx` (SheetJS) library has a known HIGH severity vulnerability (Prototype Pollution + ReDoS) with no upstream fix available.

**Mitigation:** Add strict file size limits on Excel imports, implement parsing timeouts, and monitor SheetJS for patches. Evaluate alternatives like `exceljs`.

---

## Low Findings

### L-1: Implicit Bcrypt Rounds

**File:** `backend/app/core/security.py`

`bcrypt.gensalt()` is called without specifying rounds. Default is 12, which is acceptable, but should be explicit for auditability.

**Mitigation:** Use `bcrypt.gensalt(rounds=12)`.

---

### L-2: UUID Parameters Not Pre-validated

**File:** Multiple endpoints

Path/query parameters like `card_id: str` are converted to UUID inside the handler with `uuid.UUID(card_id)`. If invalid, this raises an uncaught `ValueError` resulting in a 500 error instead of a clean 400.

**Mitigation:** Add try/except or use Pydantic UUID type for path parameters.

---

### L-3: Missing Structured Audit Logging

Security events (successful logins, permission changes, data access) are not consistently logged in a structured format suitable for SIEM integration.

**Mitigation:** Implement JSON-structured logging for security-relevant events.

---

### L-4: Long Default Token Expiration

**File:** `backend/app/config.py`

Default `ACCESS_TOKEN_EXPIRE_MINUTES=1440` (24 hours). A stolen token remains valid for a long time. The existing refresh endpoint (`POST /auth/refresh`) mitigates this by re-validating user status, and the frontend refreshes every 10 minutes.

**Mitigation:** Consider reducing to 60 minutes with the existing refresh mechanism handling renewals.

---

### L-5: Documentation Inaccuracy

**File:** `CLAUDE.md`

States "Token stored in `localStorage.token`" but actual code uses `sessionStorage`. Also states "no PyJWT dependency" but the code uses the `PyJWT` library. These inaccuracies could mislead future security reviewers.

**Mitigation:** Update CLAUDE.md to reflect actual implementation.

---

## Positive Findings

The following security controls are correctly implemented:

| Control | Status | Location |
|---------|--------|----------|
| Parameterized SQL queries (SQLAlchemy ORM) | Implemented | All database queries |
| JWT with PyJWT (HS256, iss/aud validation) | Implemented | `core/security.py` |
| Bcrypt password hashing | Implemented | `core/security.py` |
| Account lockout (5 attempts, 15 min) | Implemented | `auth.py:136-146` |
| Rate limiting on auth endpoints | Implemented | `auth.py` (5/min register, 10/min login) |
| CORS restricted to configured origins | Implemented | `main.py:256-263` |
| Non-root Docker containers | Implemented | Both Dockerfiles |
| Backend not exposed to host | Implemented | `docker-compose.yml:23-24` |
| SECRET_KEY required in docker-compose | Implemented | `docker-compose.yml:20` |
| OpenAPI docs disabled in production | Implemented | `main.py:243-250` |
| Advisory lock on first-user registration | Implemented | `auth.py:79-84` |
| SSO prevents local account auto-merge | Implemented | `auth.py:305-325` |
| Generic login error messages (no user enumeration) | Implemented | `auth.py` |
| Token stored in sessionStorage (not localStorage) | Implemented | `client.ts:16-24` |
| Token refresh with user re-validation | Implemented | `auth.py:176-186` |
| Slug validation regex for web portals | Implemented | `web_portals.py:27` |
| SSRF prevention regex on EOL proxy | Implemented | `eol.py` |
| Comment edit/delete checks ownership | Implemented | `comments.py:110-114` |
| SSE queue size bounded (256) | Implemented | `event_bus.py` |
| Password policy (10 chars, uppercase, digit) | Implemented | `schemas/auth.py` |
| Email validation with Pydantic EmailStr | Implemented | `schemas/auth.py` |
| Logo upload MIME type + size validation | Implemented | `settings.py:28-29` |

---

## Prioritized Mitigation Plan

### Phase 1 — Critical (Before Production)

| ID | Action | Effort |
|----|--------|--------|
| C-1 | Add `get_current_user` dependency to `/events/stream` | Small |
| C-2 | Add `get_current_user` + permission check to `GET /relations` | Small |
| C-3 | Add `get_current_user` + permission check to `GET /cards/{card_id}/todos` | Small |
| C-4 | Replace `ET.fromstring` with `defusedxml.ElementTree.fromstring` | Small |
| C-5 | Add ownership check to `PATCH /todos/{id}` and `DELETE /todos/{id}` | Small |

### Phase 2 — High (Before Production or First Sprint After)

| ID | Action | Effort |
|----|--------|--------|
| H-1 | Add `Content-Security-Policy` header to nginx.conf | Medium |
| H-2 | Add `Strict-Transport-Security` header to nginx.conf | Small |
| H-3 | Restrict `assigned_to` query param to self or require admin | Small |
| H-4 | Add `show_stakeholders` toggle to portal card_config | Medium |
| H-5 | Change `DocumentCreate.url` to `HttpUrl` type | Small |
| H-6 | Add `max_length=10000` to `CommentCreate.content` | Small |
| H-7 | Encrypt SSO client_secret before database storage | Medium |

### Phase 3 — Medium (Post-Launch Improvement)

| ID | Action | Effort |
|----|--------|--------|
| M-1 | Add Pydantic validators for JSONB dict depth/size | Medium |
| M-2 | Add `max_length=200` to search query parameter | Small |
| M-3 | Whitelist valid field names in report query params | Small |
| M-4 | Encrypt SMTP password in database | Medium |
| M-5 | Make POSTGRES_PASSWORD required in docker-compose | Small |
| M-6 | Sanitize exception details in email test endpoint | Small |
| M-7 | Apply portal filters to relation options query | Small |
| M-8 | Add `cap_drop`, `no-new-privileges`, resource limits to compose | Small |
| M-9 | Add file size/timeout limits for Excel imports | Medium |

### Phase 4 — Low Priority

| ID | Action | Effort |
|----|--------|--------|
| L-1 | Make bcrypt rounds explicit | Small |
| L-2 | Add UUID pre-validation on path parameters | Small |
| L-3 | Implement structured JSON audit logging | Medium |
| L-4 | Reduce default token expiration to 60 minutes | Small |
| L-5 | Fix CLAUDE.md documentation inaccuracies | Small |

---

## OWASP Top 10 (2021) Coverage

| Category | Status | Relevant Findings |
|----------|--------|-------------------|
| A01: Broken Access Control | **Vulnerable** | C-1, C-2, C-3, C-5, H-3, H-4 |
| A02: Cryptographic Failures | **Partial** | H-7, M-4 (plaintext secrets in DB) |
| A03: Injection | **Vulnerable** | C-4 (XXE), H-5 (stored XSS via URL) |
| A04: Insecure Design | OK | Metamodel-driven architecture is sound |
| A05: Security Misconfiguration | **Partial** | H-1, H-2, M-5, M-8 |
| A06: Vulnerable Components | **Partial** | M-9 (xlsx) |
| A07: Auth Failures | OK | JWT, bcrypt, lockout all implemented |
| A08: Data Integrity Failures | OK | Parameterized queries throughout |
| A09: Logging & Monitoring | **Partial** | L-3 |
| A10: SSRF | OK | EOL proxy has regex validation |

---

*End of report. All findings require review and approval before implementation.*
