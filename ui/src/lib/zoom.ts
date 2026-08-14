/**
 * Keep iOS Safari at its normal scale without trapping somebody at a scale the
 * browser restored across a reload.
 *
 * Safari ignores viewport scale limits for user gestures. Its gesture events
 * are cancelable, though, so prevent zoom while the page is at 1×. If Safari
 * has restored a larger visual viewport scale, pinch-in stays blocked but
 * pinch-out remains available until the user is back at 1×.
 */
export function installZoomGuard(
  target: Document = document,
  scale: () => number = () => window.visualViewport?.scale ?? 1,
) {
  const onGesture = (event: Event) => {
    const gestureScale = (event as Event & { scale?: number }).scale ?? 1;
    if (scale() <= 1.01 || gestureScale > 1.01) event.preventDefault();
  };

  let lastTap = 0;
  const onTouchEnd = (event: TouchEvent) => {
    if (scale() > 1.01 || event.changedTouches.length !== 1) {
      lastTap = 0;
      return;
    }
    if (lastTap !== 0 && event.timeStamp - lastTap < 300) {
      event.preventDefault();
      lastTap = 0;
    } else {
      lastTap = event.timeStamp;
    }
  };

  target.addEventListener("gesturestart", onGesture, { passive: false });
  target.addEventListener("gesturechange", onGesture, { passive: false });
  target.addEventListener("touchend", onTouchEnd, { passive: false });

  return () => {
    target.removeEventListener("gesturestart", onGesture);
    target.removeEventListener("gesturechange", onGesture);
    target.removeEventListener("touchend", onTouchEnd);
  };
}
