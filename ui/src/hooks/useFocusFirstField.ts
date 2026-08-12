import { useEffect, type RefObject } from "react";

/**
 * Moves focus to the first control inside a panel when it opens.
 *
 * A panel that opens under a row leaves focus on the button that opened it, so
 * the next Tab goes to the row's other icons rather than into the form. On a
 * phone the sheet already does this; inline on a desktop nothing did.
 *
 * `enabled` exists because the same form is used to add an action, where it is
 * mounted with the page — focusing it there would steal the caret on load.
 */
export function useFocusFirstField(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    ref.current
      ?.querySelector<HTMLElement>("input,select,textarea,button:not([tabindex='-1'])")
      ?.focus();
  }, [ref, enabled]);
}
