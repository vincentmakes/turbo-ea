"""Names vulture reports as unused that a framework or protocol requires.

Read by ``vulture`` only (``[tool.vulture] paths`` in ``pyproject.toml``); it
is never imported, and it is not part of the installed package
(``[tool.setuptools.packages.find]``). Each name is referenced once so vulture
counts it as used, with the reason it must stay. Add an entry only for a name
that cannot be removed — dead code is deleted, not listed here.
"""

# ruff: noqa: F821

# turbo_ea_mcp/server.py `import_bpmn`: a public MCP tool parameter. FastMCP
# builds the tool's published input schema from the signature, so dropping it
# would break callers that send it; it is documented as the disambiguator for
# same-named BusinessProcess cards.
parent_card
