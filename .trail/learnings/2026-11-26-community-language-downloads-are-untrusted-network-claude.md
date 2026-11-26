---
title: "Community language downloads are untrusted network input: stream raw bytes, never inflate, and fake the library with streamed responses"
author: Claude
date: 2026-11-26
branch: claude/community-languages
cost: { minutes: 59, tokens: 697039 }
id: l-771c9b30
scope: repo
status: active
src: agent
touches:
  - backend/app/api/v1/custom_locales.py
  - backend/app/services/language_catalogue.py
  - backend/tests/language_library.py
  - backend/tests/services/test_language_catalogue.py
  - docs/admin/custom-languages.ar.md
  - docs/admin/custom-languages.da.md
  - docs/admin/custom-languages.de.md
  - docs/admin/custom-languages.es.md
  - docs/admin/custom-languages.fr.md
  - docs/admin/custom-languages.it.md
---

## Decided
The community language library (index.json + packs) is fetched only when an admin asks, with https only, no redirect to another host or port, a per-operation and a total timeout, Accept-Encoding: identity (a compressed body is refused) and a size cap counted on the raw bytes while they stream. The pack URL is derived from the configured index URL and the checked language code, pinned to the commit the index names; nothing in index.json steers a download. The install's Security-log row is written by a recorder defined in the route module and handed to the service, so the admin-write audit guard (which credits only helpers in the route module) sees it and the row still commits with the install.

## Tried and ruled out
- Counting the cap on aiter_bytes(): httpx decodes each chunk first, so a gzip bomb inflates a whole chunk in memory before the check runs.
- Calling audit_log.record inside the service: correct, but the static guard fails the route; an allowlist entry would be wrong since it is an admin action.

## Watch out
- In tests, httpx.Response(status, content=b"...") is a response already read: aiter_raw() raises StreamConsumed. A fake server must answer with stream=httpx.ByteStream(body) (and its own content-length).
- A MUI Button with a MaterialSymbol startIcon has the icon's ligature text in its accessible name ("refresh Refresh"); give it an aria-label or tests looking it up by name fail.

In the code: backend/app/services/language_catalogue.py (fetch_limited, _download, pack_url, install), backend/app/api/v1/custom_locales.py (_install_recorder), backend/tests/language_library.py (FakeLibrary.handler), backend/tests/services/test_audit_log_guard.py.
