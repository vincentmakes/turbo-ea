import { memo } from "react";

import { PATHS, VIEW_BOX } from "./linkChangeGlyphs";

/**
 * A connection-change marker for a card corner: blue where the card gains a
 * link at the viewed marker, red where it loses one.
 *
 * The path data and the reasoning behind hand-copying it live in
 * `linkChangeGlyphs.ts` — they are constants, so they sit outside this module
 * to keep it a component-only file.
 */
const LinkChangeIcon = memo(
  ({ kind, color, size = 16 }: { kind: "gained" | "lost"; color: string; size?: number }) => (
    <svg
      width={size}
      height={size}
      viewBox={VIEW_BOX}
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
