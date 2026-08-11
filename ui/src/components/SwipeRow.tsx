import { useRef, useState, type PointerEvent, type MouseEvent, type ReactNode } from "react";
import { CalendarClock, Star } from "lucide-react";
import { cn } from "@/lib/utils";

// Past this many px on release, a swipe fires; below it, the card springs back.
const THRESHOLD = 96;

/**
 * A list row with touch gestures: swipe left to defer, swipe right to star,
 * long-press to open the editor. Touch only — a mouse pointer is ignored so
 * the desktop drag-and-drop and hover actions keep working. The drag handle is
 * excluded (marked `data-drag-handle`) so reordering isn't hijacked.
 */
export function SwipeRow({
  lifted,
  leaving,
  onSwipeLeft,
  onSwipeRight,
  onLongPress,
  children,
}: {
  lifted?: boolean;
  /** True while the row plays its completion animation, just before it is removed. */
  leaving?: boolean;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onLongPress: () => void;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  // Mirrored as state as well as a ref: the ref is what the long-press timer and
  // the pointer handlers read synchronously, but the render needs it too, and
  // reading a ref during render is not allowed.
  const [dragging, setDragging] = useState(false);
  const swiping = useRef(false);
  // Set once a gesture (swipe or long-press) has happened, so the tap-through
  // click that follows is swallowed instead of, say, opening the title editor.
  const gestured = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType !== "touch") return;
    if ((e.target as HTMLElement).closest("[data-drag-handle]")) return;
    swiping.current = false;
    setDragging(false);
    gestured.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    clearTimer();
    timer.current = setTimeout(() => {
      if (!swiping.current) {
        gestured.current = true;
        onLongPress();
      }
    }, 500);
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType !== "touch") return;
    const dxNow = e.clientX - start.current.x;
    const dyNow = e.clientY - start.current.y;
    if (!swiping.current) {
      if (Math.abs(dxNow) > 10 && Math.abs(dxNow) > Math.abs(dyNow)) {
        swiping.current = true;
        setDragging(true);
        gestured.current = true;
        clearTimer();
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // Capture is best-effort; the gesture still works without it.
        }
      } else if (Math.abs(dyNow) > 10) {
        // A vertical drag is a scroll, not a swipe.
        clearTimer();
        return;
      }
    }
    if (swiping.current) setDx(dxNow);
  }

  function finish(e: PointerEvent) {
    if (e.pointerType !== "touch") return;
    clearTimer();
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
        // content; the cap only has to beat the tallest realistic row.
        "group relative isolate max-h-[400px] touch-pan-y overflow-hidden rounded-card",
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
