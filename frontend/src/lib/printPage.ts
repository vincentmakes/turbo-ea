/**
 * Open the browser's print sheet for the current page.
 *
 * WebKit ignores `window.print()` while the document has a request in flight,
 * and the app keeps one open for good (the live event stream), so in Safari
 * (every iOS browser, Mac Safari) the call did nothing. `execCommand("print")`
 * reaches the same print sheet without that check.
 */
export function printPage(): void {
  if (isWebKit()) {
    try {
      if (document.execCommand("print", false)) return;
    } catch {
      // Not supported here: fall through to the standard call.
    }
  }
  window.print();
}

/** Apple's engine: `navigator.vendor` is "Apple Computer, Inc." in Safari and on iOS. */
function isWebKit(): boolean {
  return navigator.vendor.startsWith("Apple");
}
