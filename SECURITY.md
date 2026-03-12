# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Older versions | Best-effort only |

We recommend always running the latest version of Turbo EA.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Email your report to the maintainers (see the repository's contact information).
3. Include as much detail as possible: steps to reproduce, affected versions, and potential impact.
4. You will receive an acknowledgment within 48 hours.

We aim to release a fix within 7 days of confirming a vulnerability.

## Security Measures

Turbo EA implements the following security controls:

- **Authentication**: JWT (HS256) with bcrypt password hashing, configurable token expiry, and SSO support (Microsoft Entra ID, Google, Okta, Generic OIDC).
- **Authorization**: Multi-level RBAC with app-level roles, per-card stakeholder roles, and 50+ granular permission keys.
- **Encryption at rest**: Fernet symmetric encryption for database-stored secrets (SSO client secrets, SMTP passwords) via `encrypt_value()`/`decrypt_value()`.
- **Input validation**: Pydantic schemas on all API endpoints; SQLAlchemy ORM (no raw SQL).
- **Rate limiting**: slowapi rate limiter on authentication endpoints.
- **Docker hardening**: Non-root users, `cap_drop: ALL`, `no-new-privileges: true`, memory limits.
- **Security headers**: CSP, X-Frame-Options, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy via Nginx.
- **Startup protection**: App refuses to start with default `SECRET_KEY` in non-development environments.
- **Dependency scanning**: Dependabot for security-only updates on pip and npm; GitHub Actions pinned and updated monthly.
- **CI security scans**: pip-audit and npm audit run on every PR.
