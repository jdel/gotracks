import { useCallback, useSyncExternalStore } from "react";

/**
 * How many pixels of the layout viewport the on-screen keyboard is covering.
 *
 * iOS does not resize the layout viewport when the keyboard opens — it draws
 * over it. So a `position: fixed; bottom: 0` sheet stays anchored to the bottom
 * of the *screen*, behind the keyboard, with the field you are typing in out of
 * sight. `visualViewport` is the only thing that reports the covered strip.
 *
 * Android resizes instead (helped by `interactive-widget=resizes-content` in
 * the viewport meta), so this reads 0 there and the sheet needs no offset. Both
 * paths end up with the sheet sitting on top of the keyboard.
 */

/**
 * Below this, the gap is browser chrome rather than a keyboard — a collapsing
 * address bar moves the visual viewport by a few dozen pixels, and shifting the
 * sheet for that would be a twitch. No keyboard is anywhere near this small.
 */
const KEYBOARD_MIN_HEIGHT = 100;

function read(): number {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  // offsetTop is what the page has been scrolled up by to keep the focused
  // field visible; it is part of the strip that is no longer usable.
  const covered = window.innerHeight - (viewport.height + viewport.offsetTop);
  return covered >= KEYBOARD_MIN_HEIGHT ? Math.round(covered) : 0;
}

export function useKeyboardInset(): number {
  // An external store rather than state and an effect: the keyboard opens
  // during the sheet's own opening animation, and a value that arrives a render
  // late is a visible jump.
  const subscribe = useCallback((onChange: () => void) => {
    const viewport = window.visualViewport;
    if (!viewport) return () => {};
    // Scroll as well as resize: iOS scrolls the visual viewport to reveal the
    // focused field, which moves the covered strip without resizing anything.
    viewport.addEventListener("resize", onChange);
    viewport.addEventListener("scroll", onChange);
    return () => {
      viewport.removeEventListener("resize", onChange);
      viewport.removeEventListener("scroll", onChange);
    };
  }, []);

  return useSyncExternalStore(subscribe, read, () => 0);
}
