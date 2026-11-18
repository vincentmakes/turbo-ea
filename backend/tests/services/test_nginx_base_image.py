"""Both nginx images are built on a pinned, patched nginx release.

The ``frontend`` and edge ``nginx`` stages of ``/Dockerfile`` start from the
official ``nginx:<version>-alpine`` image, so the nginx binary we ship is
whatever that tag holds. 1.30.6 and earlier carry the "nginx2root" bugs fixed
in 1.30.7 / 1.31.9 (2026-11-18): CVE-2026-123007 (HTTP/2 flow-control memory
corruption, unauthenticated code execution), CVE-2026-123633 (HTTP/2
use-after-free), CVE-2026-123634 (resolver use-after-free), CVE-2026-121810
(HTTP/3), CVE-2026-113425 (mail proxy), CVE-2026-118899 (endless loop reading
a request body over TLS 1.3) and CVE-2026-125283 (``try_files`` with
``alias``). The edge config turns on ``http2`` whenever built-in TLS is on, so
the HTTP/2 bugs were reachable on those installs.

A moving tag (``nginx:alpine``) is what let CVE-2026-42945 ship unnoticed in
May 2026, so the version must be an exact pin, the same in both stages, and
never below the floor this file names. Raise the floor when a later advisory
moves it; never lower it.
"""

from __future__ import annotations

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
_DOCKERFILE = _ROOT / "Dockerfile"
_NGINX_FROM_RE = re.compile(r"^FROM\s+nginx:(\S+)\s+AS\s+(\S+)\s*$", re.M | re.I)
_PINNED_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)-alpine$")
# The first stable release past the nginx2root advisories (nginx.org, 2026-11-18).
_MIN_NGINX = (1, 30, 7)


def _nginx_stages() -> dict[str, str]:
    text = _DOCKERFILE.read_text(encoding="utf-8")
    return {stage: tag for tag, stage in _NGINX_FROM_RE.findall(text)}


def test_both_nginx_stages_are_built_on_the_nginx_image() -> None:
    assert set(_nginx_stages()) == {"frontend", "nginx"}


def test_nginx_tag_is_an_exact_alpine_pin() -> None:
    for stage, tag in _nginx_stages().items():
        assert _PINNED_RE.match(tag), f"{stage} stage uses a moving tag: nginx:{tag}"


def test_both_nginx_stages_pin_the_same_release() -> None:
    assert len(set(_nginx_stages().values())) == 1, _nginx_stages()


def test_nginx_release_is_past_the_nginx2root_advisories() -> None:
    for stage, tag in _nginx_stages().items():
        match = _PINNED_RE.match(tag)
        assert match, tag
        version = tuple(int(part) for part in match.groups())
        assert version >= _MIN_NGINX, (
            f"{stage} stage runs nginx {tag}; nginx2root is fixed from "
            f"{'.'.join(map(str, _MIN_NGINX))}"
        )
