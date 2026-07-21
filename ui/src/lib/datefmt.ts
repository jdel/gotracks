import { useCallback } from "react";
import { usePreferences } from "@/hooks/useSettings";

/** browserTimeZone is the IANA zone the browser reports (e.g. "Europe/Paris"). */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
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
  return new Intl.DateTimeFormat(l.locale, { ...l.opts, timeZone }).format(new Date(iso));
}

/** formatDateTime renders date + time in the given zone. */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

/** formatDay renders a compact "12 Jul" in the given zone, for dense rows. */
export function formatDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone }).format(
    new Date(iso),
  );
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
  };
}
