import { useRef, type MouseEvent, type PointerEvent } from "react";

/** How long a finger must rest before it counts as a long press. */
const HOLD_MS = 500;
/** Movement past this many px is a scroll, not a hold. */
const SLOP = 10;

/**
 * Touch-hold on a list row, without the swipe machinery.
 *
 * `SwipeRow` already does this for actions, but it comes with left-defer and
 * right-star, and neither means anything for a repeating pattern: there is no
 * date to push and nothing to star. This is the half that does apply — hold to
 * open the editor, because on a phone there is no hover and no room for a row
 * of icons.
 *
 * A mouse is ignored, so desktop drag, hover and click behave normally, and the
 * click that follows the hold is swallowed rather than passed on to whatever
 * was underneath the finger.
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const fired = useRef(false);

  function clear() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  return {
    onPointerDown(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, HOLD_MS);
    },
    onPointerMove(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      const moved =
        Math.abs(e.clientX - start.current.x) > SLOP ||
        Math.abs(e.clientY - start.current.y) > SLOP;
      if (moved) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onClickCapture(e: MouseEvent) {
      if (!fired.current) return;
      e.preventDefault();
      e.stopPropagation();
      fired.current = false;
    },
  };
}
