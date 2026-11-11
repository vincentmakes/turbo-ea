"""``text_render``: the edges of the HTML-to-text renderer.

``test_document_tools.py`` covers the everyday shapes (paragraphs, lists,
links, mentions). These pin what a reader sees at the boundaries: how many
blank lines separate blocks, when leading spaces are dropped, nesting of
quotes, ``<pre>`` and dropped elements, a mention with markup inside, and a
link whose text looks like its target. ``finish()`` folds runs of blank
lines, so the line-count helpers of ``_Renderer`` are also checked on their
own, before that folding.
"""

from __future__ import annotations

from turbo_ea_mcp.text_render import _Renderer, html_to_text

RESTRICTED_OPEN = '<span data-type="mention" data-kind="card" data-restricted="true">'


def _fed(html: str) -> list[str]:
    """The renderer's pieces after ``html``, before ``finish()`` folds them."""
    renderer = _Renderer()
    renderer.feed(html)
    return renderer.out


class TestLineHelpers:
    def test_nothing_written_is_not_a_line_count(self):
        assert _Renderer()._trailing_newlines() == -1

    def test_newline_only_pieces_are_counted(self):
        renderer = _Renderer()
        renderer.out = ["\n"]
        assert renderer._trailing_newlines() == 1
        renderer.out = ["a\n", "\n"]
        assert renderer._trailing_newlines() == 2

    def test_only_newlines_at_the_end_count(self):
        renderer = _Renderer()
        renderer.out = ["\na"]
        assert renderer._trailing_newlines() == 0
        renderer.out = ["aX"]
        assert renderer._trailing_newlines() == 0

    def test_a_break_adds_only_the_missing_newlines(self):
        renderer = _Renderer()
        renderer.out = ["a\n"]
        renderer._break(1)
        assert renderer.out == ["a\n"]
        renderer._break(2)
        assert renderer.out == ["a\n", "\n"]

    def test_a_paragraph_gap_is_one_line_inside_a_list(self):
        renderer = _Renderer()
        assert renderer._paragraph_gap() == 2
        renderer._lists.append(["ul", 0])
        assert renderer._paragraph_gap() == 1

    def test_a_list_after_text_leaves_one_blank_line(self):
        assert _fed("a<ul>") == ["", "a", "\n\n"]

    def test_closing_a_list_completes_one_blank_line(self):
        assert _fed("<ul><li>a</li></ul>") == ["- ", "a", "\n", "\n"]


class TestBlockSpacing:
    def test_a_list_after_text_is_a_new_paragraph(self):
        assert html_to_text("a<ul><li>b</li></ul>") == "a\n\n- b"

    def test_text_after_a_list_is_a_new_paragraph(self):
        assert html_to_text("<ul><li>a</li></ul>b") == "- a\n\nb"

    def test_text_after_an_ordered_list_is_not_indented(self):
        assert html_to_text("<ol><li>x</li></ol><p>after</p>") == "1. x\n\nafter"

    def test_text_after_a_nested_list_stays_in_its_item(self):
        assert html_to_text("<ul><li>a<ul><li>b</li></ul>c</li></ul>") == ("- a\n  - b\n  c")

    def test_text_after_an_item_starts_an_indented_line(self):
        assert html_to_text("<ul><li>a</li>b</ul>") == "- a\n  b"

    def test_a_paragraph_after_a_stray_item_end_is_a_new_paragraph(self):
        assert html_to_text("a</li><p>b</p>") == "a\n\nb"

    def test_a_paragraph_after_a_line_break_is_a_new_paragraph(self):
        assert html_to_text("a<br><p>b</p>") == "a\n\nb"

    def test_trailing_spaces_are_cut_from_every_line(self):
        assert html_to_text("<p>a </p><p>b</p>") == "a\n\nb"

    def test_runs_of_blank_lines_fold_to_one(self):
        assert html_to_text("<pre>a\n\n\n\nb</pre>") == "a\n\nb"


class TestLeadingSpace:
    def test_a_paragraph_drops_its_leading_space(self):
        assert html_to_text("<p>a</p><p> b</p>") == "a\n\nb"

    def test_an_item_drops_its_leading_space(self):
        assert html_to_text("<ul><li> x</li></ul>") == "- x"

    def test_only_spaces_are_dropped(self):
        assert html_to_text("<p>a</p><p>XML</p>") == "a\n\nXML"

    def test_text_ending_in_x_continues_its_line(self):
        assert html_to_text("<blockquote>MAX<b>B</b></blockquote>") == "> MAXB"

    def test_a_newline_inside_pre_text_does_not_start_a_quoted_line(self):
        html = "<blockquote><pre>a<b>\nb</b>c</pre></blockquote>"
        assert html_to_text(html) == "> a\nbc"


class TestNesting:
    def test_nested_quotes_keep_both_markers(self):
        assert html_to_text("<blockquote><blockquote>q</blockquote></blockquote>") == "> > q"

    def test_closing_an_inner_quote_keeps_the_outer_one(self):
        html = "<blockquote><blockquote>a</blockquote>b</blockquote>"
        assert html_to_text(html) == "> > a\n\n> b"

    def test_an_item_inside_a_quote_is_quoted(self):
        assert html_to_text("<blockquote><ul><li>a</li></ul></blockquote>") == "> - a"

    def test_closing_an_inner_pre_keeps_the_outer_one(self):
        assert html_to_text("<pre><pre>a</pre>  b</pre>") == "a\n\n  b"

    def test_another_block_inside_pre_does_not_end_it(self):
        assert html_to_text("<pre><p>a</p>  b</pre>") == "a\n\n  b"

    def test_whitespace_collapses_again_after_pre(self):
        assert html_to_text("<pre>a</pre><p>x   y</p>") == "a\n\nx y"

    def test_a_nested_dropped_element_keeps_its_parent_dropped(self):
        assert html_to_text("<template><template></template>hidden</template>shown") == "shown"
        assert html_to_text("<template><style>p{}</style>hidden</template>ok") == "ok"

    def test_a_span_inside_a_mention_does_not_end_it(self):
        html = f"{RESTRICTED_OPEN}<span>x</span>y</span> z"
        assert html_to_text(html) == "[restricted] z"


class TestTablesAndLinks:
    def test_header_cells_are_spaced(self):
        assert html_to_text("<table><tr><th>a</th><th>b</th></tr></table>") == "a b"

    def test_a_table_is_followed_by_its_paragraphs(self):
        html = "<table><tr><td>a</td><td>b</td></tr></table><p>c</p>"
        assert html_to_text(html) == "a b\n\nc"

    def test_a_link_without_a_target_keeps_the_layout(self):
        assert html_to_text("<a>plain</a><p>x</p>") == "plain\n\nx"

    def test_the_target_follows_the_whole_link_text(self):
        html = '<a href="https://x.org"><b>see</b> more</a>'
        assert html_to_text(html) == "see more (https://x.org)"

    def test_only_a_mailto_target_is_shown_without_its_scheme(self):
        assert html_to_text('<a href="http://x.org">x.org</a>') == "x.org (http://x.org)"
