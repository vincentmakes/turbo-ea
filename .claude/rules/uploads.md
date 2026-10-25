---
paths:
  - "backend/app/services/attachment_validation.py"
  - "backend/app/services/card_logos.py"
  - "backend/app/api/v1/file_attachments.py"
  - "backend/app/api/v1/resources.py"
  - "frontend/src/lib/attachmentFormats.ts"
  - "frontend/src/features/admin/Resources*"
---

# File uploads and attachment validation

> Loaded when you touch `backend/app/services/attachment_validation.py`, `backend/app/services/card_logos.py`, `backend/app/api/v1/file_attachments.py`, `backend/app/api/v1/resources.py`, … (full list in the frontmatter). Moved verbatim from `CLAUDE.md`; edit it here.

- **An upload is what its bytes say, not what the client calls it.** `file.content_type` is multipart metadata the client writes, so it decides nothing: `backend/app/services/attachment_validation.py` resolves the **extension** to a format, requires the leading bytes to prove the container, and stores that table's **canonical** MIME — never the browser's string, which is how `image/jpg` and `application/x-zip-compressed` used to split one format into two Resources filter rows. A signature identifies a container, not a format (every OOXML and ODF file is a zip; `.doc`/`.xls`/`.ppt`/`.msg` are all OLE2), so the extension tells family members apart and the signature is what stops a renamed executable — that is the honest limit of the check. The size cap (`MAX_ATTACHMENT_BYTES`, 20 MB) lives there too and is mirrored in **three** other places that must not drift: the edge nginx's `client_max_body_size` (deliberately *higher*, see below), `frontend/src/lib/attachmentFormats.ts` (the `accept=` list, the pre-upload checks and the filter sidebar all derive from it) and the manual. `tests/services/test_upload_limits.py` reads the Dockerfile, the chart, the Terraform files and the TS mirror off disk and fails on any disagreement — written because the last drift (nginx 5 MB vs. an advertised 10 MB) shipped a raw 413 to users and no test noticed. `card_logos.sniff_image_mime` is the same posture for card logos; `services` must not import from `api`, so the four image signatures are deliberately duplicated. Guard tests: `tests/services/test_attachment_validation.py`, `tests/api/test_file_attachments.py`.
