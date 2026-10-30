import { useEffect, useRef } from "react";

/** A request from outside to open something for editing: one object per ask. */
export interface EditRequest {
  nonce: number;
}

// Requests already acted on, across mounts. A Card-tab section (or the
// Stakeholders tab) unmounts when the user switches tabs and remounts with the
// same request still in its props when they come back; acting again would drop
// them into edit mode they already left.
const handled = new WeakSet<EditRequest>();

/**
 * Acts on an edit request — a data-quality jump asking a section to open in
 * edit mode — exactly once per request, the way `useSyncedExpanded`'s
 * `expandOn` expands a section once per nonce.
 *
 * `canAct` says whether the section can act yet: it holds the user's edit
 * rights, and whatever loads asynchronously before there is anything to open
 * (the tag groups, the relation list). A request that arrives too early is
 * remembered and acted on as soon as `canAct` turns true; one the user may
 * never act on is simply never acted on.
 *
 * `undefined` asks for nothing. A request is acted on at most once, whether it
 * comes back as the same object after a remount or as a copy with the same
 * nonce.
 */
export function useEditRequest<R extends EditRequest>(
  request: R | undefined,
  canAct: boolean,
  act: (request: R) => void,
): void {
  const actRef = useRef(act);
  useEffect(() => {
    actRef.current = act;
  });
  const actedNonce = useRef<number | null>(null);

  useEffect(() => {
    if (!request || !canAct) return;
    if (handled.has(request) || actedNonce.current === request.nonce) return;
    handled.add(request);
    actedNonce.current = request.nonce;
    actRef.current(request);
  }, [request, canAct]);
}

/** What a jump may focus inside a field's edit wrapper, in document order. */
const FOCUSABLE = 'input, textarea, select, button, [role="combobox"], [tabindex]';

/**
 * Focuses the first control a person can tab to inside `container`: skips
 * disabled controls and the ones taken out of the tab order (MUI's hidden
 * native `<input>` behind a Select, the auto-size shadow `<textarea>`).
 * Returns whether something took focus.
 */
export function focusFirstControl(container: Element | null | undefined): boolean {
  if (!container) return false;
  for (const el of container.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el.tabIndex < 0 || el.hasAttribute("disabled")) continue;
    el.focus();
    return true;
  }
  return false;
}

/**
 * Focuses the first control of the field whose edit wrapper carries
 * `data-field-key={fieldKey}` inside `root` (the sections wrap each field they
 * edit so a data-quality jump can land on it). Returns whether something took
 * focus: nothing does when the field is hidden or read-only.
 */
export function focusFieldControl(root: Element | null | undefined, fieldKey: string): boolean {
  if (!root) return false;
  const wrapper = Array.from(root.querySelectorAll("[data-field-key]")).find(
    (el) => el.getAttribute("data-field-key") === fieldKey,
  );
  return focusFirstControl(wrapper);
}

export default useEditRequest;
