/**
 * Material Symbols `add_link` / `link_off`, inlined as vector paths.
 *
 * The glyphs are the real thing rather than something hand-drawn: a chain link
 * gaining a `+` or snapped in two is instantly readable at this size, where an
 * invented approximation is just a scribble.
 *
 * Inlined rather than rendered through `MaterialSymbol` for the same reason the
 * LDV's chevrons and direction arrows are: image export runs with
 * `skipFonts: true`, so a font ligature leaks into the PNG as its raw icon name
 * ("link_off") instead of a shape.
 *
 * Same principle as the card-type icons baked onto DrawIO shapes — ship real
 * vector paths because font glyphs cannot be rasterised into an image — but
 * deliberately NOT the same mechanism. Those are generated into
 * `features/diagrams/iconPaths.ts` by `npm run gen:diagram-icons`, which walks
 * `components/iconCatalog.ts`: the curated set of icons an admin can PICK for a
 * card type. These two are fixed chrome, not a choice, so putting them in that
 * catalogue purely to obtain path data would add "broken link" and "add link"
 * to the metamodel icon picker — a user-visible change to serve an internal
 * need. Hence two literals, copied from `@material-symbols/svg-400/outlined`,
 * the very source that generator reads, so they match the icon set exactly.
 *
 * The cost of staying outside the pipeline is that nothing regenerates these
 * when the package's geometry changes, so the sibling test compares both
 * literals against `@material-symbols/svg-400` on every run: a drift shows up
 * as a failing test rather than as a quietly wrong glyph. If a third icon ever
 * needs this, give the generator a second input list instead of adding another
 * literal here.
 */
export const PATHS: Record<"gained" | "lost", string> = {
  gained:
    "M700-160v-120H580v-60h120v-120h60v120h120v60H760v120h-60ZM450-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h170v60H280q-58.33 0-99.17 40.76-40.83 40.77-40.83 99Q140-422 180.83-381q40.84 41 99.17 41h170v60ZM325-450v-60h310v60H325Zm555-30h-60q0-58-40.83-99-40.84-41-99.17-41H510v-60h170q83 0 141.5 58.5T880-480Z",
  lost: "m750-291-49-49q51-10 85-48t34-89q0-58-41-99t-99-41H525v-60h155q83 0 141.5 58.5T880-477q0 62-36 112t-94 74ZM594-447l-60-60h101v60h-41ZM814-56 63-807l43-43L857-99l-43 43ZM450-280H280q-83 0-141.5-58.5T80-480q0-72 44.5-127T238-676l56 56h-14q-58 0-99 41t-41 99q0 58 41 99t99 41h170v60ZM325-450v-60h79l60 60H325Z",
};

/** Coordinate system of the Material Symbols source SVGs. */
export const VIEW_BOX = "0 -960 960 960";
