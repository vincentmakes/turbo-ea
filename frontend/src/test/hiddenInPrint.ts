/**
 * True when `el` or an ancestor carries an emotion class whose injected rule is
 * `@media print { display: none }`. jsdom does not apply @media print, so the
 * injected stylesheet text is the observable.
 */
export function isHiddenInPrint(el: Element): boolean {
  const css = Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("");
  for (let node: Element | null = el; node; node = node.parentElement) {
    for (const cls of Array.from(node.classList)) {
      const re = new RegExp(`@media print\\s*\\{[^}]*\\.${cls}\\s*\\{[^}]*display:\\s*none`);
      if (re.test(css)) return true;
    }
  }
  return false;
}
