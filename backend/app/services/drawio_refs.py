"""Card references inside a DrawIO diagram's XML.

A card on a diagram is a cell whose user object carries ``cardId="<uuid>"``.
The diagrams API reads those ids to search, count and link a diagram's cards,
and workspace transfer rewrites them when cards land under new ids — so the
pattern lives here, in a service module both can import (``services`` must not
import from ``api``).
"""

from __future__ import annotations

import re

# Faster than full XML parsing and safe here because the attribute value is a
# UUID. A still-pending cell carries ``cardId="pending-…"``, which never matches.
CARD_ID_RE = re.compile(r'cardId="([0-9a-fA-F-]{36})"')


def extract_card_refs(data: dict | None) -> list[str]:
    """Return the de-duplicated card UUIDs found in a diagram's XML, in order."""
    xml = (data or {}).get("xml", "")
    if not xml:
        return []
    return list(dict.fromkeys(CARD_ID_RE.findall(xml)))
