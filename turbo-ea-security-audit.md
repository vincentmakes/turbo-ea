# Turbo EA — Security Audit Report

**Date:** 15 February 2026
**Auditor:** Claude (automated code review)
**Scope:** Full codebase — backend (Python/FastAPI), frontend (React/TypeScript), infrastructure (Docker, Nginx)
**Codebase:** `turbo-ea-main` (95 Python files, 78 TypeScript/TSX files)

---

## Executive Summary

Turbo EA is a well-structured enterprise architecture management platform built on FastAPI + SQLAlchemy (backend) and React + MUI (frontend). The codebase demonstrates good engineering practices in many areas — parameterised ORM queries, bcrypt password hashing, and proper async patterns.

However, the audit identified **7 critical**, **9 high**, **11 medium**, and **6 low** severity findings that should be addressed before any production deployment. The most significant issues are the wildcard CORS policy combined with credential support, missing authentication on data-rich endpoints, and the default secret key pattern.

---

## Findings by Severity

### CRITICAL — Fix Immediately

#### C1. Wildcard CORS with Credentials

**File:** `backend/app/main.py` (lines 119–124)
**OWASP:** A05:2021 Security Misconfiguration
**CWE:** CWE-942

The application sets `allow_origins=["*"]` together with `allow_credentials=True`. This is a dangerous combination that most browsers block for credentialed requests, but misconfigured proxies or older clients can exploit it. Any malicious site could make authenticated API requests on behalf of a logged-in user.

```python
# CURRENT (VULNERABLE)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Claude Code instructions:**

```
Fix the CORS middleware in backend/app/main.py.

Replace the wildcard allow_origins=["*"] with an environment variable ALLOWED_ORIGINS 
that defaults to "http://localhost:8920" for development.

In backend/app/config.py, add:
    ALLOWED_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:8920").split(",")
    ]

In backend/app/main.py, change the CORSMiddleware to:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

Add ALLOWED_ORIGINS to docker-compose.yml environment section with a sensible default.
```

---

#### C2. Default Secret Key in Production

**File:** `backend/app/config.py` (line 21)
**OWASP:** A02:2021 Cryptographic Failures
**CWE:** CWE-798

The JWT signing key defaults to `"change-me-in-production"` and the docker-compose file uses `"dev-secret-key-change-in-production"`. If either default is used in production, any attacker can forge valid JWT tokens for any user including admin.

**Claude Code instructions:**

```
Modify backend/app/config.py to refuse startup with a default secret key in 
non-development environments.

Add a startup check in the lifespan function of backend/app/main.py:
    import os
    if settings.SECRET_KEY in ("change-me-in-production", "dev-secret-key-change-in-production"):
        env = os.getenv("ENVIRONMENT", "development")
        if env != "development":
            raise RuntimeError(
                "SECRET_KEY must be set to a strong random value in production. "
                "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
            )

Also remove the default value from docker-compose.yml SECRET_KEY — make it a 
required variable instead of providing a fallback.
```

---

#### C3. Missing Authentication on Sensitive Read Endpoints

**Files:** `backend/app/api/v1/reports.py`, `backend/app/api/v1/bpm_reports.py`, `backend/app/api/v1/metamodel.py`, `backend/app/api/v1/events.py`
**OWASP:** A01:2021 Broken Access Control
**CWE:** CWE-306

Multiple endpoint modules expose the entire enterprise architecture dataset without any authentication:

| Module | Routes | Auth Used | Exposed Data |
|--------|--------|-----------|--------------|
| `reports.py` | 11 | 0 | Dashboard, portfolio, cost data, dependencies, roadmap |
| `bpm_reports.py` | 8 | 0 | Process landscape, maturity, compliance assessments |
| `metamodel.py` | 10 | 0 | Full data schema including field definitions |
| `events.py` | 2 | 0 | Audit trail / activity log |

Additionally in `fact_sheets.py`, the `GET /fact-sheets`, `GET /fact-sheets/{id}`, `GET /fact-sheets/{id}/hierarchy`, `GET /fact-sheets/{id}/history`, `GET /export/csv`, and `POST /fix-hierarchy-names` endpoints require no authentication.

**Claude Code instructions:**

```
Add authentication to all read endpoints across the affected modules.

For each file listed below, add the get_current_user dependency to every 
route handler that currently lacks it:

1. backend/app/api/v1/reports.py
   - Add "from app.api.deps import get_current_user" and "from app.models.user import User"
   - Add parameter "user: User = Depends(get_current_user)" to every @router.get handler

2. backend/app/api/v1/bpm_reports.py  
   - Same pattern as reports.py

3. backend/app/api/v1/metamodel.py
   - Same pattern. Note: GET endpoints that the frontend needs before login 
     (e.g. for schema-driven forms) could use get_optional_user instead, 
     but all write endpoints MUST require full auth.

4. backend/app/api/v1/events.py
   - Same pattern as reports.py

5. backend/app/api/v1/fact_sheets.py
   - Add auth to: list_fact_sheets, get_fact_sheet, get_hierarchy, get_history, export_csv
   - CRITICAL: fix_hierarchy_names is a write endpoint — add auth AND require_admin

6. backend/app/api/v1/documents.py
   - Add auth to list_documents (the GET endpoint)

The public web portal endpoints (/public/{slug}/*) in web_portals.py are 
intentionally public and can remain unauthenticated, but add a comment 
documenting this design decision.
```

---

#### C4. Custom JWT Implementation

**File:** `backend/app/core/security.py`
**OWASP:** A02:2021 Cryptographic Failures
**CWE:** CWE-327

The application implements its own JWT encoding/decoding rather than using an established library like `PyJWT` or `python-jose`. Custom cryptographic implementations are error-prone and miss edge cases (algorithm confusion, timing attacks beyond the HMAC comparison, key management nuances). The current implementation also lacks audience (`aud`) and issuer (`iss`) claims, and has no token refresh mechanism.

**Claude Code instructions:**

```
Replace the custom JWT implementation with PyJWT.

1. Add "PyJWT>=2.9.0" to the dependencies list in backend/pyproject.toml

2. Rewrite backend/app/core/security.py:

   import uuid
   import jwt
   from datetime import datetime, timedelta, timezone
   import bcrypt
   from app.config import settings

   ALGORITHM = "HS256"

   def create_access_token(user_id: uuid.UUID, role: str = "member") -> str:
       now = datetime.now(timezone.utc)
       payload = {
           "sub": str(user_id),
           "role": role,
           "iat": now,
           "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
           "iss": "turbo-ea",
           "aud": "turbo-ea",
       }
       return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)

   def decode_access_token(token: str) -> dict | None:
       try:
           return jwt.decode(
               token,
               settings.SECRET_KEY,
               algorithms=[ALGORITHM],
               issuer="turbo-ea",
               audience="turbo-ea",
           )
       except jwt.PyJWTError:
           return None

   # hash_password and verify_password remain unchanged (bcrypt is correct)

3. Update backend/app/api/deps.py if needed — the decode_access_token interface
   should remain compatible so no other changes are required.
```

---

#### C5. SSO ID Token Not Signature-Verified

**File:** `backend/app/api/v1/auth.py` (lines 38–47, 189)
**OWASP:** A07:2021 Identification and Authentication Failures
**CWE:** CWE-345

The `_decode_jwt_payload` function decodes Microsoft's `id_token` without verifying its signature. The code comments justify this with "trusted because received over TLS from Microsoft", but this is insufficient — it doesn't protect against token replay, man-in-the-middle attacks with compromised TLS, or a misconfigured OAuth flow where the token comes from an untrusted source.

**Claude Code instructions:**

```
Verify the Microsoft id_token signature properly.

1. Add "PyJWT>=2.9.0" and "cryptography>=42.0.0" to backend/pyproject.toml 
   (PyJWT may already be added from C4)

2. Create a new helper function in backend/app/api/v1/auth.py that fetches 
   Microsoft's JWKS and verifies the token:

   import jwt
   from jwt import PyJWKClient

   _jwks_client: PyJWKClient | None = None

   def _get_jwks_client(tenant: str) -> PyJWKClient:
       global _jwks_client
       jwks_url = f"https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys"
       if _jwks_client is None:
           _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
       return _jwks_client

   def _verify_id_token(token: str, client_id: str, tenant: str) -> dict:
       jwks_client = _get_jwks_client(tenant)
       signing_key = jwks_client.get_signing_key_from_jwt(token)
       return jwt.decode(
           token,
           signing_key.key,
           algorithms=["RS256"],
           audience=client_id,
           issuer=f"https://login.microsoftonline.com/{tenant}/v2.0",
       )

3. Replace the _decode_jwt_payload(id_token) call in sso_callback with:
       claims = _verify_id_token(id_token, client_id, tenant)

4. Remove the old _decode_jwt_payload function entirely.
```

---

#### C6. XSS via dangerouslySetInnerHTML with Unsanitized Content

**Files:**
- `frontend/src/features/ea-delivery/SoAWPreview.tsx` (line 187) — renders `bodyHtml`
- `frontend/src/features/ea-delivery/soawExport.ts` (line 592+) — builds HTML from user input without escaping
- `frontend/src/features/bpm/ProcessFlowTab.tsx` (line 925) — renders `svg_thumbnail`
- `frontend/src/features/web-portals/PortalViewer.tsx` (lines 1212–1213) — renders `description`

**OWASP:** A03:2021 Injection
**CWE:** CWE-79

The `buildPreviewBody` function in `soawExport.ts` constructs HTML via string interpolation with user-controlled values (`name`, `docInfo.prepared_by`, version history fields, section content) without HTML escaping. This HTML is rendered via `dangerouslySetInnerHTML`. An attacker could inject `<script>` tags or event handlers through any of these fields.

Similarly, `PortalViewer.tsx` renders fact sheet descriptions directly as HTML, and `ProcessFlowTab.tsx` renders SVG thumbnails without sanitization.

**Claude Code instructions:**

```
Add DOMPurify to sanitise all dangerouslySetInnerHTML usage.

1. Install DOMPurify:
   cd frontend && npm install dompurify @types/dompurify

2. In frontend/src/features/ea-delivery/soawExport.ts, add an HTML escape utility:
   
   function escapeHtml(str: string): string {
     return str
       .replace(/&/g, "&amp;")
       .replace(/</g, "&lt;")
       .replace(/>/g, "&gt;")
       .replace(/"/g, "&quot;")
       .replace(/'/g, "&#x27;");
   }

   Then wrap every user-provided value in buildPreviewBody with escapeHtml():
   - ${escapeHtml(name)} instead of ${name}
   - ${escapeHtml(val)} for doc info values
   - ${escapeHtml(v.version)}, ${escapeHtml(v.date)}, etc. for version history
   
   For section content that legitimately contains HTML from the rich text editor,
   sanitise instead of escaping:
   import DOMPurify from "dompurify";
   Then use: ${DOMPurify.sanitize(content)}

3. In SoAWPreview.tsx, wrap the bodyHtml before rendering:
   import DOMPurify from "dompurify";
   dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(bodyHtml) }}

4. In PortalViewer.tsx (line 1212), sanitise the description:
   import DOMPurify from "dompurify";
   dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedFs.description) }}

5. In ProcessFlowTab.tsx (line 925), sanitise SVG thumbnails:
   import DOMPurify from "dompurify";
   dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(d.svg_thumbnail, { USE_PROFILES: { svg: true } }) }}
```

---

#### C7. No Rate Limiting on Authentication Endpoints

**File:** `backend/app/api/v1/auth.py`, `backend/app/main.py`
**OWASP:** A07:2021 Identification and Authentication Failures
**CWE:** CWE-307

There is no rate limiting anywhere in the application. The login, register, and SSO callback endpoints are all vulnerable to brute-force attacks. An attacker can attempt unlimited password guesses against any user account.

**Claude Code instructions:**

```
Add rate limiting using slowapi.

1. Add "slowapi>=0.1.9" to backend/pyproject.toml dependencies

2. In backend/app/main.py, configure the rate limiter:

   from slowapi import Limiter, _rate_limit_exceeded_handler
   from slowapi.util import get_remote_address
   from slowapi.errors import RateLimitExceeded

   limiter = Limiter(key_func=get_remote_address)
   app.state.limiter = limiter
   app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

3. In backend/app/api/v1/auth.py, apply rate limits:

   from slowapi import Limiter
   from slowapi.util import get_remote_address

   # At the top of each handler:
   @router.post("/login", response_model=TokenResponse)
   @limiter.limit("10/minute")
   async def login(request: Request, body: LoginRequest, ...):

   @router.post("/register", response_model=TokenResponse)
   @limiter.limit("5/minute")
   async def register(request: Request, body: RegisterRequest, ...):

   @router.post("/sso/callback", response_model=TokenResponse)
   @limiter.limit("20/minute")
   async def sso_callback(request: Request, body: SsoCallbackRequest, ...):

   Note: Each handler will need a Request parameter added to its signature.

4. Consider also rate-limiting the password reset and test email endpoints.
```

---

### HIGH — Fix Before Production

#### H1. JWT Token Stored in localStorage

**File:** `frontend/src/api/client.ts` (line 4)
**CWE:** CWE-922

Tokens are stored in `localStorage`, which is accessible to any JavaScript running on the page. Combined with the XSS findings (C6), this means stolen tokens grant full account access. Prefer `httpOnly` cookies or at minimum `sessionStorage`.

**Claude Code instructions:**

```
Migrate token storage from localStorage to httpOnly cookies.

This is a significant architectural change. The recommended approach:

Option A (Simpler — sessionStorage):
   In frontend/src/api/client.ts, replace all localStorage.getItem("token") 
   with sessionStorage.getItem("token") and localStorage.setItem("token", ...) 
   with sessionStorage.setItem("token", ...). Also update:
   - frontend/src/features/bpm/ProcessNavigator.tsx line 1170
   - frontend/src/hooks/useEventStream.ts line 8
   This limits exposure to the current tab/session.

Option B (Recommended — httpOnly cookies):
   This requires backend changes. The auth endpoints should set the JWT as an 
   httpOnly, Secure, SameSite=Strict cookie instead of returning it in the 
   response body. The frontend then stops managing tokens entirely.
   
   Backend changes:
   - In auth.py login/register/sso_callback handlers, set the cookie via response:
     response.set_cookie(
         "access_token", token, httponly=True, secure=True,
         samesite="strict", max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
     )
   - In deps.py get_current_user, read from request.cookies["access_token"] 
     as fallback when Authorization header is absent.
   
   Frontend changes:
   - Remove all localStorage token management
   - Add credentials: "include" to all fetch calls
```

---

#### H2. No Password Complexity Requirements

**Files:** `backend/app/schemas/auth.py`, `backend/app/api/v1/users.py`
**OWASP:** A07:2021 Identification and Authentication Failures
**CWE:** CWE-521

The `RegisterRequest` and `UserCreate` schemas accept any string as a password — including empty strings, single characters, or common passwords.

**Claude Code instructions:**

```
Add password validation to auth schemas.

In backend/app/schemas/auth.py, add a Pydantic validator:

   from pydantic import BaseModel, field_validator

   class RegisterRequest(BaseModel):
       email: str
       display_name: str
       password: str

       @field_validator("password")
       @classmethod
       def validate_password(cls, v: str) -> str:
           if len(v) < 10:
               raise ValueError("Password must be at least 10 characters")
           if not any(c.isupper() for c in v):
               raise ValueError("Password must contain at least one uppercase letter")
           if not any(c.isdigit() for c in v):
               raise ValueError("Password must contain at least one digit")
           return v

Apply the same validator to UserCreate in backend/app/api/v1/users.py and to 
the password field in UserUpdate (when password is not None).

Also add EmailStr validation to RegisterRequest.email (import from pydantic).
```

---

#### H3. No Token Refresh / Revocation Mechanism

**OWASP:** A07:2021 Identification and Authentication Failures
**CWE:** CWE-613

Tokens are valid for 24 hours (`ACCESS_TOKEN_EXPIRE_MINUTES=1440`) with no refresh mechanism and no way to revoke them. If a token is compromised, the attacker has a full 24-hour window. There is also no way to force-logout a user (e.g., after deactivating their account).

**Claude Code instructions:**

```
Implement a token refresh mechanism and reduce token lifetime.

1. Reduce ACCESS_TOKEN_EXPIRE_MINUTES to 30 in config.py and docker-compose.yml

2. Add a /auth/refresh endpoint that issues a new short-lived access token.
   This endpoint should check the user is still active and re-read their role 
   from the database.

3. Add a token_version column to the User model. Increment it when:
   - User is deactivated
   - Password is changed
   - Admin forces logout
   
   Include token_version in the JWT payload and verify it in get_current_user.

4. In the frontend, add a token refresh interceptor that automatically 
   refreshes the token before it expires (e.g., at the 25-minute mark).
```

---

#### H4. Missing Security Headers in Nginx

**File:** `frontend/nginx.conf`
**OWASP:** A05:2021 Security Misconfiguration
**CWE:** CWE-693

The Nginx configuration lacks all standard security headers.

**Claude Code instructions:**

```
Add security headers to frontend/nginx.conf.

Add these headers inside the server block, before the location blocks:

    # Security headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "0" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self';" always;

    # Only add HSTS if behind TLS termination
    # add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

Note: The CSP may need tuning based on actual frontend requirements. 
Start with report-only mode using Content-Security-Policy-Report-Only 
to identify violations before enforcing.

For the DrawIO iframe, the frame-src directive should include 'self' since 
DrawIO is served from the same origin.
```

---

#### H5. Docker Containers Run as Root

**File:** `backend/Dockerfile`
**OWASP:** A05:2021 Security Misconfiguration
**CWE:** CWE-250

The backend Dockerfile does not create or switch to a non-root user. If the application is compromised, the attacker has root access inside the container.

**Claude Code instructions:**

```
Add a non-root user to both Dockerfiles.

In backend/Dockerfile, add after the RUN pip install line:

    RUN addgroup -S appgroup && adduser -S appuser -G appgroup
    USER appuser

In frontend/Dockerfile, add before the EXPOSE line in the production stage:

    RUN chown -R nginx:nginx /usr/share/nginx/html
    USER nginx

Note: The nginx image already has a nginx user, so this should work 
out of the box. Test to ensure nginx can still bind to port 80 
(may need to change to port 8080 and update docker-compose accordingly).
```

---

#### H6. OpenAPI Documentation Exposed

**File:** `backend/app/main.py` (lines 112–116)
**OWASP:** A05:2021 Security Misconfiguration

The Swagger UI (`/api/docs`) and OpenAPI schema (`/api/openapi.json`) are always exposed, giving attackers a complete map of all API endpoints, parameters, and data models.

**Claude Code instructions:**

```
Conditionally disable OpenAPI docs in production.

In backend/app/config.py, add:
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")

In backend/app/main.py, change the FastAPI constructor:

    app = FastAPI(
        title=settings.PROJECT_NAME,
        lifespan=lifespan,
        docs_url="/api/docs" if settings.ENVIRONMENT == "development" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.ENVIRONMENT == "development" else None,
    )
```

---

#### H7. Email Template HTML Injection

**File:** `backend/app/services/email_service.py` (lines 69–94)
**CWE:** CWE-79

The `send_notification_email` function interpolates `title`, `message`, and `link` directly into HTML without escaping. An attacker who can control notification content (e.g., by naming a fact sheet `<img src=x onerror=alert(1)>`) could inject HTML into emails sent to other users.

**Claude Code instructions:**

```
Add HTML escaping to the email template builder.

In backend/app/services/email_service.py, add:

   from html import escape

Then in send_notification_email, escape the interpolated values:

   title = escape(title)
   message = escape(message)
   
   # For the link, validate it starts with / or https:// before including it
   if full_link and not (full_link.startswith("/") or full_link.startswith("https://")):
       full_link = ""
```

---

#### H8. Error Messages Leak Internal Details

**Files:** `backend/app/api/v1/auth.py` (line 185), `backend/app/api/v1/eol.py` (line 253), `backend/app/api/v1/settings.py` (line 180)
**OWASP:** A04:2021 Insecure Design
**CWE:** CWE-209

Exception details from SSO, SMTP, and external API calls are returned directly to users in HTTP error responses, potentially exposing internal configuration, server addresses, and error stack details.

**Claude Code instructions:**

```
Replace detailed error messages with generic ones. Log the details server-side.

In backend/app/api/v1/auth.py line 185:
   # Before: raise HTTPException(401, f"SSO authentication failed: {error_desc}")
   import logging
   logger = logging.getLogger(__name__)
   logger.error("SSO token exchange failed: %s", error_desc)
   raise HTTPException(401, "SSO authentication failed. Please try again.")

In backend/app/api/v1/settings.py line 180:
   logger.error("Test email failed: %s", exc)
   raise HTTPException(502, "Failed to send test email. Check SMTP configuration.")

In backend/app/api/v1/eol.py lines 246-253:
   logger.error("EOL API error for product %s: %s", product, exc)
   raise HTTPException(502, "Unable to fetch product data. Please try again later.")
```

---

#### H9. Unsafe `getattr` for Sort Column Selection

**Files:** `backend/app/api/v1/fact_sheets.py` (line 228), `backend/app/api/v1/web_portals.py` (line 434)
**CWE:** CWE-915

Using `getattr(FactSheet, sort_by, FactSheet.name)` with an unvalidated `sort_by` query parameter allows probing for internal model attributes. While SQLAlchemy won't execute arbitrary SQL, it could expose attribute names or cause unexpected sorting behaviour.

**Claude Code instructions:**

```
Whitelist allowed sort columns.

In both fact_sheets.py and web_portals.py, replace:
   sort_col = getattr(FactSheet, sort_by, FactSheet.name)

With:
   ALLOWED_SORT_COLUMNS = {"name", "type", "status", "created_at", "updated_at", "completion"}
   if sort_by not in ALLOWED_SORT_COLUMNS:
       sort_by = "name"
   sort_col = getattr(FactSheet, sort_by)
```

---

### MEDIUM — Fix in Current Sprint

#### M1. First User Admin Race Condition

**File:** `backend/app/api/v1/auth.py` (lines 68–73)

The registration logic grants admin role to the first user, but the check for existing users and user creation are not atomic. Under concurrent requests, multiple users could be granted admin.

**Claude Code instructions:**

```
Use a database-level advisory lock or unique constraint to prevent 
the race condition. The simplest fix:

In the register handler, wrap the admin check and insert in a 
serializable transaction, or use a SELECT ... FOR UPDATE pattern:

   # After checking email doesn't exist:
   count_result = await db.execute(
       select(func.count(User.id))
   )
   user_count = count_result.scalar()
   user.role = "admin" if user_count == 0 else "member"
   
This is still raceable. For bulletproof safety, add a database trigger 
or use an advisory lock:
   await db.execute(text("SELECT pg_advisory_xact_lock(1)"))  # Lock ID 1
   # ... then do the count and insert
```

---

#### M2. Missing Input Validation on Schema Fields

**File:** `backend/app/schemas/auth.py`

`RegisterRequest.email` uses plain `str` instead of `EmailStr`, so any string is accepted as an email address. The `display_name` field has no length constraints.

**Claude Code instructions:**

```
In backend/app/schemas/auth.py:
   from pydantic import BaseModel, EmailStr, field_validator, Field

   class RegisterRequest(BaseModel):
       email: EmailStr
       display_name: str = Field(..., min_length=1, max_length=200)
       password: str

   class LoginRequest(BaseModel):
       email: EmailStr
       password: str
```

---

#### M3. Unauthenticated Write Endpoint

**File:** `backend/app/api/v1/fact_sheets.py` — `fix_hierarchy_names`

The `POST /fact-sheets/fix-hierarchy-names` endpoint modifies fact sheet names in the database without requiring any authentication.

**Claude Code instructions:**

```
Add authentication and admin authorization to fix_hierarchy_names:

   @router.post("/fix-hierarchy-names")
   async def fix_hierarchy_names(
       db: AsyncSession = Depends(get_db),
       user: User = Depends(get_current_user),
   ):
       require_admin(user)
       # ... rest of handler
```

---

#### M4. 24-Hour Token Lifetime

**File:** `backend/app/config.py` (line 22)

A 24-hour token lifetime is excessive for an enterprise application, especially without a revocation mechanism. If a token is compromised, the window of exposure is very wide.

**Resolution:** Covered in H3 above (reduce to 30 minutes with refresh mechanism).

---

#### M5. No Account Lockout After Failed Login Attempts

**File:** `backend/app/api/v1/auth.py`

Even with rate limiting (C7), there is no account-level lockout after repeated failed login attempts.

**Claude Code instructions:**

```
Add a failed_login_attempts and locked_until column to the User model.

In backend/app/models/user.py:
   failed_login_attempts: Mapped[int] = mapped_column(default=0)
   locked_until: Mapped[datetime | None] = mapped_column(nullable=True)

In backend/app/api/v1/auth.py login handler:
   from datetime import datetime, timedelta, timezone

   if user.locked_until and user.locked_until > datetime.now(timezone.utc):
       raise HTTPException(423, "Account temporarily locked. Try again later.")
   
   if not verify_password(body.password, user.password_hash):
       user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
       if user.failed_login_attempts >= 5:
           user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=15)
       await db.commit()
       raise HTTPException(401, "Invalid credentials")
   
   # Reset on successful login
   user.failed_login_attempts = 0
   user.locked_until = None

Generate an Alembic migration for the new columns.
```

---

#### M6. SSRF Risk in EOL Product Endpoint

**File:** `backend/app/api/v1/eol.py` (line 242)

The `product` path parameter is interpolated directly into a URL: `f"{EOL_BASE}/{product}.json"`. While the target is always `endoflife.date`, a crafted product name with `../` or encoded characters could potentially be used for path traversal on the external API.

**Claude Code instructions:**

```
Validate the product parameter against the known product list.

In the get_product_cycles handler, add validation:

   import re
   if not re.match(r"^[a-z0-9][a-z0-9._-]*$", product):
       raise HTTPException(400, "Invalid product name format")

Or better yet, validate against the cached product list:
   products = await _get_all_products()
   if product not in products:
       raise HTTPException(404, "Product not found")
```

---

#### M7. No Request Body Size Limits

**File:** `backend/app/main.py`

There is no global request body size limit configured. Large payloads could be sent to exhaust memory or disk on JSON body endpoints.

**Claude Code instructions:**

```
Add a request body size limit via middleware or uvicorn configuration.

In docker-compose.yml, update the CMD or add environment:
   command: ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", 
             "--log-level", "info", "--limit-max-request-size", "10485760"]

Also add to nginx.conf inside the server block:
   client_max_body_size 10m;
```

---

#### M8. Bulk Update Lacks Authorization Granularity

**File:** `backend/app/api/v1/fact_sheets.py` — `bulk_update`

The bulk update endpoint allows any authenticated user to modify any fact sheet. There are no ownership or role checks per fact sheet.

**Claude Code instructions:**

```
Add role-based checks to the bulk update handler.

At minimum, verify the user has a role of "member" or above:

   @router.patch("/bulk", response_model=list[FactSheetResponse])
   async def bulk_update(
       body: FactSheetBulkUpdate,
       db: AsyncSession = Depends(get_db),
       user: User = Depends(get_current_user),
   ):
       if user.role == "viewer":
           raise HTTPException(403, "Viewers cannot modify fact sheets")
       # ... rest of handler

Consider also logging bulk operations in the audit trail.
```

---

#### M9. No HTTPS Enforcement

**File:** `frontend/nginx.conf`, `docker-compose.yml`

The frontend serves on port 80 (HTTP) with no HTTPS redirect or HSTS header. Tokens and credentials will be transmitted in cleartext unless a reverse proxy handles TLS.

**Claude Code instructions:**

```
At minimum, document that a TLS-terminating reverse proxy is required.

Add a comment block to the top of nginx.conf:
   # IMPORTANT: This nginx instance expects to be behind a TLS-terminating 
   # reverse proxy (e.g., Traefik, Caddy, Cloudflare). Do NOT expose 
   # port 80 directly to the internet.

If self-hosted without a reverse proxy, add TLS to nginx directly 
with certbot/Let's Encrypt or a self-signed certificate.
```

---

#### M10. SVG Upload Allowed for Logo

**File:** `backend/app/api/v1/settings.py` (line 17)

The allowed MIME types for logo upload include `image/svg+xml`. SVG files can contain embedded JavaScript, and since the logo is served back to all users, this creates a stored XSS vector via the `/api/v1/settings/logo` endpoint.

**Claude Code instructions:**

```
Remove SVG from the allowed logo MIME types:

   ALLOWED_LOGO_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}

If SVG logos are required, sanitise the SVG before storing:
   - Remove all <script> tags
   - Remove on* event handler attributes
   - Remove <foreignObject> elements
   - Use a library like defusedxml for parsing
```

---

#### M11. SSO Account Linking Without Verification

**File:** `backend/app/api/v1/auth.py` (lines 197–207)

When a user logs in via SSO and a local account with the same email exists, the accounts are automatically merged — converting the local account to SSO-only and removing the password. This could allow an attacker who controls an email address at the SSO provider to take over an existing local account.

**Claude Code instructions:**

```
Require explicit admin approval or user confirmation before merging accounts.

Instead of auto-merging, require the user to authenticate with their 
local password first:

   if user:
       if user.auth_provider == "local":
           # Don't auto-merge — require admin intervention
           raise HTTPException(
               409,
               "A local account with this email already exists. "
               "Contact an administrator to link your SSO account."
           )
```

---

### LOW — Technical Debt

#### L1. Backend Port Directly Exposed

**File:** `docker-compose.yml` (line 18)

The backend port 8000 is published directly, bypassing Nginx. This exposes the API without the proxy's security headers and rate limiting.

**Fix:** Change `"8000:8000"` to `expose: - "8000"` (internal only).

---

#### L2. No Dependency Pinning

**File:** `backend/pyproject.toml`

All dependencies use `>=` minimum version pins with no upper bounds. This could lead to unexpected breaking changes or the introduction of vulnerabilities through auto-updates.

**Fix:** Pin to exact versions or use compatible release specifiers (`~=`).

---

#### L3. Debug Logging of Sensitive Data

Ensure that log statements (particularly around auth, SSO, and email) never log tokens, passwords, or SSO claims. Audit all `logger.info`, `logger.error`, and `print()` calls.

---

#### L4. No CSRF Protection

While the API uses Bearer tokens (which are not automatically attached by browsers), the SSO callback flow and any future cookie-based auth would need CSRF protection. This becomes critical if implementing H1 Option B.

---

#### L5. Missing Database Connection Pooling Configuration

**File:** `backend/app/database.py`

The SQLAlchemy engine is created with default pool settings. For production, configure `pool_size`, `max_overflow`, and `pool_timeout`.

---

#### L6. No Health Check Authentication

**File:** `backend/app/main.py` (line 128)

The `/api/health` endpoint is unauthenticated, which is standard. However, ensure it doesn't leak version information or internal state beyond a simple status response.

---

## Best Practices Checklist for Claude Code

When working on the Turbo EA codebase, follow these practices:

1. **Always add authentication:** Every new endpoint should include `user: User = Depends(get_current_user)` unless there is a documented reason for it to be public.

2. **Validate all inputs:** Use Pydantic's `Field()` constraints, `EmailStr`, `field_validator`, and `Query()` constraints for all user input. Never trust path parameters or query strings.

3. **Escape all outputs:** Any user-provided data that ends up in HTML (email templates, `dangerouslySetInnerHTML`, server-rendered content) must be HTML-escaped or sanitised with DOMPurify.

4. **Whitelist, don't blacklist:** For sort columns, allowed roles, file types, and any enumerated value, use explicit allowlists rather than trying to block bad values.

5. **Use established libraries for crypto:** Never implement custom JWT, hashing, or encryption. Use PyJWT, bcrypt, and the `secrets` module.

6. **Log security events:** Failed logins, role changes, SSO linking, admin actions, and permission denials should all be logged with sufficient context for investigation.

7. **Principle of least privilege:** Container users should be non-root. Database accounts should have minimal permissions. API tokens should have the shortest practical lifetime.

8. **Never leak internal details:** Error messages returned to users should be generic. Log the details server-side for debugging.

9. **Test security changes:** After implementing any fix from this report, verify it with both positive tests (legitimate use still works) and negative tests (attack patterns are blocked).

10. **Dependency management:** Run `pip audit` and `npm audit` regularly. Pin dependencies to known-good versions.

---

## Priority Implementation Order

1. **C2** (Secret Key) — Fastest to fix, highest impact
2. **C1** (CORS) — Quick config change, critical risk
3. **C7** (Rate Limiting) — Protects against brute force immediately
4. **C3** (Missing Auth) — Systematic but straightforward
5. **C6** (XSS) — Install DOMPurify and sanitise all render points
6. **H4** (Security Headers) — Nginx config change
7. **C4** (Custom JWT) — Replace with PyJWT
8. **H2** (Password Policy) — Schema change
9. **C5** (SSO Verification) — Requires PyJWT + JWKS
10. **H5** (Docker non-root) — Container rebuild
11. Everything else by severity

---

*This report was generated by automated code analysis and should be validated by a security professional before production deployment.*
