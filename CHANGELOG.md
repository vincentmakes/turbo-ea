# Changelog

All notable changes to Turbo EA are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Dark theme with toggle in account menu, persisted via localStorage
- Dependabot configuration for pip, npm, and GitHub Actions ecosystems
- Security scanning in CI (pip-audit for Python, npm audit for Node)
- Backend test coverage threshold (40% ratchet — prevents regression)
- Structured JSON logging in production (human-readable in development)
- Python lockfile workflow via pip-compile
- Branch protection recommendations documentation

### Changed
- CI pipeline now enforces `--cov-fail-under=40` on backend tests

## [0.5.0] - 2025-12-15

### Added
- ServiceNow CMDB bi-directional sync integration
- Web portals with public slug-based URLs
- Survey system for data-maintenance workflows
- Saved report configurations with thumbnails
- End-of-Life (EOL) tracking via endoflife.date proxy
- Notification system with in-app bell and email delivery
- BPM process flow version approval workflow
- Process assessment scoring (efficiency, effectiveness, compliance)
- BPM reports: maturity dashboard, risk overview, automation analysis
- DrawIO diagram sync panel (card-to-diagram linking)
- Statement of Architecture Work (SoAW) editor with DOCX export
- Calculated fields engine with sandboxed formula evaluation
- Multi-level RBAC: app-level roles + per-card stakeholder roles
- AG Grid inventory with Excel import/export
- SSO OAuth support (OIDC)
- Rate limiting on auth endpoints (slowapi)
- Fernet encryption for database-stored secrets
- Docker hardening: non-root users, cap_drop ALL, memory limits

### Security
- JWT tokens now validate issuer and audience claims
- Default SECRET_KEY blocked in non-development environments
- Nginx security headers (CSP, HSTS, X-Frame-Options, etc.)
