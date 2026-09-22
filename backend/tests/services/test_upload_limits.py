"""Upload limits are declared in four places; this is what keeps them equal.

A user uploading a 7.6 MB file once got nginx's bare 413 because the edge
capped the body at 5 MB while the backend, the browser check and the manual all
said 10 MB — every file in between passed the UI and died before FastAPI ran.
Nothing in the suite noticed, because no test read the nginx config.

These tests read the other three layers off disk and compare them to the
backend constants, so the numbers cannot drift apart again silently.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.api.v1.workspace import MAX_BUNDLE_BYTES
from app.services.attachment_validation import ACCEPTED_EXTENSIONS, MAX_ATTACHMENT_MB


def _repo_root() -> Path:
    # tests/services/test_upload_limits.py -> backend/tests -> backend -> repo
    return Path(__file__).resolve().parents[3]


def _read(*parts: str) -> str:
    return _repo_root().joinpath(*parts).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def dockerfile() -> str:
    return _read("Dockerfile")


@pytest.fixture(scope="module")
def attachment_formats_ts() -> str:
    return _read("frontend", "src", "lib", "attachmentFormats.ts")


class TestAttachmentCap:
    def test_the_frontend_mirrors_the_backend_size_cap(self, attachment_formats_ts):
        match = re.search(r"MAX_ATTACHMENT_MB\s*=\s*(\d+)", attachment_formats_ts)
        assert match, "attachmentFormats.ts must declare MAX_ATTACHMENT_MB"
        assert int(match.group(1)) == MAX_ATTACHMENT_MB, (
            "frontend/src/lib/attachmentFormats.ts and attachment_validation.py "
            "disagree about the attachment size cap — the browser would then let "
            "through a file the backend refuses, or refuse one it would accept."
        )

    def test_the_frontend_mirrors_the_accepted_extension_list(self, attachment_formats_ts):
        listed = set(re.findall(r'ext:\s*"(\.[^"]+)"', attachment_formats_ts))
        assert listed == set(ACCEPTED_EXTENSIONS), (
            "the picker's accept= list and the backend's table disagree: "
            f"only in frontend {sorted(listed - set(ACCEPTED_EXTENSIONS))}, "
            f"only in backend {sorted(set(ACCEPTED_EXTENSIONS) - listed)}"
        )

    def test_nginx_allows_slightly_more_than_the_backend_cap(self, dockerfile):
        """The edge must sit *above* the app's cap, not below it.

        Equal would be wrong too: multipart framing adds a boundary, part
        headers and the category field on top of the file itself, so a file of
        exactly the cap is a body of slightly more. One spare megabyte is what
        buys the user the app's readable 400 instead of nginx's 413.
        """
        sizes = re.findall(r"^\s*client_max_body_size (\d+)m;$", dockerfile, re.MULTILINE)
        assert sizes, "the Dockerfile must declare a global client_max_body_size"
        assert len(sizes) == 2, (
            "both generated server blocks (HTTP and HTTPS) must carry the global "
            f"limit — found {len(sizes)}"
        )
        for value in sizes:
            assert int(value) > MAX_ATTACHMENT_MB, (
                f"nginx caps the body at {value}m but the backend accepts "
                f"{MAX_ATTACHMENT_MB} MB — an upload in between dies at the edge "
                "with a raw 413 the user cannot act on."
            )


class TestWorkspaceImportCap:
    def _import_blocks(self, dockerfile: str) -> list[str]:
        return re.findall(
            r"location /api/v1/admin/workspace/import \{(.*?)\n    \}",
            dockerfile,
            re.DOTALL,
        )

    def test_both_server_blocks_carry_the_import_location(self, dockerfile):
        assert len(self._import_blocks(dockerfile)) == 2

    def test_nginx_accepts_bundles_as_large_as_the_backend_does(self, dockerfile):
        expected = f"client_max_body_size {MAX_BUNDLE_BYTES // 1024**3}g;"
        for block in self._import_blocks(dockerfile):
            assert expected in block, (
                f"the import location must raise the body limit to {expected} to "
                "match MAX_BUNDLE_BYTES in app/api/v1/workspace.py"
            )

    def test_the_import_body_is_streamed_not_spooled(self, dockerfile):
        """Buffered, nginx writes the whole bundle to its own disk first.

        That temp directory is an unbounded emptyDir on Kubernetes, and the
        backend already streams the upload to disk in chunks itself — so
        buffering here buys nothing and costs a second full copy.
        """
        for block in self._import_blocks(dockerfile):
            assert "proxy_request_buffering off;" in block
            # Unbuffered request bodies require HTTP/1.1 to the upstream.
            assert "proxy_http_version 1.1;" in block


class TestDeployManifestsAgree:
    """An ingress in front of the edge imposes its own cap; 512m would win."""

    PATHS = [
        ("charts", "turbo-ea", "values.yaml"),
        ("charts", "turbo-ea", "ci", "ingress-nginx-values.yaml"),
        ("charts", "turbo-ea", "examples", "values-azure.yaml"),
        ("deploy", "terraform", "kubernetes", "terraform.tfvars.example"),
        ("deploy", "terraform", "kubernetes", "tests", "main.tftest.hcl"),
    ]

    @pytest.mark.parametrize("parts", PATHS, ids=lambda p: p[-1])
    def test_no_manifest_still_advertises_the_old_limit(self, parts):
        text = _read(*parts)
        assert "512m" not in text, (
            f"{'/'.join(parts)} still caps uploads at 512m; the workspace import "
            f"now accepts {MAX_BUNDLE_BYTES // 1024**3} GB."
        )

    @pytest.mark.parametrize("parts", PATHS, ids=lambda p: p[-1])
    def test_every_manifest_naming_a_body_size_names_the_new_one(self, parts):
        text = _read(*parts)
        if "proxy-body-size" not in text:
            pytest.skip("this manifest does not configure an ingress body size")
        assert f"{MAX_BUNDLE_BYTES // 1024**3}g" in text
