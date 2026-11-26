"""The source hashes ``get_untranslated_strings`` handed out, remembered so
``submit_translations`` can attach them without the assistant echoing them.

A source hash says which English text a translation was made from; with it the
backend skips a ``metamodel`` name that was renamed since it was read
(``source_changed``). Asking the assistant to copy every key twice — once in
``translations``, once in ``source_hashes`` — doubled what it had to write.

The memory is in-process and best-effort: keyed on a digest of the caller's
Turbo EA token (one user's session; never shared across users) and the
language code, bounded in entries, keys and age. A lost entry (restart, expiry,
a refreshed token) only means a submit goes without hashes, which the backend
accepts for MCP writes, as before this memory existed.
"""

from __future__ import annotations

import hashlib
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Mapping

#: Sessions × languages remembered at once (least recently used dropped). A
#: refreshed token is a new session, so one administrator can use several.
MAX_ENTRIES = 16
#: Keys remembered per session and language (a language has about 8 000).
MAX_KEYS_PER_ENTRY = 20_000
#: Seconds an entry is kept after it was last written.
TTL_SECONDS = 2 * 60 * 60

Hashes = dict[str, dict[str, str]]


def _owner(token: str) -> str:
    """A digest of the token: the memory never holds the token itself."""
    return hashlib.sha256(token.encode()).hexdigest()


class HashMemory:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._entries: OrderedDict[tuple[str, str], tuple[float, Hashes]] = OrderedDict()
        self._lock = threading.Lock()

    def remember(self, token: str, locale: str, hashes: Mapping[str, Mapping[str, str]]) -> None:
        """Add the hashes of one page (``{namespace: {key: hash}}``)."""
        key = (_owner(token), locale)
        with self._lock:
            self._expire()
            _stamp, stored = self._entries.pop(key, (0.0, {}))
            count = sum(len(keys) for keys in stored.values())
            for namespace, keys in hashes.items():
                for name, digest in keys.items():
                    if not isinstance(digest, str):
                        continue
                    bucket = stored.setdefault(namespace, {})
                    if name not in bucket:
                        if count >= MAX_KEYS_PER_ENTRY:
                            continue
                        count += 1
                    bucket[name] = digest
            self._entries[key] = (self._clock(), stored)
            while len(self._entries) > MAX_ENTRIES:
                self._entries.popitem(last=False)

    def recall(self, token: str, locale: str, translations: Mapping[str, Mapping]) -> Hashes:
        """The remembered hashes of the keys in ``translations`` (only those)."""
        key = (_owner(token), locale)
        with self._lock:
            self._expire()
            entry = self._entries.get(key)
            if entry is None:
                return {}
            self._entries.move_to_end(key)
            stored = entry[1]
        out: Hashes = {}
        for namespace, keys in translations.items():
            known = stored.get(namespace) or {}
            found = {name: known[name] for name in keys if name in known}
            if found:
                out[namespace] = found
        return out

    def _expire(self) -> None:
        cutoff = self._clock() - TTL_SECONDS
        for key in [k for k, (stamp, _h) in self._entries.items() if stamp < cutoff]:
            del self._entries[key]


#: The memory the server's tools share.
MEMORY = HashMemory()
