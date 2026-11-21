/**
 * The exact markup the rich-text editor stores for a table, pinned by
 * `RichTextEditor.test.tsx` (each string is what `getHTML()` gives, and a
 * stored copy loads back byte for byte). The sanitiser, the Word converter
 * and print are cross-checked against these same strings, so the editor and
 * its consumers cannot drift apart. Note the `;` TipTap's
 * attribute merge leaves after every inline style, and that `colwidth` is
 * written on each cell of a resized column (a merged cell lists one width per
 * spanned column, comma-separated). The table's own `style` is never read
 * back: it is rebuilt from the cells' widths, `width` once every column has
 * one, `min-width` (25px a column) otherwise.
 */
export const TABLE_3X3 =
  '<table style="min-width: 75px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody>' +
  '<tr><th colspan="1" rowspan="1"><p></p></th><th colspan="1" rowspan="1"><p></p></th><th colspan="1" rowspan="1"><p></p></th></tr>' +
  '<tr><td colspan="1" rowspan="1"><p></p></td><td colspan="1" rowspan="1"><p></p></td><td colspan="1" rowspan="1"><p></p></td></tr>' +
  '<tr><td colspan="1" rowspan="1"><p></p></td><td colspan="1" rowspan="1"><p></p></td><td colspan="1" rowspan="1"><p></p></td></tr>' +
  "</tbody></table>";
export const TABLE_RESIZED =
  '<table style="width: 350px;"><colgroup><col style="width: 150px;"><col style="width: 200px;"></colgroup><tbody>' +
  '<tr><th colspan="1" rowspan="1" colwidth="150"><p></p></th><th colspan="1" rowspan="1" colwidth="200"><p></p></th></tr>' +
  '<tr><td colspan="1" rowspan="1" colwidth="150"><p></p></td><td colspan="1" rowspan="1" colwidth="200"><p></p></td></tr>' +
  "</tbody></table>";
export const TABLE_ONE_RESIZED =
  '<table style="min-width: 175px;"><colgroup><col style="width: 150px;"><col style="min-width: 25px;"></colgroup><tbody>' +
  '<tr><th colspan="1" rowspan="1" colwidth="150"><p></p></th><th colspan="1" rowspan="1"><p></p></th></tr>' +
  '<tr><td colspan="1" rowspan="1" colwidth="150"><p></p></td><td colspan="1" rowspan="1"><p></p></td></tr>' +
  "</tbody></table>";
export const TABLE_MERGED =
  '<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody>' +
  '<tr><th colspan="1" rowspan="1"><p></p></th><th colspan="1" rowspan="1"><p></p></th></tr>' +
  '<tr><td colspan="2" rowspan="1"><p></p></td></tr>' +
  "</tbody></table>";
export const TABLE_MERGED_RESIZED =
  '<table style="width: 350px;"><colgroup><col style="width: 150px;"><col style="width: 200px;"></colgroup><tbody>' +
  '<tr><th colspan="1" rowspan="1" colwidth="150"><p></p></th><th colspan="1" rowspan="1" colwidth="200"><p></p></th></tr>' +
  '<tr><td colspan="2" rowspan="1" colwidth="150,200"><p></p></td></tr>' +
  "</tbody></table>";
export const TABLE_2X2 =
  '<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody>' +
  '<tr><th colspan="1" rowspan="1"><p></p></th><th colspan="1" rowspan="1"><p></p></th></tr>' +
  '<tr><td colspan="1" rowspan="1"><p></p></td><td colspan="1" rowspan="1"><p></p></td></tr>' +
  "</tbody></table>";
export const TABLE_NO_HEADER =
  '<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody>' +
  '<tr><td colspan="1" rowspan="1"><p></p></td><td colspan="1" rowspan="1"><p></p></td></tr>' +
  '<tr><td colspan="1" rowspan="1"><p></p></td><td colspan="1" rowspan="1"><p></p></td></tr>' +
  "</tbody></table>";
/** Three rows by two, a header row, the first column's two body cells merged. */
export const TABLE_ROWSPAN =
  '<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody>' +
  '<tr><th colspan="1" rowspan="1"><p></p></th><th colspan="1" rowspan="1"><p></p></th></tr>' +
  '<tr><td colspan="1" rowspan="2"><p></p></td><td colspan="1" rowspan="1"><p></p></td></tr>' +
  '<tr><td colspan="1" rowspan="1"><p></p></td></tr>' +
  "</tbody></table>";
/** Two rows by two, the header row's two cells merged. */
export const TABLE_COLSPAN_HEADER =
  '<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody>' +
  '<tr><th colspan="2" rowspan="1"><p></p></th></tr>' +
  '<tr><td colspan="1" rowspan="1"><p></p></td><td colspan="1" rowspan="1"><p></p></td></tr>' +
  "</tbody></table>";

/** Every pinned table, by name, for suites that check each one. */
export const PINNED_TABLES: readonly (readonly [name: string, html: string])[] = [
  ["a fresh 3×3 table", TABLE_3X3],
  ["a fresh 2×2 table (also what a split gives back)", TABLE_2X2],
  ["a resized table", TABLE_RESIZED],
  ["a table with one column resized", TABLE_ONE_RESIZED],
  ["a merged cell", TABLE_MERGED],
  ["a merged cell across resized columns", TABLE_MERGED_RESIZED],
  ["a table without a header row", TABLE_NO_HEADER],
  ["a cell merged across two rows", TABLE_ROWSPAN],
  ["a header row merged across two columns", TABLE_COLSPAN_HEADER],
];
