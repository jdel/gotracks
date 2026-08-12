import { useCallback, useRef, useState, type PointerEvent } from "react";
import { LEAVE_MS, prefersReducedMotion } from "@/lib/motion";

// How far a sheet must be pulled down before letting go dismisses it.
const DISMISS = 96;

/**
 * Pull-to-dismiss for a bottom sheet, wherever one is built.
 *
 * The grab handle at the top of a sheet promises this, so every sheet has to
 * honour it — the app has two implementations (the plain one, and the Radix
 * dialog behind the mobile navigation) and a gesture that works on one but not
 * the other is worse than none.
 *
 * The gesture belongs to the sheet's header, not to the whole panel. The panel
 * scrolls vertically, so it must keep `touch-action: pan-y`, and a browser that
 * has decided a downward drag is a scroll takes the gesture and fires
 * pointercancel — the sheet would follow the finger for a few pixels and snap
 * back. The header declares `touch-action: none`, so nothing competes for a
 * drag that starts there, and it is where the handle invites the finger anyway.
 */
export function usePullToDismiss(onClose: () => void) {
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  /** Set while the sheet is sliding out, before it is actually closed. */
  const [leaving, setLeaving] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);
  // The live offset, for the handler that ends the gesture: it runs in the same
  // batch as the last move, where state still reads as it was before.
  const offset = useRef(0);
  // Stable, so a caller can put it in an effect's dependencies without the
  // effect re-running on every render — which, mid-pull, would reset the very
  // drag in progress.
  const reset = useCallback(() => {
    offset.current = 0;
    setDy(0);
    setLeaving(false);
  }, []);

  // Every pointer event stops at the sheet. A portal still propagates through
  // the React tree, not the DOM one, so without this a drag on a sheet opened
  // from a swipeable row would also reach that row's gesture handlers —
  // pulling the sheet down would fire a swipe on the card behind it.
  function onPointerDown(e: PointerEvent) {
    e.stopPropagation();
    startY.current = e.clientY;
    pulling.current = true;
    // Keeps the moves coming even if the finger leaves the header, which it
    // does immediately — the sheet slides out from under it.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort; the gesture still works without it.
    }
  }

  function onPointerMove(e: PointerEvent) {
    e.stopPropagation();
    if (!pulling.current) return;
    // Downward only. Dragging up is not a dismissal, and the sheet is already
    // against the top of its travel.
    const moved = Math.max(0, e.clientY - startY.current);
    if (!dragging && moved > 4) setDragging(true);
    offset.current = moved;
    setDy(moved);
  }

  function onPointerUp(e: PointerEvent) {
    e.stopPropagation();
    if (!pulling.current) return;
    pulling.current = false;
    setDragging(false);
    const travelled = offset.current;
    offset.current = 0;
    if (travelled <= DISMISS) {
      // Short of the threshold it springs back rather than sitting half-open.
      setDy(0);
      return;
    }
    // Past it, the sheet finishes the journey it was already making: let go
    // half way and it slides the rest of the way out rather than blinking away
    // from under the finger.
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setLeaving(true);
    setDy(window.innerHeight);
    window.setTimeout(onClose, LEAVE_MS);
  }

  return {
    /** Spread on the sheet's header — the surface the gesture starts from. */
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      style: { touchAction: "none" as const },
      "data-sheet-grip": "",
    },
    /** Spread on the panel itself, which is what moves. */
    style: {
      // Unset at rest, like the swipe rows: an identity transform would make
      // this the containing block for anything fixed inside it.
      transform: dy === 0 ? undefined : `translateY(${dy}px)`,
      transition: dragging ? "none" : `transform ${LEAVE_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
      // Only while sliding out, and only then: this object is merged over the
      // dialog's own style, so setting the key to undefined would erase the
      // `pointer-events: auto` it needs to be usable at all.
      ...(leaving ? { pointerEvents: "none" as const } : {}),
    },
    /** Reset after the sheet is reopened, so it does not return displaced. */
    reset,
  };
}
