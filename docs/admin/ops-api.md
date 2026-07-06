# Ops API (managed deployments)

The ops API (`/api/v1/ops`) is an **opt-in** management surface used by a Turbo EA
Cloud control plane to operate hosted instances. On a self-hosted installation it is
**disabled by default** — every route answers `404` unless the instance was started
with an `OPS_PUBLIC_KEY` environment variable. There is no billing or licensing
logic anywhere in Turbo EA itself.

## Authentication

Every ops request must be signed with the Ed25519 **private** key held by the
control plane; the instance verifies the signature with the **public** key from
`OPS_PUBLIC_KEY` (base64, raw 32 bytes). The signature covers the HTTP method, the
path with query string, a SHA-256 hash of the body, a timestamp, and a single-use
nonce:

```
canonical = METHOD \n PATH_WITH_QUERY \n sha256(body) \n timestamp \n nonce
```

Headers: `X-Ops-Timestamp` (unix seconds, ±5 minutes), `X-Ops-Nonce` (used once,
replay-protected), `X-Ops-Signature` (base64 Ed25519 signature).

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/ops/info` | Version, user/card counts, database health |
| POST | `/api/v1/ops/rescue-access` | Create a **time-boxed** operator admin account |
| DELETE | `/api/v1/ops/rescue-access` | Revoke a rescue account immediately |
| GET | `/api/v1/ops/export` | Stream the secret-stripped workspace export bundle |

## Rescue access — transparency guarantees

Time-limited operator access ("rescue access") is designed so it can never happen
invisibly:

- **Every grant and revocation notifies all instance admins** in-app *and* by
  email, including the operator's name, the reason given, and the expiry time.
- **Every action is recorded** in the instance's own event log.
- **Expiry is enforced by the instance itself**: rescue accounts carry an
  `access_expires_at` timestamp; expired accounts are rejected at authentication
  time and deactivated by an hourly background task. An outage of the control
  plane can never extend access.
- Rescue accounts use a dedicated reserved address
  (`rescue-…@rescue.turboea.invalid`), so they are easy to recognise in the user
  list and can be deactivated manually at any time.

## Workspace export

`GET /api/v1/ops/export` returns the same bundle as **Admin → Settings →
Migration → Workspace transfer → Export**: the full workspace with all secrets
stripped. The control plane uses it for customer-requested data exports (GDPR data
portability) and for safety backups before upgrades or deletions.
