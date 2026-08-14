import { useRef, useState, type PointerEvent, type MouseEvent, type ReactNode } from "react";
import { CalendarClock, Star } from "lucide-react";
import { cn } from "@/lib/utils";

// Past this many px on release, a swipe fires; below it, the card springs back.
const THRESHOLD = 96;

// Swipes starting this close to a screen edge are left to the browser.
//
// iOS Safari reads an edge swipe as back/forward, and that cannot be reliably
// cancelled from JavaScript — a row that claimed the gesture would fight the
// browser and lose, or worse, win intermittently. Conceding the edges makes the
// two unambiguous: the browser owns roughly a thumb's width at each side, the
// row owns everything between. Cards are already inset from the screen edge, so
// little usable swipe area is given up.
const EDGE_ZONE = 24;

/**
 * A list row with touch gestures: swipe left to defer, swipe right to star.
 * Touch only — a mouse pointer is ignored so the desktop drag-and-drop and
 * hover actions keep working. The drag handle is excluded (marked
 * `data-drag-handle`) so reordering isn't hijacked.
 *
 * Editing is not a gesture. It was a long press, which the browser reads first
 * as a request to select text: the row put its editor up underneath iOS's own
 * selection handles. The pencil in the row does it now, at every width.
 */
export function SwipeRow({
  lifted,
  leaving,
  expanded,
  onSwipeLeft,
  onSwipeRight,
  children,
}: {
  lifted?: boolean;
  /** True while the row plays its completion animation, just before it is removed. */
  leaving?: boolean;
  /** True while the row has a panel open below it, so the height cap is lifted. */
  expanded?: boolean;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  // Mirrored as state as well as a ref: the ref is what the pointer handlers
  // read synchronously, but the render needs it too, and reading a ref during
  // render is not allowed.
  const [dragging, setDragging] = useState(false);
  const swiping = useRef(false);
  // Set once a swipe has happened, so the tap-through click that follows is
  // swallowed instead of, say, opening the title editor.
  const gestured = useRef(false);
  // Set when the gesture was refused as it started — a drag handle, or a screen
  // edge. Without it only the pointerdown was refused: the moves that followed
  // measured from a stale origin and became a swipe anyway, which is how an
  // edge swipe still deferred an action while the comment above promised the
  // edges to the browser.
  const declined = useRef(false);
  const start = useRef({ x: 0, y: 0 });

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType !== "touch") return;
    declined.current = true;
    if ((e.target as HTMLElement).closest("[data-drag-handle]")) return;
    // Started at a screen edge: the browser's navigation gesture, not ours.
    if (e.clientX < EDGE_ZONE || window.innerWidth - e.clientX < EDGE_ZONE) return;
    declined.current = false;
    swiping.current = false;
    setDragging(false);
    gestured.current = false;
    start.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType !== "touch" || declined.current) return;
    const dxNow = e.clientX - start.current.x;
    const dyNow = e.clientY - start.current.y;
    if (!swiping.current) {
      if (Math.abs(dxNow) > 10 && Math.abs(dxNow) > Math.abs(dyNow)) {
        swiping.current = true;
        setDragging(true);
        gestured.current = true;
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // Capture is best-effort; the gesture still works without it.
        }
      } else if (Math.abs(dyNow) > 10) {
        // A vertical drag is a scroll, not a swipe.
        return;
      }
    }
    if (swiping.current) setDx(dxNow);
  }

  function finish(e: PointerEvent) {
    if (e.pointerType !== "touch" || declined.current) return;
    if (swiping.current) {
      swiping.current = false;
      setDragging(false);
      const d = dx;
      setDx(0);
      if (d <= -THRESHOLD) onSwipeLeft();
      else if (d >= THRESHOLD) onSwipeRight();
    }
  }

  function onClickCapture(e: MouseEvent) {
    if (gestured.current) {
      e.preventDefault();
      e.stopPropagation();
      gestured.current = false;
    }
  }

  return (
    <li
      className={cn(
        // max-height rather than height so the row keeps sizing itself to its
        // content; the cap only has to beat the tallest realistic row. An open
        // editor is taller than any realistic row, so the cap comes off while
        // one is showing — otherwise the panel is cropped and its Save button
        // is below the cut.
        "group relative isolate touch-pan-y overflow-hidden rounded-card",
        expanded ? "max-h-none" : "max-h-[400px]",
        "transition-[max-height,opacity] duration-[260ms] ease-out",
        lifted && "rotate-[-0.4deg]",
        leaving && "max-h-0 opacity-0",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onClickCapture={onClickCapture}
    >
      {/* One full-width layer behind the card; its colour follows the swipe
          direction (teal = star, blue = defer) and the sliding card reveals it
          up to exactly where the finger has dragged. Left used to be danger red
          with a bin: it defers now, and nothing there destroys anything. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 flex items-center px-5 text-white",
          dx > 0 && "justify-start bg-done",
          dx < 0 && "justify-end bg-defer",
        )}
      >
        {dx > 10 && <Star className="size-5" />}
        {dx < -10 && <CalendarClock className="size-5" />}
      </div>
      <div
        className={cn(
          "relative rounded-card bg-card py-2.5 pr-2.5 pl-2 shadow-card dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none",
          lifted && "shadow-elevated",
        )}
        style={{
          // Left unset at rest, not set to translateX(0px). A transform — even
          // an identity one — makes this the containing block for every fixed
          // descendant, and costs a compositor layer per row.
          transform: dx === 0 ? undefined : `translateX(${dx}px)`,
          // No transition while the finger is down: the card must track it
          // exactly. The spring back on release is what gets animated.
          transition: dragging ? "none" : "transform 200ms",
        }}
      >
        {children}
      </div>
    </li>
  );
}
