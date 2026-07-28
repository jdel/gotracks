import { afterEach, describe, expect, it, vi } from "vitest";
import { detectTimeZone } from "./timezone";

// Stub only what the browser reports as its zone. Validation still runs on the
// real Intl constructor, so an unknown zone is rejected exactly as the platform
// would reject it.
function reportZone(timeZone: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    timeZone,
  } as Intl.ResolvedDateTimeFormatOptions);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detectTimeZone", () => {
  it("passes a valid detected zone through", () => {
    reportZone("Europe/Paris");
    expect(detectTimeZone()).toBe("Europe/Paris");
  });

  it("falls back to UTC for a zone the platform rejects", () => {
    reportZone("Etc/Unknown");
    expect(detectTimeZone()).toBe("UTC");
  });

  it("falls back to UTC when detection is unavailable", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(() => {
      throw new Error("Intl unavailable");
    });
    expect(detectTimeZone()).toBe("UTC");
  });
});
