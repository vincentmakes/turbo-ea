import { memo } from "react";

/**
 * What happened to a card's connections at the transition mark being stood on:
 * a link gaining a `+` where a neighbour goes live, a broken link where one
 * retires. Colour carries the direction — the marks' own blue and red.
 *
 * Vector SVG rather than a Material Symbols glyph, for the same reason as its
 * two siblings in the LDV: image export runs with `skipFonts: true`, so a font
 * ligature leaks into the PNG as its raw icon name ("link_off") instead of a
 * shape.
 */
const LinkChangeIcon = memo(({ kind, color }: { kind: "gained" | "lost"; color: string }) => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 14 14"
    fill="none"
    stroke={color}
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0 }}
    aria-hidden
  >
    {/* Two link halves reaching toward each other. */}
    <path d="M5.4 8.6 3.6 10.4a2.3 2.3 0 0 1-3.2-3.2l1.8-1.8" />
    <path d="M8.6 5.4l1.8-1.8a2.3 2.3 0 0 1 3.2 3.2l-1.8 1.8" />
    {kind === "gained" ? (
      /* Joined, and a plus for the new link. */
      <>
        <path d="M4.8 9.2 9.2 4.8" />
        <path d="M10.5 10.5h3M12 9v3" />
      </>
    ) : (
      /* Snapped: the middle is gone and struck through. */
      <path d="M2.8 11.2 11.2 2.8" />
    )}
  </svg>
));
LinkChangeIcon.displayName = "LinkChangeIcon";

export default LinkChangeIcon;
