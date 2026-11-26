"""``hash_memory``: the source hashes handed out by ``get_untranslated_strings``,
kept per user session and language for ``submit_translations``."""

from __future__ import annotations

from turbo_ea_mcp import hash_memory as hm


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_the_bounds():
    assert (hm.MAX_ENTRIES, hm.MAX_KEYS_PER_ENTRY, hm.TTL_SECONDS) == (16, 20_000, 7200)


def test_recall_returns_only_the_submitted_keys():
    memory = hm.HashMemory()
    memory.remember("tok", "nl", {"common": {"a": "h1", "b": "h2"}, "admin": {"c": "h3"}})
    memory.remember("tok", "nl", {"common": {"d": "h4"}})
    assert memory.recall("tok", "nl", {"common": {"a": "x", "d": "y", "z": "?"}}) == {
        "common": {"a": "h1", "d": "h4"}
    }
    assert memory.recall("tok", "nl", {"admin": {"c": "x"}, "nav": {"q": "x"}}) == {
        "admin": {"c": "h3"}
    }


def test_a_later_page_replaces_a_hash():
    memory = hm.HashMemory()
    memory.remember("tok", "nl", {"common": {"a": "old"}})
    memory.remember("tok", "nl", {"common": {"a": "new"}})
    assert memory.recall("tok", "nl", {"common": {"a": ""}}) == {"common": {"a": "new"}}


def test_never_across_users_or_languages():
    memory = hm.HashMemory()
    memory.remember("tok-a", "nl", {"common": {"a": "h1"}})
    assert memory.recall("tok-b", "nl", {"common": {"a": ""}}) == {}
    assert memory.recall("tok-a", "fy", {"common": {"a": ""}}) == {}


def test_the_token_itself_is_never_kept():
    memory = hm.HashMemory()
    memory.remember("secret-token", "nl", {"c": {"a": "h"}})
    assert all("secret-token" not in owner for owner, _locale in memory._entries)
    assert hm._owner("secret-token") == hm._owner("secret-token") != hm._owner("other")
    assert len(hm._owner("x")) == 64


def test_a_value_that_is_not_text_is_ignored():
    memory = hm.HashMemory()
    memory.remember("tok", "nl", {"c": {"a": None, "b": 5, "d": "h"}})
    assert memory.recall("tok", "nl", {"c": {"a": "", "b": "", "d": ""}}) == {"c": {"d": "h"}}


def test_an_entry_expires(monkeypatch):
    clock = Clock()
    memory = hm.HashMemory(clock=clock)
    memory.remember("tok", "nl", {"c": {"a": "h"}})
    clock.now += hm.TTL_SECONDS
    assert memory.recall("tok", "nl", {"c": {"a": ""}}) == {"c": {"a": "h"}}
    clock.now += 1
    assert memory.recall("tok", "nl", {"c": {"a": ""}}) == {}
    assert memory._entries == {}


def test_a_page_after_expiry_starts_a_fresh_entry():
    clock = Clock()
    memory = hm.HashMemory(clock=clock)
    memory.remember("tok", "nl", {"c": {"a": "old"}})
    clock.now += hm.TTL_SECONDS + 1
    memory.remember("tok", "nl", {"c": {"b": "new"}})
    # The expired page's hash is gone, not revived with the new page's stamp.
    assert memory.recall("tok", "nl", {"c": {"a": "", "b": ""}}) == {"c": {"b": "new"}}


def test_the_least_recently_used_entry_goes_first(monkeypatch):
    monkeypatch.setattr(hm, "MAX_ENTRIES", 2)
    memory = hm.HashMemory()
    memory.remember("t1", "nl", {"c": {"a": "1"}})
    memory.remember("t2", "nl", {"c": {"a": "2"}})
    assert memory.recall("t1", "nl", {"c": {"a": ""}})  # t1 is now the most recent
    memory.remember("t3", "nl", {"c": {"a": "3"}})
    assert memory.recall("t2", "nl", {"c": {"a": ""}}) == {}
    assert memory.recall("t1", "nl", {"c": {"a": ""}}) == {"c": {"a": "1"}}
    assert memory.recall("t3", "nl", {"c": {"a": ""}}) == {"c": {"a": "3"}}


def test_the_keys_per_entry_are_bounded(monkeypatch):
    monkeypatch.setattr(hm, "MAX_KEYS_PER_ENTRY", 2)
    memory = hm.HashMemory()
    memory.remember("tok", "nl", {"c": {"a": "1", "b": "2", "d": "3"}})
    # A new key past the bound is skipped, and the keys after it still count:
    # one already kept is updated.
    memory.remember("tok", "nl", {"c": {"e": "4", "a": "9"}, "x": {"f": "5", "b": "?"}})
    assert memory.recall(
        "tok", "nl", {"c": {"a": "", "b": "", "d": "", "e": ""}, "x": {"f": "", "b": ""}}
    ) == {"c": {"a": "9", "b": "2"}}


def test_the_shared_memory_is_one_instance():
    assert isinstance(hm.MEMORY, hm.HashMemory)
