// detectTimeZone returns the browser's IANA time zone, validated so it can be
// supplied back to the server as an explicit `timeZone`. It returns "UTC" when
// detection is unavailable or the reported value is not a zone the platform
// accepts (some environments report placeholders such as "Etc/Unknown").
export function detectTimeZone(): string {
  let tz: string;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "UTC";
  }
  if (!tz) {
    return "UTC";
  }
  try {
    // Constructing with an unknown zone throws RangeError, which is exactly the
    // check the server would apply when it loads the location.
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    return "UTC";
  }
  return tz;
}
