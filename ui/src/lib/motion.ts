// Read at call time rather than cached: the OS setting can change mid-session,
// and every caller here is already inside an event handler.
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** How long a row's leave animation runs before it is actually removed. */
export const LEAVE_MS = 260;

/**
 * How long a sheet takes to slide up — the 240ms in `sheetUp`, kept in step by
 * hand like the breakpoint is.
 *
 * Anything that has to happen *after* the sheet has arrived waits this out.
 * Focusing a field is the one that matters: it raises the keyboard, and a
 * keyboard raised while the sheet is still travelling leaves the browser
 * scrolling to where the field was rather than where it is.
 */
export const SHEET_ENTER_MS = 240;
