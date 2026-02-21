"""Unit tests for DocumentCreate URL validation and other schema validators
in schemas/common.py.

No database required.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.common import DocumentCreate

# ---------------------------------------------------------------------------
# DocumentCreate.validate_url_scheme
# ---------------------------------------------------------------------------


class TestDocumentCreateUrlValidation:
    def test_http_url_accepted(self):
        doc = DocumentCreate(name="Test", url="http://example.com")
        assert doc.url == "http://example.com"

    def test_https_url_accepted(self):
        doc = DocumentCreate(name="Test", url="https://example.com/path?q=1")
        assert doc.url == "https://example.com/path?q=1"

    def test_mailto_accepted(self):
        doc = DocumentCreate(name="Email", url="mailto:user@example.com")
        assert doc.url == "mailto:user@example.com"

    def test_none_url_accepted(self):
        doc = DocumentCreate(name="No URL", url=None)
        assert doc.url is None

    def test_url_field_optional(self):
        doc = DocumentCreate(name="No URL")
        assert doc.url is None

    def test_javascript_scheme_rejected(self):
        with pytest.raises(ValidationError, match="http://.*https://.*mailto:"):
            DocumentCreate(name="XSS", url="javascript:alert(1)")

    def test_ftp_scheme_rejected(self):
        with pytest.raises(ValidationError, match="http://.*https://.*mailto:"):
            DocumentCreate(name="FTP", url="ftp://files.example.com/doc.pdf")

    def test_data_url_rejected(self):
        with pytest.raises(ValidationError, match="http://.*https://.*mailto:"):
            DocumentCreate(name="Data", url="data:text/html,<h1>hi</h1>")

    def test_file_scheme_rejected(self):
        with pytest.raises(ValidationError, match="http://.*https://.*mailto:"):
            DocumentCreate(name="File", url="file:///etc/passwd")

    def test_empty_string_rejected(self):
        with pytest.raises(ValidationError, match="http://.*https://.*mailto:"):
            DocumentCreate(name="Empty", url="")

    def test_whitespace_only_rejected(self):
        with pytest.raises(ValidationError, match="http://.*https://.*mailto:"):
            DocumentCreate(name="Spaces", url="   ")

    def test_url_stripped(self):
        """Leading/trailing whitespace should be stripped."""
        doc = DocumentCreate(name="Padded", url="  https://example.com  ")
        assert doc.url == "https://example.com"

    def test_https_with_port_and_path(self):
        doc = DocumentCreate(name="Port", url="https://example.com:8443/api/v1")
        assert doc.url == "https://example.com:8443/api/v1"

    def test_http_case_sensitive(self):
        """URL scheme check is case-sensitive (HTTP:// is rejected)."""
        with pytest.raises(ValidationError, match="http://.*https://.*mailto:"):
            DocumentCreate(name="Case", url="HTTP://EXAMPLE.COM")

    def test_default_type_is_link(self):
        doc = DocumentCreate(name="Default Type")
        assert doc.type == "link"

    def test_custom_type(self):
        doc = DocumentCreate(name="Manual", url="https://docs.com", type="pdf")
        assert doc.type == "pdf"


# ---------------------------------------------------------------------------
# CommentCreate field constraints
# ---------------------------------------------------------------------------


class TestCommentCreateConstraints:
    def test_valid_comment(self):
        from app.schemas.common import CommentCreate

        c = CommentCreate(content="Hello world")
        assert c.content == "Hello world"

    def test_empty_content_rejected(self):
        from app.schemas.common import CommentCreate

        with pytest.raises(ValidationError, match="at least 1 character"):
            CommentCreate(content="")

    def test_max_length_content(self):
        from app.schemas.common import CommentCreate

        # Exactly 10000 chars should pass
        c = CommentCreate(content="x" * 10000)
        assert len(c.content) == 10000

    def test_over_max_length_rejected(self):
        from app.schemas.common import CommentCreate

        with pytest.raises(ValidationError):
            CommentCreate(content="x" * 10001)


# ---------------------------------------------------------------------------
# BookmarkCreate / WebPortalCreate basic validation
# ---------------------------------------------------------------------------


class TestBookmarkCreate:
    def test_valid_bookmark(self):
        from app.schemas.common import BookmarkCreate

        b = BookmarkCreate(name="My View", card_type="Application")
        assert b.name == "My View"
        assert b.visibility == "private"
        assert b.is_default is False

    def test_default_odata_disabled(self):
        from app.schemas.common import BookmarkCreate

        b = BookmarkCreate(name="View")
        assert b.odata_enabled is False


class TestWebPortalCreate:
    def test_valid_portal(self):
        from app.schemas.common import WebPortalCreate

        p = WebPortalCreate(
            name="Public Apps",
            slug="public-apps",
            card_type="Application",
        )
        assert p.slug == "public-apps"
        assert p.is_published is False

    def test_with_all_fields(self):
        from app.schemas.common import WebPortalCreate

        p = WebPortalCreate(
            name="Portal",
            slug="portal",
            card_type="Application",
            filters={"status": "ACTIVE"},
            display_fields=["name", "type"],
            is_published=True,
        )
        assert p.is_published is True
        assert p.filters == {"status": "ACTIVE"}
