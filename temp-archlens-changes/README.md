# ArchLens Security Fixes

These files include security fixes identified by CodeQL during the Turbo EA
integration PR. Apply them to the ArchLens repo.

## Files to copy

| Source (this folder) | Destination (archlens repo) | Action |
|---|---|---|
| `server/services/turboea.js` | `server/services/turboea.js` | **NEW** file |
| `server/index.js` | `server/index.js` | **REPLACE** existing |
| `server/db/db.js` | `server/db/db.js` | **REPLACE** existing |

## Security fixes included

### 1. SSRF Protection (Critical) — `turboea.js`

The `parseUrl()` function now validates user-supplied URLs:
- Validates URL structure with `new URL()` constructor
- Restricts to `http:` / `https:` protocols only
- Blocks private/internal IP ranges (localhost, 10.x, 172.16-31.x, 192.168.x,
  `.internal`, `.local`) to prevent Server-Side Request Forgery

### 2. Polynomial Regex Fix (High) — `turboea.js`

Replaced `replace(/\/+$/, '')` (which can cause catastrophic backtracking on
pathological input) with a simple `while (s.endsWith('/'))` loop.

### 3. Sensitive Data in GET Requests (Medium) — `index.js`

The `/api/sync/stream` endpoint previously accepted credentials (email, password,
apiKey) as GET query parameters, which get logged in server access logs, browser
history, and proxy logs.

**Fix**: Added a POST handler (`app.post('/api/sync/stream', handleSyncStream)`)
that accepts credentials in the request body. The GET endpoint is kept for backward
compatibility with LeanIX, but Turbo EA sync now uses POST via `archlens_service.py`.

### 4. Rate Limiting on Static File Serving (High) — `index.js`

The SPA fallback route (`app.get('*', ...)`) serves `index.html` via
`res.sendFile()` without rate limiting, allowing potential abuse.

**Fix**: Added a lightweight in-memory per-IP rate limiter (100 requests/minute)
to the SPA fallback handler. No additional npm dependencies required.

## How to apply

```bash
cd /path/to/archlens
cp /path/to/temp-archlens-changes/server/services/turboea.js server/services/
cp /path/to/temp-archlens-changes/server/index.js server/
cp /path/to/temp-archlens-changes/server/db/db.js server/db/
git add -A && git commit -m "feat: add Turbo EA connector with security hardening"
git push origin main
```

After applying, delete the `temp-archlens-changes/` folder from turbo-ea.
