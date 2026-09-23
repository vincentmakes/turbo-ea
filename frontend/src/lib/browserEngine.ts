/**
 * Which engine renders a native `<input type="date">`.
 *
 * This is user-agent sniffing, deliberately: the difference being handled is
 * engine-specific *rendering* with no feature test to probe for. An empty
 * WebKit date input draws today's date as its placeholder and has no calendar
 * button on macOS, whereas Blink and Gecko draw a day/month/year pattern and
 * their own button (#1142). Nothing in the DOM API reveals which of the two
 * the browser will paint.
 *
 * - `"webkit-desktop"` — Safari on macOS.
 * - `"webkit-touch"` — any browser on iPhone / iPad (all of them are WebKit;
 *   iPadOS in desktop mode reports a `Macintosh` UA, which only
 *   `maxTouchPoints` tells apart). There the picker is the only way to enter
 *   a date — no segment typing — which DateField relies on to commit at once.
 * - `"other"` — Blink (Chrome, Edge, Opera, Android browsers), Gecko, and
 *   test environments such as jsdom.
 */
export type DateInputEngine = "webkit-desktop" | "webkit-touch" | "other";

const BLINK_OR_ANDROID = /(Chrome|Chromium|Edg|OPR|SamsungBrowser)\/|Android/;

export function dateInputEngine(ua: string, maxTouchPoints = 0): DateInputEngine {
  // Every Blink UA also carries `AppleWebKit/` and `Safari/`, so those two
  // tokens alone are not enough; iOS browsers (CriOS, FxiOS, EdgiOS) are
  // WebKit and do not carry the Blink tokens.
  if (!/AppleWebKit\//.test(ua) || !/(Safari|Mobile)\//.test(ua)) return "other";
  if (BLINK_OR_ANDROID.test(ua)) return "other";
  if (/iPhone|iPad|iPod/.test(ua)) return "webkit-touch";
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return "webkit-touch";
  return "webkit-desktop";
}

/** The engine of the current browser. */
export function currentDateInputEngine(): DateInputEngine {
  if (typeof navigator === "undefined") return "other";
  return dateInputEngine(navigator.userAgent ?? "", navigator.maxTouchPoints ?? 0);
}
