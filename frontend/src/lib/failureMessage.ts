/**
 * What a component stores when a request fails, and how it words it.
 *
 * A fetch callback that builds its fallback wording with `t` has `t` in its
 * dependency array, and `t` changes on every language switch — so the data is
 * fetched again just to re-word an error (#1205 review). Store the message as
 * received, or the translation KEY of the fallback, and word it at render:
 * the error re-words itself on a language switch and the callback depends on
 * nothing but its inputs.
 */

const KEY_PREFIX = "i18n:";

/** The message to store for a failed request: its own, else `fallbackKey` worded at render. */
export function failureMessage(err: unknown, fallbackKey: string): string {
  const message = err instanceof Error ? err.message : "";
  return message || KEY_PREFIX + fallbackKey;
}

/** The stored message as the user reads it: a key is translated, a message shown as is. */
export function wordFailure(stored: string, t: (key: string) => string): string {
  return stored.startsWith(KEY_PREFIX) ? t(stored.slice(KEY_PREFIX.length)) : stored;
}
