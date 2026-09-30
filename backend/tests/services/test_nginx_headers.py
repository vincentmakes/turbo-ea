"""The edge nginx config carries the headers the weekly DAST scan checks for.

The first ZAP baseline run (2026-09-30) reported the nginx version in every
``Server`` header and an app CSP with no ``frame-ancestors`` — the app relied on
``X-Frame-Options`` alone, which CSP supersedes in every current browser. Both
are one-line fixes in the generated config, and both are the kind of line a
later edit to that 600-line heredoc drops without noticing, so they are pinned
here the way ``test_upload_limits`` pins ``client_max_body_size``.

The same run showed the entrypoint executing words from its own comments:
the nginx config is written through an UNQUOTED heredoc (it has to expand the
``${NGINX_*}`` variables), so a backtick inside a comment is a command
substitution at container start (``add_header: not found``). No backticks may
appear inside that heredoc.
"""

from __future__ import annotations

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
_DOCKERFILE = _ROOT / "Dockerfile"
_FRONTEND_NGINX = _ROOT / "frontend" / "nginx.conf"
_ENTRYPOINT_OPEN = "RUN cat <<'EOF' > /usr/local/bin/turboea-nginx-entrypoint"
_CSP_RE = re.compile(r'add_header Content-Security-Policy \\"([^"]*)\\" always;')


def _entrypoint() -> str:
    text = _DOCKERFILE.read_text(encoding="utf-8")
    assert _ENTRYPOINT_OPEN in text, "nginx entrypoint heredoc moved; update this test"
    body = text.split(_ENTRYPOINT_OPEN, 1)[1]
    return body.split("\nEOF\n", 1)[0]


class TestServerTokens:
    def test_every_edge_server_block_hides_the_version(self):
        script = _entrypoint()
        server_names = script.count("server_name ${NGINX_SERVER_NAME};")
        assert server_names >= 3, "expected the redirect, HTTPS and plain-HTTP server blocks"
        assert script.count("server_tokens off;") == server_names, (
            "every server block must carry `server_tokens off;` — ZAP 10036 flags the "
            "nginx version in the Server header otherwise"
        )

    def test_frontend_nginx_hides_the_version_too(self):
        assert "server_tokens off;" in _FRONTEND_NGINX.read_text(encoding="utf-8")


class TestContentSecurityPolicy:
    def test_every_csp_names_frame_ancestors(self):
        policies = _CSP_RE.findall(_entrypoint())
        assert len(policies) >= 8, f"expected the per-location CSPs, found {len(policies)}"
        missing = [p for p in policies if "frame-ancestors" not in p]
        assert not missing, (
            "a CSP without frame-ancestors has no fallback for framing (ZAP 10055); the app "
            f"locations use 'self', the embed locations ${{NGINX_EMBED_FRAME_ANCESTORS}}: {missing}"
        )

    def test_app_and_api_policies_are_self_framed_only(self):
        policies = _CSP_RE.findall(_entrypoint())
        app = [p for p in policies if "form-action 'self'" in p and "EMBED" not in p]
        assert app, "no app/api CSP found"
        assert all("frame-ancestors 'self'" in p for p in app), app


class TestGeneratedConfigHasNoBackticks:
    def test_no_command_substitution_inside_the_config_heredoc(self):
        # The config lives in the double-quoted `export NGINX_*_SERVER_BLOCK="server {` strings,
        # which the shell expands; a backtick in there — even in a comment — runs as a command.
        in_block, inside = False, []
        for line in _entrypoint().splitlines():
            if 'SERVER_BLOCK="server {' in line:
                in_block = True
            if in_block and "`" in line:
                inside.append(line.strip())
            if in_block and line.strip() == '}"':
                in_block = False
        assert not inside, f"backticks inside the generated nginx config run as commands: {inside}"
