# ADR-003: Same-origin DrawIO embedding

**Status**: Accepted
**Date**: 2024-09-01

## Context

Turbo EA needs a diagram editor for enterprise architecture visualizations.
Options considered:

1. **External DrawIO** (`embed.diagrams.net`) — postMessage API, no direct DOM access
2. **Self-hosted DrawIO** (same origin) — full mxGraph DOM access via iframe
3. **Custom diagram library** (e.g., JointJS, GoJS) — full control but high effort

## Decision

Self-host DrawIO v26.0.9 inside the frontend Docker image, served at `/drawio/`
by Nginx. The diagram editor loads DrawIO in a same-origin iframe and accesses
the mxGraph API directly via `iframe.contentWindow.__turboGraph`.

Build pipeline:
1. Frontend Dockerfile clones `jgraph/drawio` at a pinned tag
2. Nginx serves DrawIO static files at `/drawio/`
3. Same-origin policy allows direct DOM manipulation

Custom configurations:
- `PreConfig.js` / `PostConfig.js` — DrawIO configuration hooks
- PWA manifest and service worker stripped (don't work behind auth proxies)
- Email obfuscation disabled via `<!--email_off-->` injection

## Consequences

**Positive**:
- Full mxGraph API access (insert/read/modify cells programmatically)
- No dependency on external services
- Cards can be represented as custom XML user objects in diagrams
- Diagram-to-EA sync panel possible (CardSidebar, DiagramSyncPanel)

**Negative**:
- ~50 MB added to Docker image
- DrawIO updates require Dockerfile tag bump
- CSP must allow `unsafe-inline` + `unsafe-eval` for DrawIO scripts
- Same-origin requirement means DrawIO must be served from the same host
