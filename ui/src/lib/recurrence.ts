import type { TFunc } from "@/lib/i18n";

/** The short label for a weekday index (Sunday = 0). */
export function weekdayShort(t: TFunc, d: number): string {
  return t(`weekday.short.${d}` as Parameters<TFunc>[0]);
}
