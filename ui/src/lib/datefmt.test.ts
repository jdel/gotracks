import { describe, expect, it } from "vitest";
import { browserTimeZone, formatDate, formatDateTime, formatDay } from "./datefmt";

// Some hosts (containers with no /etc/localtime, empty TZ) report "Etc/Unknown"
// as the default zone. It is truthy but Intl.DateTimeFormat throws on it, which
// previously crashed every view that formatted a date. The formatters must fall
// back to UTC instead of throwing, regardless of the host's clock zone.
describe("datefmt zone resilience", () => {
  const iso = "2026-07-31T15:04:05Z";
  const bad = "Etc/Unknown";

  it("formatDateTime tolerates an unusable zone", () => {
    expect(() => formatDateTime(iso, bad)).not.toThrow();
    // UTC fallback renders the wall-clock hour as sent (15:04), not a shift.
    expect(formatDateTime(iso, bad)).toBe(formatDateTime(iso, "UTC"));
  });

  it("formatDate tolerates an unusable zone", () => {
    expect(() => formatDate(iso, bad, "2006-01-02")).not.toThrow();
    expect(formatDate(iso, bad, "2006-01-02")).toBe(formatDate(iso, "UTC", "2006-01-02"));
  });

  it("formatDay tolerates an unusable zone", () => {
    expect(() => formatDay(iso, bad)).not.toThrow();
    expect(formatDay(iso, bad)).toBe(formatDay(iso, "UTC"));
  });

  it("browserTimeZone never returns an unusable zone", () => {
    const zone = browserTimeZone();
    expect(() => new Intl.DateTimeFormat(undefined, { timeZone: zone })).not.toThrow();
  });
});
