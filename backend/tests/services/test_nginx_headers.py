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

import pytest

_ROOT = Path(__file__).resolve().parents[3]
_DOCKERFILE = _ROOT / "Dockerfile"
_FRONTEND_NGINX = _ROOT / "frontend" / "nginx.conf"
_ENTRYPOINT_OPEN = "RUN cat <<'EOF' > /usr/local/bin/turboea-nginx-entrypoint"
_CSP_RE = re.compile(r'add_header Content-Security-Policy \\"([^"]*)\\" always;')
# The SPA and the embed page are the two policies that load the Google Fonts
# stylesheets; this exact source list is what identifies them.
_SPA_STYLE_SRC = ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]
_SCHEME_ONLY = {"https:", "http:", "data:", "blob:"}
# A `location { ... }` block of the generated config; blocks never nest there.
_LOCATION_RE = re.compile(r"^(    location [^\n]*\{)\n(.*?)^    \}", re.M | re.S)
# The response-level headers every location that speaks add_header must repeat.
# X-Frame-Options and the CSP are page-level and belong to HTML responses only.
_RESPONSE_HEADERS = ("X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy")


def _directives(policy: str) -> dict[str, list[str]]:
    """Parse a CSP header value into {directive: [source tokens]}."""
    out: dict[str, list[str]] = {}
    for directive in policy.split(";"):
        name, _, sources = directive.strip().partition(" ")
        if name:
            out[name] = sources.split()
    return out


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

    # ZAP's CSP rule (10055) is IGNOREd in .github/zap-rules.tsv because two of
    # its findings are deliberate — `img-src https:` and Emotion's
    # `style-src 'unsafe-inline'` — and the rules file cannot accept a
    # sub-alert without accepting the plugin. These two tests are what keep
    # that IGNORE from hiding a real regression: the SPA and the embed page
    # run the app bundle alone, and no policy may open a scriptable directive
    # to the world. Policies are compared as parsed directives, never as
    # substrings of the header string.
    def test_spa_and_embed_policies_run_only_the_bundle(self):
        spa = [
            d
            for d in map(_directives, _CSP_RE.findall(_entrypoint()))
            if d.get("style-src") == _SPA_STYLE_SRC
        ]
        assert len(spa) >= 4, f"expected the SPA and embed policies of both server blocks: {spa}"
        loose = [d for d in spa if d.get("script-src") != ["'self'"]]
        assert not loose, (
            "the SPA / embed CSP must keep `script-src 'self'` exact — no inline, no eval, "
            f"no CDN: {loose}"
        )

    def test_no_scriptable_directive_is_open_to_the_world(self):
        offenders = []
        for directives in map(_directives, _CSP_RE.findall(_entrypoint())):
            for name in ("script-src", "connect-src", "frame-src", "object-src", "base-uri"):
                tokens = directives.get(name, [])
                if "*" in tokens or any(t in _SCHEME_ONLY for t in tokens):
                    offenders.append((name, tokens))
        assert not offenders, (
            f"wildcard or scheme-only source on a scriptable directive: {offenders}"
        )


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


class TestEveryLocationKeepsTheSecurityHeaders:
    """nginx's add_header in a location REPLACES the inherited set.

    So a location that adds even one header of its own (a Cache-Control, an
    X-Robots-Tag) silently drops every security header the server block
    declared. `location ^~ /drawio/` did exactly that: it carried the two
    caching headers and nothing else, and every DrawIO script, stylesheet and
    image left the edge without X-Content-Type-Options or Permissions-Policy —
    ZAP 10021 and 10063 in the 2026-09-30 DAST run (36770264921), the first
    whose crawl reached the diagram editor. A location that adds no header at
    all inherits the set and is fine.
    """

    @pytest.mark.parametrize("header", _RESPONSE_HEADERS)
    def test_every_header_adding_location_redeclares(self, header: str):
        script = _entrypoint()
        offenders = [
            opener.strip()
            for opener, body in _LOCATION_RE.findall(script)
            if "add_header" in body and header not in body
        ]
        assert not offenders, (
            f"these locations add headers of their own and so lose the inherited {header}; "
            f"re-declare it (add_header replaces the inherited set): {offenders}"
        )

    def test_the_scan_covers_the_drawio_locations(self):
        openers = [opener for opener, _ in _LOCATION_RE.findall(_entrypoint())]
        assert sum("/drawio/" in o for o in openers) >= 4, openers
        assert sum("/drawio-embed/" in o for o in openers) >= 2, openers
