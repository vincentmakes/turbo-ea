import { memo } from "react";

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
 * ("link_off") instead of a shape. The path data is copied from
 * `@material-symbols/svg-400/outlined`, the same source the diagram shapes'
 * generated `iconPaths.ts` draws from, so these stay visually identical to the
 * icon set used everywhere else.
 */
const PATHS: Record<"gained" | "lost", string> = {
  gained:
    "M700-160v-120H580v-60h120v-120h60v120h120v60H760v120h-60ZM450-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h170v60H280q-58.33 0-99.17 40.76-40.83 40.77-40.83 99Q140-422 180.83-381q40.84 41 99.17 41h170v60ZM325-450v-60h310v60H325Zm555-30h-60q0-58-40.83-99-40.84-41-99.17-41H510v-60h170q83 0 141.5 58.5T880-480Z",
  lost: "m750-291-49-49q51-10 85-48t34-89q0-58-41-99t-99-41H525v-60h155q83 0 141.5 58.5T880-477q0 62-36 112t-94 74ZM594-447l-60-60h101v60h-41ZM814-56 63-807l43-43L857-99l-43 43ZM450-280H280q-83 0-141.5-58.5T80-480q0-72 44.5-127T238-676l56 56h-14q-58 0-99 41t-41 99q0 58 41 99t99 41h170v60ZM325-450v-60h79l60 60H325Z",
};

const LinkChangeIcon = memo(
  ({ kind, color, size = 16 }: { kind: "gained" | "lost"; color: string; size?: number }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 -960 960 960"
      fill={color}
      style={{ flexShrink: 0, display: "block" }}
      aria-hidden
    >
      <path d={PATHS[kind]} />
    </svg>
  ),
);
LinkChangeIcon.displayName = "LinkChangeIcon";

export default LinkChangeIcon;
