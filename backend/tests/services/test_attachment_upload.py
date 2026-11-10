"""The shared upload reader and download header (``app/services/attachment_upload.py``).

Pure: the upload is a stub that records what it was asked to read.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services import attachment_upload as up
from app.services.attachment_validation import MAX_ATTACHMENT_BYTES, resolve_format

PDF_HEAD = b"%PDF-1.7\n"


class _Upload:
    def __init__(self, filename: str | None, data: bytes) -> None:
        self.filename = filename
        self._data = data
        self.asked: list[int | None] = []

    async def read(self, size: int | None = None) -> bytes:
        self.asked.append(size)
        return self._data if size is None else self._data[:size]


class TestReadValidatedUpload:
    async def test_a_valid_upload_reads_one_byte_past_the_cap(self):
        upload = _Upload("plan.pdf", PDF_HEAD + b"body")
        fmt, data = await up.read_validated_upload(upload)
        assert fmt == resolve_format("plan.pdf")
        assert data == PDF_HEAD + b"body"
        assert upload.asked == [MAX_ATTACHMENT_BYTES + 1]

    async def test_exactly_the_cap_passes_and_one_byte_more_is_a_400(self):
        at_cap = PDF_HEAD + b"x" * (MAX_ATTACHMENT_BYTES - len(PDF_HEAD))
        _fmt, data = await up.read_validated_upload(_Upload("big.pdf", at_cap))
        assert len(data) == MAX_ATTACHMENT_BYTES

        with pytest.raises(HTTPException) as err:
            await up.read_validated_upload(_Upload("big.pdf", at_cap + b"x"))
        assert (err.value.status_code, err.value.detail) == (
            400,
            "File exceeds maximum size of 20 MB",
        )

    async def test_a_refused_name_is_a_400_with_the_reason_and_reads_nothing(self):
        upload = _Upload("tool.exe", b"MZ")
        with pytest.raises(HTTPException) as err:
            await up.read_validated_upload(upload)
        assert err.value.status_code == 400
        assert err.value.detail.startswith("File type '.exe' is not allowed. Accepted: ")
        assert upload.asked == []

    async def test_a_missing_name_is_a_400_naming_no_extension(self):
        with pytest.raises(HTTPException) as err:
            await up.read_validated_upload(_Upload(None, PDF_HEAD))
        assert err.value.detail.startswith("File type with no extension is not allowed.")

    async def test_content_that_is_not_its_format_is_a_400_with_the_reason(self):
        with pytest.raises(HTTPException) as err:
            await up.read_validated_upload(_Upload("plan.pdf", b"not a pdf"))
        assert (err.value.status_code, err.value.detail) == (
            400,
            "File content does not match its '.pdf' extension.",
        )


class TestContentDisposition:
    def test_quotes_and_backslashes_are_replaced_in_the_ascii_fallback(self):
        assert up.content_disposition('a\\b"c.pdf') == (
            "attachment; filename=\"a_b_c.pdf\"; filename*=UTF-8''a%5Cb%22c.pdf"
        )

    def test_every_reserved_character_is_percent_encoded_and_non_ascii_falls_back(self):
        assert up.content_disposition("a/é.pdf") == (
            "attachment; filename=\"a/?.pdf\"; filename*=UTF-8''a%2F%C3%A9.pdf"
        )
