import { useCallback, useSyncExternalStore } from "react";

/**
 * Tailwind's `md`, in JavaScript.
 *
 * This is a second definition of a number that also lives in the CSS, and the
 * two are kept in step by hand — deliberately synchronised rather than
 * incapable of drifting. Anything choosing between a desktop and a phone
 * presentation must agree with the breakpoint the stylesheet uses, or a
 * viewport a pixel either side of it gets one component's idea of "desktop"
 * and another's idea of "phone". The browser test asserts both sides of the
 * boundary, which is the only check that catches a drift.
 */
export const DESKTOP_MIN_WIDTH = 768;

/**
 * Subscribes to a media query.
 *
 * Where `matchMedia` is unavailable — jsdom, which implements none of it — this
 * reports `false`. Tests that care about a viewport install a stub and say
 * which one they mean; the fallback only decides what an unconfigured test
 * sees, and a phone is the safer thing for it to see, because the phone branch
 * is the one that must work without a pointer.
 */
export function useMediaQuery(query: string): boolean {
  // `matchMedia` is an external store, so it is subscribed to as one rather
  // than mirrored into state by an effect: no re-render to catch up after the
  // first paint, and a changed query is read immediately instead of one render
  // late.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia?.(query);
      if (!media) return () => {};
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  const read = useCallback(() => window.matchMedia?.(query).matches ?? false, [query]);
  return useSyncExternalStore(subscribe, read, () => false);
}

/**
 * True at the width where the interface stops being a phone.
 *
 * Used to mount one presentation rather than to hide the other with a class: a
 * sheet renders through a portal, so `md:hidden` on its wrapper cannot reach
 * it, and a desktop opening an editor would get the inline panel *and* a modal
 * sheet over the top of it.
 */
export function useIsDesktop(): boolean {
  return useMediaQuery(`(min-width: ${DESKTOP_MIN_WIDTH}px)`);
}
