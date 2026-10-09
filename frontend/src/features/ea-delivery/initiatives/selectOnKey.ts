import type { KeyboardEvent } from "react";

/**
 * Enter / Space on a row selects it, as a click does. Only a key pressed on
 * the row itself counts: the chevron and the star inside it are buttons of
 * their own, and their keys belong to them.
 */
export function selectOnKey(select: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    select();
  };
}
