"""The picture format in decision and SoAW text (``document_image_markup``) and
its interplay with mentions (``document_collab.settle_markup``). Pure: no
database."""

from __future__ import annotations

import time

import pytest

from app.services import document_image_markup as markup
from app.services.document_collab import settle_markup
from app.services.document_image_markup import (
    canonical_img,
    escape_attribute,
    image_id_of_src,
    image_ids_of,
    normalise_images,
    serialise,
    src_for,
)
from app.services.mention_service import DOCUMENT_KINDS, canonicalise

ID = "0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0"
OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
CARD = "11111111-2222-4333-8444-555555555555"
SRC = f"/api/v1/document-images/adr/{ID}"
SOAW_SRC = f"/api/v1/document-images/soaw/{ID}"


def _n(html: str, kind: str = "adr", **kw) -> str:
    out = normalise_images(html, kind, **kw)
    # Every result is a fixed point.
    assert normalise_images(out, kind, **kw) == out
    return out


class TestCanonicalForm:
    def test_the_full_canonical_tag(self):
        html = f'<img src="{SRC}" alt="A" title="T" width="320" height="200" data-align="center">'
        assert _n(html) == html

    def test_attributes_come_out_in_the_editor_order(self):
        html = f'<img data-align="right" height="2" width="1" title="t" alt="a" src="{SRC}">'
        assert _n(html) == (
            f'<img src="{SRC}" alt="a" title="t" width="1" height="2" data-align="right">'
        )

    def test_the_minimal_tag_is_stable(self):
        assert _n(f'<p>x</p><img src="{SRC}"><p>y</p>') == f'<p>x</p><img src="{SRC}"><p>y</p>'

    def test_quoting_case_and_self_closing_are_canonicalised(self):
        html = f"<IMG SRC='{SRC.replace(ID, ID.upper())}' WIDTH=12 />"
        assert _n(html) == f'<img src="{SRC}" width="12">'

    def test_every_other_attribute_is_stripped(self):
        html = (
            f'<img src="{SRC}" onerror="alert(1)" style="x" srcset="https://e/x.png 2x" '
            'loading="lazy" class="c" data-x="y">'
        )
        assert _n(html) == f'<img src="{SRC}">'

    def test_the_first_of_a_repeated_attribute_counts(self):
        assert _n(f'<img src="{SRC}" src="https://e/x.png" width="5" width="6">') == (
            f'<img src="{SRC}" width="5">'
        )
        assert _n(f'<img src="https://e/x.png" src="{SRC}">') == ""

    @pytest.mark.parametrize(
        ("value", "kept"),
        [
            ("1", "1"),
            ("4000", "4000"),
            ("0320", "320"),
            ("0", None),
            ("4001", None),
            ("12.5", None),
            ("100px", None),
            ("-3", None),
            (" 12", None),
            ("12345", None),
            ("", None),
        ],
        ids=lambda v: repr(v),
    )
    def test_dimensions(self, value, kept):
        out = _n(f'<img src="{SRC}" width="{value}" height="{value}">')
        expected = f' width="{kept}" height="{kept}"' if kept else ""
        assert out == f'<img src="{SRC}"{expected}>'

    @pytest.mark.parametrize(
        ("value", "kept"),
        [("center", True), ("right", True), ("left", False), ("CENTER", False), ("", False)],
    )
    def test_alignment(self, value, kept):
        out = _n(f'<img src="{SRC}" data-align="{value}">')
        assert out == (f'<img src="{SRC}" data-align="{value}">' if kept else f'<img src="{SRC}">')

    def test_alt_and_title_are_escaped_as_the_editor_does(self):
        out = _n(f"<img src=\"{SRC}\" alt='a\"<b>&c' title='x y'>")
        assert out == f'<img src="{SRC}" alt="a&quot;&lt;b&gt;&amp;c" title="x&nbsp;y">'

    def test_a_valueless_alt_is_an_empty_one(self):
        assert _n(f'<img src="{SRC}" alt>') == f'<img src="{SRC}" alt="">'

    def test_image_is_read_as_img(self):
        assert _n(f'<image src="{SRC}" width="10">') == f'<img src="{SRC}" width="10">'
        assert _n('<image src="https://e/x.png">') == ""


class TestDropped:
    @pytest.mark.parametrize(
        "src",
        [
            "https://evil.example/p.png",
            "//evil.example/p.png",
            "data:image/png;base64,iVBORw0KGgo=",
            "blob:https://app/1234",
            "javascript:alert(1)",
            f"https://app.example{SRC}",
            f"{SRC}?x=1",
            f" {SRC}",
            SOAW_SRC,
            "/api/v1/document-images/adr/not-a-uuid",
            f"/api/v1/document-images/ADR/{ID}",
            f"/api/v1/document-images/pdf/{ID}",
            "",
        ],
    )
    def test_any_other_src_drops_the_whole_img(self, src):
        assert _n(f'<p>a<img src="{src}" width="5">b</p>') == "<p>ab</p>"

    def test_an_img_without_src_is_dropped(self):
        assert _n('<p><img alt="x"></p>') == "<p></p>"

    def test_the_kind_is_the_document_kind(self):
        assert _n(f'<img src="{SOAW_SRC}">', "soaw") == f'<img src="{SOAW_SRC}">'
        assert _n(f'<img src="{SRC}">', "soaw") == ""

    def test_an_unknown_kind_is_refused(self):
        with pytest.raises(ValueError):
            normalise_images("<p></p>", "pdf")

    def test_keep_drops_a_refused_id(self):
        html = f'<img src="{SRC}"><img src="{SRC.replace(ID, OTHER)}">'
        assert _n(html, keep={ID}.__contains__) == f'<img src="{SRC}">'
        assert _n(html, keep=set().__contains__) == ""


class TestHostileMarkup:
    def test_an_img_in_an_attribute_value_or_a_comment_is_removed(self):
        html = '<a title="<img src=x onerror=alert(1)>">t</a><!-- <img src=y> -->'
        assert _n(html) == '<a title="">t</a><!--  -->'

    def test_a_canonical_img_where_the_parser_saw_text_is_kept(self):
        html = f"<a title='<img src=\"{SRC}\">'>t</a>"
        assert _n(html) == html

    def test_an_img_in_script_is_found(self):
        assert _n('<script><img src="https://e/x.png"></script>') == "<script></script>"

    def test_an_unterminated_tag_at_the_end_is_removed(self):
        assert _n(f'<p>x</p><img src="{SRC}"') == "<p>x</p>"
        assert _n("<p>x</p><img") == "<p>x</p>"

    def test_removing_a_tag_cannot_splice_a_new_one(self):
        assert _n('<im<img src=x>g src="https://evil.example/p.png">') == ""
        assert _n(f'<im<img src=x>g src="{SRC}">') == f'<img src="{SRC}">'

    def test_markup_that_keeps_assembling_is_escaped(self):
        html = "<im" * 12 + "<img src=x>" + "g src=x>" * 12
        out = _n(html)
        assert "<img" not in out.lower()
        assert "&lt;img" in out

    def test_text_that_only_looks_like_a_tag_passes(self):
        html = "<p>&lt;img src=x&gt; <imgx> <ima></p>"
        assert normalise_images(html, "adr") is html

    @pytest.mark.parametrize(
        "html",
        [
            "<img " * 30_000,
            "<img " * 30_000 + ">",
            "<img src=x>" * 30_000,
            "<image" * 30_000,
            "<im" * 30_000 + "<img src=x>" + "g>" * 30_000,
            '<img alt="' * 30_000,
        ],
        ids=["open", "one-tag", "many", "image", "nested", "quotes"],
    )
    def test_hostile_input_is_linear(self, html):
        start = time.perf_counter()
        out = normalise_images(html, "adr")
        assert time.perf_counter() - start < 3
        assert normalise_images(out, "adr") == out


class TestPassThrough:
    def test_text_without_a_picture_is_the_same_object(self):
        html = '<p>Hello <strong>world</strong> <a href="https://x">x</a></p>'
        assert normalise_images(html, "adr") is html

    def test_everything_around_a_picture_stays_byte_for_byte(self):
        around = '<p class="a">x &amp; y</p>\n<ul><li>  z</li></ul>'
        html = f'{around}<img src="https://e/x.png">{around}'
        assert _n(html) == around + around


class TestHelpers:
    def test_image_ids_of(self):
        html = f'<img src="{SRC}" width="2"><p>x</p><img src="{SOAW_SRC.replace(ID, OTHER)}">'
        assert image_ids_of(html) == {ID, OTHER}
        assert image_ids_of("<p>none</p>") == set()
        assert image_ids_of(None) == set()
        assert image_ids_of(f"<IMG SRC='{SRC}'>") == set()

    def test_src_round_trip(self):
        assert src_for("adr", ID) == SRC
        assert image_id_of_src(SRC, "adr") == ID
        assert image_id_of_src(SRC.replace(ID, ID.upper()), "adr") == ID
        assert image_id_of_src(SRC, "soaw") is None
        assert image_id_of_src(None, "adr") is None

    def test_serialise_and_escape(self):
        assert serialise({"data-align": "right", "src": "s", "width": "3"}) == (
            '<img src="s" width="3" data-align="right">'
        )
        assert escape_attribute('&"<> ') == "&amp;&quot;&lt;&gt;&nbsp;"
        assert canonical_img([("alt", "x")], "adr") is None
        assert markup.ATTRIBUTE_ORDER == ("src", "alt", "title", "width", "height", "data-align")


class TestWithMentions:
    """``settle_markup``: removing a picture can splice a mention and removing a
    mention can splice a picture; both passes run until stable."""

    def _save(self, html: str) -> str:
        """The three steps of ``before_save`` on one text: pictures, mentions,
        then pictures and mentions until stable."""
        first = normalise_images(html, "adr")
        return settle_markup(canonicalise(first, DOCUMENT_KINDS), "adr")

    def test_a_picture_removed_from_inside_a_span_splices_a_mention(self):
        html = (
            f'<p><sp<img src=x>an data-type="mention" data-kind="card" data-id="{CARD}"></span></p>'
        )
        assert self._save(html) == (
            f'<p><span data-type="mention" data-kind="card" data-id="{CARD}"></span></p>'
        )

    def test_a_mention_removed_from_inside_an_img_splices_a_picture(self):
        bogus = '<span data-type="mention" data-kind="bogus" data-id="x"></span>'
        evil = f'<p><im{bogus}g src="https://evil.example/p.png"></p>'
        assert self._save(evil) == "<p></p>"
        stored = f'<p><im{bogus}g src="{SRC}" width="5"></p>'
        assert self._save(stored) == f'<p><img src="{SRC}" width="5"></p>'

    def test_the_last_picture_pass_reruns_the_mention_pass(self):
        bogus = '<span data-type="mention" data-kind="bogus"></span>'
        html = (
            f"<p><sp<im{bogus}g src=x>an "
            f'data-type="mention" data-kind="card" data-id="{CARD}"></span></p>'
        )
        after_mentions = canonicalise(normalise_images(html, "adr"), DOCUMENT_KINDS)
        assert "<sp<img src=x>an" in after_mentions
        assert settle_markup(after_mentions, "adr") == (
            f'<p><span data-type="mention" data-kind="card" data-id="{CARD}"></span></p>'
        )

    def test_settle_keeps_only_allowed_pictures(self):
        html = f'<p><img src="{SRC}"></p>'
        assert settle_markup(html, "adr", keep=set().__contains__) == "<p></p>"
        assert settle_markup(html, "adr", keep={ID}.__contains__) == html

    def test_markup_that_never_settles_keeps_its_text_only(self, monkeypatch):
        calls = []

        def flip(text, kind, keep=None):
            calls.append(text)
            return text + "<b></b>"

        monkeypatch.setattr("app.services.document_collab.normalise_images", flip)
        out = settle_markup("<p>a</p>", "adr")
        assert out == "a"
        assert len(calls) == markup.MAX_PASSES
