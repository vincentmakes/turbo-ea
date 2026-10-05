"""What an attachment may be, proved by its bytes — no database needed."""

from __future__ import annotations

import pytest

from app.services.attachment_validation import (
    ACCEPTED_EXTENSIONS,
    ACCEPTED_LABEL,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_MB,
    SNIFF_BYTES,
    AttachmentFormat,
    InvalidAttachmentError,
    _is_7z,
    _is_eml,
    _is_gif,
    _is_gzip,
    _is_jpeg,
    _is_json,
    _is_ole2,
    _is_pdf,
    _is_png,
    _is_svg,
    _is_tar,
    _is_text,
    _is_webp,
    _is_xml,
    _is_zip,
    _text_body,
    extension_of,
    extensions_for_mime,
    resolve_format,
    validate_attachment,
    validate_content,
)

# Minimal heads that are genuinely the container each extension claims.
OLE2 = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 8
ZIP = b"PK\x03\x04\x14\x00\x06\x00"
PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF"
GIF = b"GIF89a" + b"\x00" * 8
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 "
GZIP = b"\x1f\x8b\x08\x00\x00\x00\x00\x00"
SEVENZ = b"7z\xbc\xaf\x27\x1c\x00\x04"
TAR = b"\x00" * 257 + b"ustar\x0000"


ACCEPTED = [
    (".pdf", PDF, "application/pdf"),
    (".docx", ZIP, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    (".xlsx", ZIP, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    (".pptx", ZIP, "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    (".odt", ZIP, "application/vnd.oasis.opendocument.text"),
    (".ods", ZIP, "application/vnd.oasis.opendocument.spreadsheet"),
    (".odp", ZIP, "application/vnd.oasis.opendocument.presentation"),
    (".odg", ZIP, "application/vnd.oasis.opendocument.graphics"),
    (".zip", ZIP, "application/zip"),
    (".doc", OLE2, "application/msword"),
    (".xls", OLE2, "application/vnd.ms-excel"),
    (".ppt", OLE2, "application/vnd.ms-powerpoint"),
    (".msg", OLE2, "application/vnd.ms-outlook"),
    (".gz", GZIP, "application/gzip"),
    (".tgz", GZIP, "application/gzip"),
    (".tar", TAR, "application/x-tar"),
    (".7z", SEVENZ, "application/x-7z-compressed"),
    (".png", PNG, "image/png"),
    (".jpg", JPEG, "image/jpeg"),
    (".jpeg", JPEG, "image/jpeg"),
    (".gif", GIF, "image/gif"),
    (".webp", WEBP, "image/webp"),
    (".svg", b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>', "image/svg+xml"),
    (".txt", b"just some words", "text/plain"),
    (".csv", b"name,owner\nSAP,IT\n", "text/csv"),
    (".md", b"# Heading\n", "text/markdown"),
    (".json", b'{"a": 1}', "application/json"),
    (".xml", b"<root><child/></root>", "application/xml"),
    (".eml", b"Received: from mail.example.com\r\nFrom: a@b.c\r\n", "message/rfc822"),
]


class TestAcceptedFormats:
    @pytest.mark.parametrize(("ext", "head", "mime"), ACCEPTED)
    def test_every_accepted_extension_stores_its_canonical_mime(self, ext, head, mime):
        assert validate_attachment(f"report{ext}", head) == mime

    def test_the_table_covers_every_advertised_extension(self):
        # The frontend mirror and the docs are written from ACCEPTED_EXTENSIONS;
        # a row added there without a test here would go unproven.
        assert {ext for ext, _, _ in ACCEPTED} == set(ACCEPTED_EXTENSIONS)

    def test_extension_matching_is_case_insensitive(self):
        assert validate_attachment("REPORT.PDF", PDF) == "application/pdf"
        assert validate_attachment("Photo.JPEG", JPEG) == "image/jpeg"

    def test_jpg_and_jpeg_share_one_stored_mime(self):
        assert validate_attachment("a.jpg", JPEG) == validate_attachment("a.jpeg", JPEG)

    def test_a_tarball_lands_on_the_gzip_row(self):
        # extension_of takes the last suffix, which is what makes .tar.gz work
        # without a special case.
        assert extension_of("archive.tar.gz") == ".gz"
        assert validate_attachment("archive.tar.gz", GZIP) == "application/gzip"

    def test_an_outlook_message_is_accepted_from_its_bytes_alone(self):
        # Browsers send application/octet-stream (or nothing) for .msg, which
        # is exactly why the declared content type is not consulted.
        assert validate_attachment("thread.msg", OLE2) == "application/vnd.ms-outlook"

    def test_a_utf16_text_file_is_not_mistaken_for_binary(self):
        # Windows "Unicode" .txt is full of NULs; the BOM is what proves it.
        assert validate_attachment("notes.txt", b"\xff\xfeh\x00i\x00") == "text/plain"

    def test_a_cp1252_csv_is_accepted(self):
        # Excel does not write UTF-8 by default; refusing this would read as a bug.
        assert validate_attachment("export.csv", b"name\nCaf\xe9\n") == "text/csv"

    def test_leading_whitespace_and_bom_do_not_defeat_json_or_xml(self):
        assert validate_attachment("a.json", b'\xef\xbb\xbf\n  {"a": 1}') == "application/json"
        assert validate_attachment("a.xml", b"\n\t<root/>") == "application/xml"


class TestRejections:
    def test_an_extension_that_is_not_on_the_list(self):
        with pytest.raises(InvalidAttachmentError) as exc:
            validate_attachment("setup.exe", b"MZ\x90\x00")
        assert "not allowed" in str(exc.value)
        # The refusal names what would work.
        assert "PDF" in str(exc.value)

    def test_a_file_with_no_extension_at_all(self):
        with pytest.raises(InvalidAttachmentError, match="no extension"):
            validate_attachment("README", b"hello")

    def test_a_renamed_executable_is_caught_by_its_bytes(self):
        # The whole point: the name says PDF, the content says PE binary.
        with pytest.raises(InvalidAttachmentError, match="does not match"):
            validate_attachment("invoice.pdf", b"MZ\x90\x00\x03\x00\x00\x00")

    def test_a_pdf_renamed_to_docx(self):
        with pytest.raises(InvalidAttachmentError, match="does not match"):
            validate_attachment("report.docx", PDF)

    def test_binary_content_under_a_text_extension(self):
        with pytest.raises(InvalidAttachmentError, match="does not match"):
            validate_attachment("notes.txt", b"pre\x00post")

    def test_xml_that_is_not_svg(self):
        with pytest.raises(InvalidAttachmentError, match="does not match"):
            validate_attachment("logo.svg", b"<html><body>hi</body></html>")

    def test_json_that_does_not_start_with_a_container(self):
        with pytest.raises(InvalidAttachmentError, match="does not match"):
            validate_attachment("data.json", b"just text")

    def test_a_tar_without_the_ustar_magic(self):
        with pytest.raises(InvalidAttachmentError, match="does not match"):
            validate_attachment("archive.tar", b"x" * 400)

    def test_an_eml_whose_first_line_is_not_a_header(self):
        with pytest.raises(InvalidAttachmentError, match="does not match"):
            validate_attachment("mail.eml", b"hello there\r\n")

    def test_an_empty_file(self):
        with pytest.raises(InvalidAttachmentError, match="empty"):
            validate_attachment("report.pdf", b"")

    def test_a_trailing_dot_is_not_an_extension(self):
        with pytest.raises(InvalidAttachmentError, match="no extension"):
            validate_attachment("weird.", b"hello")

    def test_a_dotfile_is_not_read_as_an_extension(self):
        # ".pdf" alone is a hidden file with no extension, not a PDF.
        with pytest.raises(InvalidAttachmentError, match="no extension"):
            validate_attachment(".pdf", PDF)


class TestSizeConstant:
    def test_the_cap_is_twenty_megabytes(self):
        assert MAX_ATTACHMENT_MB == 20
        assert MAX_ATTACHMENT_BYTES == 20 * 1024 * 1024

    def test_resolve_format_does_not_read_content(self):
        # Resolving happens before the body is read, so it must work on a name.
        assert resolve_format("anything.png").mime == "image/png"


# ---------------------------------------------------------------------------
# Each signature, at its edge: the genuine bytes pass and a one-byte miss fails.
# ---------------------------------------------------------------------------

LABEL = (
    "7Z, CSV, DOC, DOCX, EML, GIF, GZ, JPEG, JPG, JSON, MD, MSG, ODG, ODP, ODS, ODT, "
    "PDF, PNG, PPT, PPTX, SVG, TAR, TGZ, TXT, WEBP, XLS, XLSX, XML, ZIP"
)

SIGNATURES = [
    # (sniffer, bytes, expected)
    (_is_pdf, b"%PDF-1.4", True),
    (_is_pdf, b"junk\n%PDF-1.4", True),
    (_is_pdf, b"%PDF1.4", False),
    (_is_pdf, b"x" * 1019 + b"%PDF-", True),
    (_is_pdf, b"x" * 1020 + b"%PDF-", False),
    (_is_zip, b"PK\x03\x04", True),
    (_is_zip, b"PK\x05\x06", True),
    (_is_zip, b"PK\x07\x08", True),
    (_is_zip, b"PK\x03\x05", False),
    (_is_zip, b"PK\x03", False),
    (_is_zip, b"xPK\x03\x04", False),
    (_is_ole2, b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", True),
    (_is_ole2, b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe2", False),
    (_is_gzip, b"\x1f\x8b", True),
    (_is_gzip, b"\x1f\x8c", False),
    (_is_gzip, b"\x1f", False),
    (_is_tar, b"\x00" * 257 + b"ustar", True),
    (_is_tar, b"\x00" * 256 + b"ustar", False),
    (_is_tar, b"\x00" * 257 + b"ustaR", False),
    (_is_7z, b"7z\xbc\xaf\x27\x1c", True),
    (_is_7z, b"7z\xbc\xaf\x27\x1d", False),
    (_is_png, b"\x89PNG\r\n\x1a\n", True),
    (_is_png, b"\x89PNG\r\n\x1a\r", False),
    (_is_jpeg, b"\xff\xd8\xff", True),
    (_is_jpeg, b"\xff\xd8\xfe", False),
    (_is_gif, b"GIF87a", True),
    (_is_gif, b"GIF89a", True),
    (_is_gif, b"GIF88a", False),
    (_is_webp, b"RIFF\x00\x00\x00\x00WEBP", True),
    (_is_webp, b"RIFX\x00\x00\x00\x00WEBP", False),
    (_is_webp, b"RIFF\x00\x00\x00\x00WEBQ", False),
    (_is_webp, b"RIFF\x00\x00\x00WEBP", False),
    (_is_text, b"", False),
    (_is_text, b"plain", True),
    (_is_text, b"a\x00b", False),
    (_is_text, b"\xff\xfea\x00", True),
    (_is_text, b"\xfe\xff\x00a", True),
    (_is_json, b"[1]", True),
    (_is_json, b"\xef\xbb\xbf \n{}", True),
    (_is_json, b"x{}", False),
    (_is_json, b"{\x00}", False),
    (_is_json, b"", False),
    (_is_xml, b"<a/>", True),
    (_is_xml, b"\xef\xbb\xbf\t<a/>", True),
    (_is_xml, b"a<b/>", False),
    (_is_xml, b"<a>\x00</a>", False),
    (_is_svg, b"<SVG xmlns='x'/>", True),
    (_is_svg, b"<?xml?>\n<svg/>", True),
    (_is_svg, b"<html/>", False),
    (_is_svg, b"svg <svg/>", False),
    (_is_eml, b"From: a@b.c", True),
    (_is_eml, b"X-Mailer:\tthing", True),
    (_is_eml, b"\xef\xbb\xbf  Subject: hi", True),
    (_is_eml, b"Received: x\nhello", True),
    (_is_eml, b"1From: a@b.c", False),
    (_is_eml, b"From:a@b.c", False),
    (_is_eml, b"From a: b", False),
    (_is_eml, b"hello\nFrom: a@b.c", False),
    (_is_eml, b"From: a\x00", False),
    (_is_eml, b"", False),
]


class TestSignatures:
    @pytest.mark.parametrize(("sniff", "head", "expected"), SIGNATURES)
    def test_signature(self, sniff, head, expected):
        assert sniff(head) is expected

    def test_text_body_skips_a_utf8_bom_and_leading_whitespace(self):
        assert _text_body(b"\xef\xbb\xbf \n\tbody ") == b"body "
        assert _text_body(b"  body") == b"body"
        assert _text_body(b"\xef\xbbx") == b"\xef\xbbx"


class TestNamesAndMessages:
    @pytest.mark.parametrize(
        ("filename", "ext"),
        [
            ("report.PDF", ".pdf"),
            ("dir/sub/a.Docx", ".docx"),
            ("C:\\Users\\me\\a.XLSX", ".xlsx"),
            ("  spaced.txt  ", ".txt"),
            ("a.b/c", ""),
            ("a/b.c\\d", ""),
            # Only the last segment counts, however deep the dotted folders go.
            ("x/a.b/c", ""),
            ("x\\a.b\\c", ""),
            ("dir/.hidden", ""),
            ("", ""),
            (None, ""),
        ],
    )
    def test_extension_of(self, filename, ext):
        assert extension_of(filename) == ext

    def test_extensions_for_mime(self):
        assert extensions_for_mime("image/jpeg") == (".jpeg", ".jpg")
        assert extensions_for_mime("application/gzip") == (".gz", ".tgz")
        assert extensions_for_mime("application/pdf") == (".pdf",)
        assert extensions_for_mime("application/x-msdownload") == ()

    def test_the_accepted_list(self):
        assert ACCEPTED_LABEL == LABEL
        assert ACCEPTED_EXTENSIONS == tuple(sorted(ACCEPTED_EXTENSIONS))
        assert len(ACCEPTED_EXTENSIONS) == 29

    def test_unlisted_extension_message(self):
        with pytest.raises(InvalidAttachmentError) as exc:
            resolve_format("setup.EXE")
        assert str(exc.value) == f"File type '.exe' is not allowed. Accepted: {LABEL}."

    def test_missing_extension_message(self):
        with pytest.raises(InvalidAttachmentError) as exc:
            resolve_format("README")
        assert str(exc.value) == f"File type with no extension is not allowed. Accepted: {LABEL}."

    def test_empty_and_mismatch_messages(self):
        with pytest.raises(InvalidAttachmentError) as exc:
            validate_content(resolve_format("a.pdf"), b"")
        assert str(exc.value) == "File is empty"
        with pytest.raises(InvalidAttachmentError) as exc:
            validate_content(resolve_format("a.pdf"), b"MZ")
        assert str(exc.value) == "File content does not match its '.pdf' extension."

    def test_only_the_sniff_window_is_inspected(self):
        seen: list[int] = []

        def sniff(head: bytes) -> bool:
            seen.append(len(head))
            return True

        fmt = AttachmentFormat(".x", "x/x", "X", sniff)
        validate_content(fmt, b"a" * (SNIFF_BYTES + 50))
        assert seen == [SNIFF_BYTES] == [1024]

    def test_an_invalid_attachment_is_a_value_error(self):
        assert issubclass(InvalidAttachmentError, ValueError)
