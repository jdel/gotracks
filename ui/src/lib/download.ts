/**
 * Saves bytes the page already holds under a file name of its choosing.
 *
 * The three downloads in the app — an attachment, the account export, an audit
 * export — all need the bearer header, so none of them can be a plain link;
 * each fetches the bytes and then performs this same anchor dance. It is
 * written once here.
 *
 * The object URL is revoked immediately after the click, which is what the
 * original three did. Some browsers are said to cancel a download whose URL
 * disappears too early; that is a pre-existing question about this sequence,
 * and changing it belongs in its own change rather than inside a refactor of
 * the transport.
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** `gotracks-2026-08-13`, the stem every export file name is built on. */
export function datedName(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}`;
}
