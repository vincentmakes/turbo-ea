"""The backend image carries the English UI strings custom languages need.

``language_pack`` diffs, validates and exports against
``frontend/src/i18n/locales/en``; the backend image is built from the backend
directory, so the files only arrive through two explicit ``COPY`` lines. Break
either and every custom-language management route answers 503 in production
while the test suite, which reads the checkout, stays green — hence checking
the build files themselves. Reads files off disk only.
"""

from __future__ import annotations

from pathlib import Path

from app.services import language_pack as lp

ROOT = Path(__file__).resolve().parents[3]


def test_the_dockerfile_copies_the_english_files_into_the_backend_image():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    build, runtime = dockerfile.split("FROM python:3.12-alpine AS backend\n", 1)
    assert "COPY frontend/src/i18n/locales/en/ ./i18n/en/" in build
    assert "COPY --from=backend-build /app/i18n ./i18n" in runtime.split("\nFROM ", 1)[0]


def test_the_build_context_keeps_the_english_files():
    ignored = [
        line.strip()
        for line in (ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    for pattern in ("frontend", "frontend/", "frontend/src", "*.json", "frontend/src/i18n"):
        assert pattern not in ignored, pattern


def test_the_image_path_is_the_first_default_candidate():
    here = Path("/app/app/services/language_pack.py")
    assert lp.english_dir_candidates(None, here)[0] == Path("/app/i18n/en")


def test_the_checkout_has_the_english_files():
    found = lp.find_english_dir(None)
    assert found == ROOT / "frontend" / "src" / "i18n" / "locales" / "en"
