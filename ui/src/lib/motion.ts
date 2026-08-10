// Read at call time rather than cached: the OS setting can change mid-session,
// and every caller here is already inside an event handler.
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** How long a row's leave animation runs before it is actually removed. */
export const LEAVE_MS = 260;
