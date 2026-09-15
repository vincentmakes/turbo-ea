# Security Policy

Turbo EA is self-hosted Enterprise Architecture software. A vulnerability in it can affect the privacy and integrity of operators' architecture data, including credentials stored in admin settings (SSO secrets, SMTP passwords, ServiceNow credentials). Please report potential issues responsibly via the channel below.

## Supported versions

Only the latest minor release line is supported with security fixes. Older minor lines are end-of-life — backporting is not feasible for a solo project. Fixes ship as patch releases on the latest minor.

| Version | Supported          |
|---------|--------------------|
| Latest minor (currently `1.x`) | :white_check_mark: |
| Older minors                   | :x:                |

This is the pre-LTS posture. If a longer support window matters for your deployment, fork.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.** Use GitHub's private vulnerability advisories:

> **[Open a private security advisory →](https://github.com/TurboEA/turbo-ea/security/advisories/new)**

Include:

- A description of the issue and its impact.
- Steps or a minimal reproducer.
- The Turbo EA version (`/VERSION` or `GET /api/health`) and deployment shape (bundled compose, external Postgres, dev mode).
- Any logs you can share (with secrets redacted).

If you can't use GitHub Advisories for some reason, reach out via the contact details on the maintainer's GitHub profile.

## Response expectations

This is a solo side project, so response is best-effort:

- **Acknowledgement:** within 7 days.
- **Mitigation guidance or fix plan:** within 30 days where feasible.
- **Disclosure:** coordinated. The advisory is published alongside the patch release, with credit to the reporter unless you ask otherwise.

## Out of scope

The following are operator responsibilities, not vulnerabilities in Turbo EA itself:

- Misconfigurations of self-hosted deployments — weak `SECRET_KEY`, exposed Postgres, missing TLS termination, default credentials left unchanged.
- Reports against demo/seed data deployments (`SEED_DEMO=true`) — those credentials are public by design.
- Findings in transitive dependencies that don't affect Turbo EA usage paths (we still appreciate the heads-up — please file as a normal issue or discussion if it's not exploitable).
- Social engineering, physical attacks, denial-of-service through resource exhaustion against under-provisioned deployments.

## Supply chain

Released container images on GHCR are signed with [cosign](https://github.com/sigstore/cosign) keyless OIDC and carry a buildkit-generated SPDX SBOM as an OCI referrer. See [`docs/admin/supply-chain.md`](docs/admin/supply-chain.md) for verification commands.
