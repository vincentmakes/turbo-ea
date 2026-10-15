"""The edge nginx learns the real client address only from proxies it trusts.

Behind a load balancer or an ingress controller, ``$remote_addr`` is the hop in
front of nginx, so the security audit log recorded the load balancer for every
sign-in and the per-client sign-in rate limit put every user in one bucket.
``NGINX_TRUSTED_PROXIES`` turns on nginx's realip module for exactly the
addresses an operator names: ``X-Forwarded-For`` is honoured only on a
connection from one of them, ``$remote_addr`` becomes the client, and the
``X-Real-IP $remote_addr`` header every backend-bound location already sends
carries it to the backend (``core/request_context.py``) with no backend change.

These tests read the nginx entrypoint off ``/Dockerfile`` the way
``test_upload_limits`` and ``test_nginx_headers`` do, and run the block that
builds the directives under ``sh`` so the empty default, the list parsing and
the refusal of anything that is not an address are pinned by behaviour.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.source_scan

_ROOT = Path(__file__).resolve().parents[3]
_DOCKERFILE = _ROOT / "Dockerfile"
_ENTRYPOINT_OPEN = "RUN cat <<'EOF' > /usr/local/bin/turboea-nginx-entrypoint"
_BLOCK_START = "nginx_real_ip_lines=''"
_LOCATION_RE = re.compile(r"^(    location [^\n]*\{)\n(.*?)^    \}", re.M | re.S)
_SH = shutil.which("sh")


def _entrypoint() -> str:
    text = _DOCKERFILE.read_text(encoding="utf-8")
    assert _ENTRYPOINT_OPEN in text, "nginx entrypoint heredoc moved; update this test"
    body = text.split(_ENTRYPOINT_OPEN, 1)[1]
    return body.split("\nEOF\n", 1)[0]


def _real_ip_snippet() -> str:
    """The shell lines that build ``$nginx_real_ip_lines``, up to the closing ``fi``."""
    script = _entrypoint()
    assert _BLOCK_START in script, "the NGINX_TRUSTED_PROXIES block moved; update this test"
    tail = script.split(_BLOCK_START, 1)[1]
    end = tail.index("real_ip_recursive on;")
    closing = tail.index("\nfi\n", end)
    return _BLOCK_START + tail[: closing + len("\nfi\n")]


def _render(value: str | None) -> subprocess.CompletedProcess[str]:
    assert _SH is not None
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin")}
    if value is not None:
        env["NGINX_TRUSTED_PROXIES"] = value
    script = "set -eu\n" + _real_ip_snippet() + 'printf "%s" "$nginx_real_ip_lines"\n'
    return subprocess.run(
        [_SH, "-c", script], capture_output=True, text=True, env=env, check=False, timeout=10
    )


class TestDirectivesAreGuarded:
    def test_the_three_directives_are_built_from_the_variable(self):
        snippet = _real_ip_snippet()
        assert "${NGINX_TRUSTED_PROXIES:-}" in snippet
        assert "set_real_ip_from ${proxy};" in snippet
        assert "real_ip_header X-Forwarded-For;" in snippet
        assert "real_ip_recursive on;" in snippet

    def test_nothing_outside_the_block_turns_realip_on(self):
        # A literal directive anywhere else would apply whatever the variable says.
        script = _entrypoint()
        outside = "\n".join(
            line
            for line in script.replace(_real_ip_snippet(), "").splitlines()
            if not line.lstrip().startswith("#")
        )
        for directive in ("set_real_ip_from", "real_ip_header", "real_ip_recursive"):
            assert directive not in outside, f"{directive} must only come from the guarded block"

    def test_every_server_block_receives_the_lines(self):
        script = _entrypoint()
        servers = script.count("server_name ${NGINX_SERVER_NAME};\n    server_tokens off;\n")
        assert servers >= 3, "expected the redirect, HTTPS and plain-HTTP server blocks"
        placed = script.count(
            "server_name ${NGINX_SERVER_NAME};\n    server_tokens off;\n${nginx_real_ip_lines}\n"
        )
        assert placed == servers, "every server block must carry ${nginx_real_ip_lines}"


@pytest.mark.skipif(_SH is None, reason="no POSIX shell to run the entrypoint fragment")
class TestRenderedDirectives:
    @pytest.mark.parametrize("value", [None, "", " , "])
    def test_unset_or_empty_emits_nothing(self, value):
        result = _render(value)
        assert result.returncode == 0, result.stderr
        assert result.stdout == ""

    def test_comma_and_space_separated_entries(self):
        result = _render("10.0.0.0/8, 172.16.0.0/12 fd00::/8,130.211.0.0/22")
        assert result.returncode == 0, result.stderr
        assert result.stdout.splitlines() == [
            "    set_real_ip_from 10.0.0.0/8;",
            "    set_real_ip_from 172.16.0.0/12;",
            "    set_real_ip_from fd00::/8;",
            "    set_real_ip_from 130.211.0.0/22;",
            "    real_ip_header X-Forwarded-For;",
            "    real_ip_recursive on;",
        ]

    @pytest.mark.parametrize(
        "value",
        ["10.0.0.0/8;evil", "*", "0.0.0.0/0}", "proxy.internal", "10.0.0.1 $remote_addr"],
    )
    def test_anything_but_an_address_is_refused(self, value):
        # The value lands unquoted inside the generated config.
        result = _render(value)
        assert result.returncode != 0
        assert "NGINX_TRUSTED_PROXIES" in result.stderr
        assert "set_real_ip_from" not in result.stdout

    @pytest.mark.parametrize(
        "value",
        [
            "10.0.0.0/8/8",
            "1.2.3",
            "256.1.1.1",
            "1.2.3.4.5",
            "1..2.3",
            "1.2.3.4/",
            "10.0.0.1/33",
            "/8",
            "::::",
            ":",
            "1:2::3::4",
            "2001:db8::/129",
            "12345::1",
            "deadbeef",
        ],
    )
    def test_a_malformed_address_or_prefix_is_refused(self, value):
        # Only the right characters is not enough: nginx would refuse the
        # config at start, or read a different range than the operator meant.
        result = _render(value)
        assert result.returncode != 0, result.stdout
        assert "NGINX_TRUSTED_PROXIES" in result.stderr
        assert value in result.stderr
        assert "set_real_ip_from" not in result.stdout

    @pytest.mark.parametrize(
        "value",
        [
            "10.0.0.0/8",
            "192.168.1.5",
            "0.0.0.0/0",
            "255.255.255.255/32",
            "2001:db8::/32",
            "fe80::1",
            "::1",
            "fd00::/8",
            "2001:db8:0:0:0:0:0:1/128",
        ],
    )
    def test_a_well_formed_address_or_range_is_accepted(self, value):
        result = _render(value)
        assert result.returncode == 0, result.stderr
        assert result.stdout.splitlines()[0] == f"    set_real_ip_from {value};"

    def test_one_bad_entry_refuses_the_whole_list(self):
        result = _render("10.0.0.0/8, 10.0.0.1/33")
        assert result.returncode != 0
        assert "10.0.0.1/33" in result.stderr


class TestBackendStillGetsTheClient:
    def test_every_backend_location_sends_x_real_ip(self):
        backend = [
            (opener.strip(), body)
            for opener, body in _LOCATION_RE.findall(_entrypoint())
            if "proxy_pass \\$backend_upstream" in body
        ]
        assert len(backend) >= 8, f"expected four backend locations per server block: {backend}"
        missing = [
            o for o, body in backend if "proxy_set_header X-Real-IP \\$remote_addr;" not in body
        ]
        assert not missing, (
            "the backend reads the client address from X-Real-IP; these locations stopped "
            f"sending it: {missing}"
        )

    def test_the_mcp_endpoints_send_x_real_ip(self):
        # The OAuth metadata routes only rewrite to a static document; the MCP
        # endpoint itself carries the caller's requests on to the backend.
        mcp = [
            (opener.strip(), body)
            for opener, body in _LOCATION_RE.findall(_entrypoint())
            if opener.strip() in ("location = /mcp {", "location /mcp/ {")
        ]
        assert len(mcp) >= 4, mcp
        missing = [o for o, body in mcp if "proxy_set_header X-Real-IP \\$remote_addr;" not in body]
        assert not missing, missing


class TestNoBackticks:
    def test_the_entrypoint_contains_no_backtick(self):
        # The server blocks are double-quoted shell strings, so a backtick in them
        # is a command substitution at container start; keeping the whole
        # entrypoint free of them means a block moved into a string cannot carry one.
        offenders = [line.strip() for line in _entrypoint().splitlines() if "`" in line]
        assert not offenders, offenders
