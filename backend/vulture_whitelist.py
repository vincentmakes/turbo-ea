"""Names vulture reports as unused that a framework or protocol requires.

Read by ``vulture`` only (``[tool.vulture] paths`` in ``pyproject.toml``); it
is never imported. Each name is referenced once so vulture counts it as used,
with the reason it must stay. Add an entry only for a name that cannot be
removed — dead code is deleted, not listed here.
"""

# ruff: noqa: F821

# app/services/derived_writes.py `_pin_card_timestamps`: SQLAlchemy calls a
# Session "before_flush" listener as (session, flush_context, instances); the
# signature is fixed by the event API even though the listener reads only the
# session.
flush_context
instances

# app/services/email_backends/smtp.py: smtplib.SMTP.auth calls the authobject
# with the server's challenge; the XOAUTH2 initial response does not use it.
challenge
