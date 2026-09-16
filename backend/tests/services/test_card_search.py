"""Guards for the one definition of what a card search matches (#1108).

``alias`` is a real, importable, exportable card column that no search box
matched, because the ``name``/``description`` filter had been copy-pasted into
six endpoints. The helpers in ``app.services.card_search`` are now the single
definition, and the source scan below is what keeps the seventh copy from
being written.
"""

from __future__ import annotations

import pathlib
import re

from app.services.card_search import card_search_filter, card_search_rank

APP_DIR = pathlib.Path(__file__).resolve().parents[2] / "app"


def _compiled(clause) -> str:
    return str(clause.compile(compile_kwargs={"literal_binds": True}))


class TestSearchedColumns:
    def test_filter_covers_name_description_and_alias(self):
        sql = _compiled(card_search_filter("crm"))
        assert "cards.name" in sql
        assert "cards.description" in sql
        assert "cards.alias" in sql

    def test_rank_covers_only_the_name_like_columns(self):
        """A term buried in a paragraph says nothing about match quality."""
        sql = _compiled(card_search_rank("crm"))
        assert "cards.name" in sql
        assert "cards.alias" in sql
        assert "cards.description" not in sql

    def test_wildcards_stay_literal(self):
        """Every arm escapes, so a saved search for `100%` cannot match all rows."""
        sql = _compiled(card_search_filter("100%"))
        assert sql.count("100\\%") == 3


class TestNoSeventhCopy:
    """No endpoint may rebuild the card filter out of single-column helpers.

    A hand-rolled ``or_(search_filter(Card.name, …), search_filter(
    Card.description, …))`` is exactly the drift this module replaced: it
    silently omits the alias, and nothing else in the test suite would notice.
    """

    def test_no_module_pairs_the_card_name_and_description_filters(self):
        pattern = re.compile(r"search_filter\(\s*Card\.(name|description|alias)")
        offenders = []
        for path in APP_DIR.rglob("*.py"):
            if path.name == "card_search.py":
                continue
            if pattern.search(path.read_text()):
                offenders.append(str(path.relative_to(APP_DIR)))
        assert offenders == [], (
            "these modules filter card text directly instead of calling "
            f"card_search_filter(): {offenders}"
        )

    def test_no_module_ranks_cards_on_the_name_alone(self):
        pattern = re.compile(r"search_rank\(\s*Card\.(name|alias)")
        offenders = []
        for path in APP_DIR.rglob("*.py"):
            if path.name == "card_search.py":
                continue
            if pattern.search(path.read_text()):
                offenders.append(str(path.relative_to(APP_DIR)))
        assert offenders == [], (
            f"these modules rank cards directly instead of calling card_search_rank(): {offenders}"
        )
