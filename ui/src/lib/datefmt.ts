import { useCallback } from "react";
import { usePreferences } from "@/hooks/useSettings";

/**
 * usableZone returns tz when the platform can format with it, otherwise "UTC".
 * Some environments report placeholders such as "Etc/Unknown" that are truthy
 * but make Intl.DateTimeFormat throw; a bad zone must never crash a render.
 */
function usableZone(tz: string): string {
  if (!tz) {
    return "UTC";
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** browserTimeZone is the IANA zone the browser reports (e.g. "Europe/Paris"). */
export function browserTimeZone(): string {
  try {
    return usableZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return "UTC";
  }
}

// The stored dateFormat is a Go layout string; map each supported one to the
// Intl locale/options that render it, so a saved preference actually changes
// what is shown. Anything unrecognised falls back to ISO.
const LAYOUTS: Record<string, { locale: string; opts: Intl.DateTimeFormatOptions }> = {
  "2006-01-02": { locale: "en-CA", opts: { year: "numeric", month: "2-digit", day: "2-digit" } },
  "02/01/2006": { locale: "en-GB", opts: { year: "numeric", month: "2-digit", day: "2-digit" } },
  "01/02/2006": { locale: "en-US", opts: { year: "numeric", month: "2-digit", day: "2-digit" } },
  "02 Jan 2006": { locale: "en-GB", opts: { year: "numeric", month: "short", day: "2-digit" } },
};

/** formatDate renders an ISO string in the given zone and layout. */
export function formatDate(iso: string, timeZone: string, layout: string): string {
  const l = LAYOUTS[layout] ?? LAYOUTS["2006-01-02"];
  return new Intl.DateTimeFormat(l.locale, { ...l.opts, timeZone: usableZone(timeZone) }).format(
    new Date(iso),
  );
}

/** formatDateTime renders date + time in the given zone. */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: usableZone(timeZone),
  }).format(new Date(iso));
}

/** formatDay renders a compact "12 Jul" in the given zone, for dense rows. */
export function formatDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: usableZone(timeZone),
  }).format(new Date(iso));
}

/** formatWeekday renders "Mon 3 Aug" — the heading over a day's group of rows. */
export function formatWeekday(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: usableZone(timeZone),
  }).format(new Date(iso));
}

/**
 * dayKey reduces an instant to the calendar day it falls on *in the account's
 * zone*, so rows group by the day the user saw, not by the day it was in UTC.
 * The en-CA locale is chosen only because it yields a sortable YYYY-MM-DD.
 */
export function dayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: usableZone(timeZone),
  }).format(new Date(iso));
}

/**
 * useDateFmt returns formatters bound to the account's preferences. The zone
 * falls back to the browser's when none is stored, so dates read locally by
 * default rather than in UTC.
 */
export function useDateFmt() {
  const { data: prefs } = usePreferences();
  const timeZone = prefs?.timeZone || browserTimeZone();
  const layout = prefs?.dateFormat || "2006-01-02";
  return {
    timeZone,
    date: useCallback((iso: string) => formatDate(iso, timeZone, layout), [timeZone, layout]),
    day: useCallback((iso: string) => formatDay(iso, timeZone), [timeZone]),
    dateTime: useCallback((iso: string) => formatDateTime(iso, timeZone), [timeZone]),
    weekday: useCallback((iso: string) => formatWeekday(iso, timeZone), [timeZone]),
    dayKey: useCallback((iso: string) => dayKey(iso, timeZone), [timeZone]),
  };
}
