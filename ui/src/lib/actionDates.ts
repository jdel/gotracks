/**
 * Date arithmetic for an action's Due and Show from fields.
 *
 * Everything here speaks the "YYYY-MM-DD" strings a date input holds, and does
 * the arithmetic in UTC so a shift of one day is always one calendar day —
 * doing it in local time would lose or gain an hour across a DST boundary and
 * occasionally land on the wrong date. An empty string means "no date"; every
 * function accepts and returns that rather than null, so the callers stay free
 * of the distinction.
 */

/** dayValue converts an API timestamp to the value a date input wants. */
export function dayValue(iso: string | undefined, dayKey: (iso: string) => string): string {
  return iso ? dayKey(iso) : "";
}

/** addDays shifts a YYYY-MM-DD by a number of calendar days. */
export function addDays(day: string, days: number): string {
  if (!day) return "";
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** daysBetween counts calendar days from a to b, negative when b precedes a. */
export function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  const from = Date.parse(`${a}T00:00:00Z`);
  const to = Date.parse(`${b}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/** today is the current date in the given zone, as YYYY-MM-DD. */
export function today(dayKey: (iso: string) => string): string {
  return dayKey(new Date().toISOString());
}

/** The Due quick-sets, counted from today rather than from the current due date. */
export const DUE_PRESETS = [
  { key: "tomorrow", days: 1 },
  { key: "nextWeek", days: 7 },
  { key: "nextMonth", days: 30 },
] as const;

/** The Show from quick-sets, counted back from the due date. */
export const SHOW_FROM_PRESETS = [
  { key: "dayBefore", days: 1 },
  { key: "weekBefore", days: 7 },
  { key: "monthBefore", days: 30 },
] as const;

/**
 * shiftShowFrom keeps the gap when the due date moves.
 *
 * Due on the 1st with show-from on the 1st of the month before, moved to the
 * 15th, gives show-from on the 15th of the month before. The gap is measured
 * from the two dates themselves rather than remembered from whichever button
 * set them, so there is no hidden state to get out of step. A blank show-from
 * stays blank: the create-time default never applies to an edit.
 */
export function shiftShowFrom(oldDue: string, newDue: string, showFrom: string): string {
  if (!showFrom || !oldDue || !newDue) return showFrom;
  return addDays(showFrom, daysBetween(oldDue, newDue));
}

/**
 * clampShowFrom mirrors the server rule: an action may not hide past the day it
 * is due. The UI applies it too so the field shows what will be stored rather
 * than snapping after a round-trip.
 */
export function clampShowFrom(due: string, showFrom: string): string {
  if (!due || !showFrom) return showFrom;
  return showFrom > due ? due : showFrom;
}
