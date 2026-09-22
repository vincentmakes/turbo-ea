"""What a card file attachment may be, and how that is proven.

``file.content_type`` on an upload is multipart metadata the client writes, so
it decides nothing here: an ``.exe`` announced as ``application/pdf`` used to
store fine. The extension picks the format, the leading bytes have to prove the
container, and the MIME that lands in the database is this module's canonical
value for the extension — never the browser's string. That canonical value is
what the Resources filters group by and what ``/download`` serves.

The same posture as ``sniff_image_mime`` in ``app/api/v1/card_logos.py``, which
validates card logos; the four image signatures are repeated below rather than
imported, because ``services`` must not depend on ``api``.

Signatures identify a *container*, not a format: every OOXML and OpenDocument
file is a zip, and ``.doc`` / ``.xls`` / ``.ppt`` / ``.msg`` are all OLE2. The
extension is what tells members of a family apart; the signature is what stops
a renamed executable. That is the honest limit of this check, and it is enough
for what it defends against.

Nothing here opens an archive or parses a document — an attachment is stored
and handed back as bytes, always with ``Content-Disposition: attachment``.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

# The edge nginx allows 21m (see the two server blocks in /Dockerfile), so a
# file between this cap and that one reaches the route and gets the readable
# 400 below instead of nginx's bare 413. Keep the two in step — the guard test
# ``tests/services/test_upload_limits.py`` fails if they drift.
MAX_ATTACHMENT_MB = 20
MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024

# Enough for a tar's ustar magic at offset 257, and for the junk some writers
# emit before a PDF's %PDF- header.
SNIFF_BYTES = 1024


class InvalidAttachmentError(ValueError):
    """A refusal a user should read — the route turns it into a 400."""


# ---------------------------------------------------------------------------
# Signature helpers
# ---------------------------------------------------------------------------

_UTF8_BOM = b"\xef\xbb\xbf"
_UTF16_BOMS = (b"\xff\xfe", b"\xfe\xff")

# An RFC 5322 header field: "Received:", "From:", "X-Mailer:" …
_EML_FIRST_LINE = re.compile(rb"^[A-Za-z][A-Za-z0-9-]*:[ \t]")


def _is_pdf(head: bytes) -> bool:
    return b"%PDF-" in head[:1024]


def _is_zip(head: bytes) -> bool:
    # Local file header, plus the empty-archive and spanned markers: an
    # OOXML/ODF file always starts with the first, a hand-made .zip may not.
    return head[:4] in (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")


def _is_ole2(head: bytes) -> bool:
    return head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")


def _is_gzip(head: bytes) -> bool:
    return head[:2] == b"\x1f\x8b"


def _is_tar(head: bytes) -> bool:
    # POSIX and GNU tar. A pre-POSIX V7 tar carries no magic at all and is
    # refused — it cannot be told from arbitrary bytes.
    return head[257:262] == b"ustar"


def _is_7z(head: bytes) -> bool:
    return head.startswith(b"7z\xbc\xaf\x27\x1c")


def _is_png(head: bytes) -> bool:
    return head.startswith(b"\x89PNG\r\n\x1a\n")


def _is_jpeg(head: bytes) -> bool:
    return head.startswith(b"\xff\xd8\xff")


def _is_gif(head: bytes) -> bool:
    return head.startswith(b"GIF87a") or head.startswith(b"GIF89a")


def _is_webp(head: bytes) -> bool:
    return head[:4] == b"RIFF" and head[8:12] == b"WEBP"


def _is_text(head: bytes) -> bool:
    """git's "is this binary" heuristic: no NUL byte in the window.

    Deliberately not a strict UTF-8 decode — Excel writes cp1252 CSVs and a
    Windows export is often UTF-16, and refusing either would read as a bug.
    """
    if not head:
        return False
    if head.startswith(_UTF16_BOMS):
        # UTF-16 is full of NULs by construction; the BOM is the proof.
        return True
    return b"\x00" not in head


def _text_body(head: bytes) -> bytes:
    """``head`` past a UTF-8 BOM and any leading whitespace."""
    body = head[len(_UTF8_BOM) :] if head.startswith(_UTF8_BOM) else head
    return body.lstrip()


def _is_json(head: bytes) -> bool:
    body = _text_body(head)
    return _is_text(head) and body[:1] in (b"{", b"[")


def _is_xml(head: bytes) -> bool:
    return _is_text(head) and _text_body(head)[:1] == b"<"


def _is_svg(head: bytes) -> bool:
    return _is_xml(head) and b"<svg" in head.lower()


def _is_eml(head: bytes) -> bool:
    if not _is_text(head):
        return False
    first_line = _text_body(head).split(b"\n", 1)[0]
    return bool(_EML_FIRST_LINE.match(first_line))


# ---------------------------------------------------------------------------
# The table
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AttachmentFormat:
    """One accepted extension and what proves a file really is one."""

    extension: str  # lowercase, leading dot
    mime: str  # canonical — stored and served
    label: str  # shown in the "Accepted: …" refusal
    sniff: Callable[[bytes], bool]  # receives the first SNIFF_BYTES


_ODF = "application/vnd.oasis.opendocument"
_OOXML = "application/vnd.openxmlformats-officedocument"

FORMATS: tuple[AttachmentFormat, ...] = (
    AttachmentFormat(".pdf", "application/pdf", "PDF", _is_pdf),
    # Zip containers — the extension picks which one.
    AttachmentFormat(".docx", f"{_OOXML}.wordprocessingml.document", "DOCX", _is_zip),
    AttachmentFormat(".xlsx", f"{_OOXML}.spreadsheetml.sheet", "XLSX", _is_zip),
    AttachmentFormat(".pptx", f"{_OOXML}.presentationml.presentation", "PPTX", _is_zip),
    AttachmentFormat(".odt", f"{_ODF}.text", "ODT", _is_zip),
    AttachmentFormat(".ods", f"{_ODF}.spreadsheet", "ODS", _is_zip),
    AttachmentFormat(".odp", f"{_ODF}.presentation", "ODP", _is_zip),
    AttachmentFormat(".odg", f"{_ODF}.graphics", "ODG", _is_zip),
    AttachmentFormat(".zip", "application/zip", "ZIP", _is_zip),
    # OLE2 containers — likewise.
    AttachmentFormat(".doc", "application/msword", "DOC", _is_ole2),
    AttachmentFormat(".xls", "application/vnd.ms-excel", "XLS", _is_ole2),
    AttachmentFormat(".ppt", "application/vnd.ms-powerpoint", "PPT", _is_ole2),
    AttachmentFormat(".msg", "application/vnd.ms-outlook", "MSG", _is_ole2),
    # Other archives.
    AttachmentFormat(".gz", "application/gzip", "GZ", _is_gzip),
    AttachmentFormat(".tgz", "application/gzip", "TGZ", _is_gzip),
    AttachmentFormat(".tar", "application/x-tar", "TAR", _is_tar),
    AttachmentFormat(".7z", "application/x-7z-compressed", "7Z", _is_7z),
    # Images.
    AttachmentFormat(".png", "image/png", "PNG", _is_png),
    AttachmentFormat(".jpg", "image/jpeg", "JPG", _is_jpeg),
    AttachmentFormat(".jpeg", "image/jpeg", "JPEG", _is_jpeg),
    AttachmentFormat(".gif", "image/gif", "GIF", _is_gif),
    AttachmentFormat(".webp", "image/webp", "WEBP", _is_webp),
    # SVG is scriptable, and is accepted only because every attachment is
    # served as a download (Content-Disposition: attachment + nosniff), never
    # rendered in the app's origin. Do not start serving attachments inline
    # without a sanitiser.
    AttachmentFormat(".svg", "image/svg+xml", "SVG", _is_svg),
    # Text and data.
    AttachmentFormat(".txt", "text/plain", "TXT", _is_text),
    AttachmentFormat(".csv", "text/csv", "CSV", _is_text),
    AttachmentFormat(".md", "text/markdown", "MD", _is_text),
    AttachmentFormat(".json", "application/json", "JSON", _is_json),
    AttachmentFormat(".xml", "application/xml", "XML", _is_xml),
    AttachmentFormat(".eml", "message/rfc822", "EML", _is_eml),
)

BY_EXTENSION: dict[str, AttachmentFormat] = {f.extension: f for f in FORMATS}

#: Sorted, for the frontend mirror to be compared against (``attachmentFormats.ts``).
ACCEPTED_EXTENSIONS: tuple[str, ...] = tuple(sorted(BY_EXTENSION))

#: "7Z, CSV, DOC, …" — the tail of the not-allowed refusal.
ACCEPTED_LABEL: str = ", ".join(sorted({f.label for f in FORMATS}))


# ---------------------------------------------------------------------------
# Public checks
# ---------------------------------------------------------------------------


def extension_of(filename: str) -> str:
    """Lowercase final suffix including the dot, or ``""`` when there is none.

    ``archive.tar.gz`` is ``.gz``, which is what makes a tarball land on the
    gzip row without a special case.
    """
    name = (filename or "").strip().rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    dot = name.rfind(".")
    if dot <= 0 or dot == len(name) - 1:
        return ""
    return name[dot:].lower()


def resolve_format(filename: str) -> AttachmentFormat:
    """The format an upload claims to be, from its name alone."""
    ext = extension_of(filename)
    fmt = BY_EXTENSION.get(ext)
    if fmt is None:
        claimed = f"'{ext}'" if ext else "with no extension"
        raise InvalidAttachmentError(
            f"File type {claimed} is not allowed. Accepted: {ACCEPTED_LABEL}."
        )
    return fmt


def validate_content(fmt: AttachmentFormat, head: bytes) -> None:
    """Check the leading bytes really are what ``fmt`` says."""
    if not head:
        raise InvalidAttachmentError("File is empty")
    if not fmt.sniff(head[:SNIFF_BYTES]):
        raise InvalidAttachmentError(
            f"File content does not match its '{fmt.extension}' extension."
        )


def validate_attachment(filename: str, data: bytes) -> str:
    """Resolve + verify in one call; returns the canonical MIME to store."""
    fmt = resolve_format(filename)
    validate_content(fmt, data)
    return fmt.mime
