import { ApiError, tokenStore } from "@/lib/api";

// Fetches with the bearer token and saves via a blob URL, because a plain
// <a href> cannot carry the Authorization header. Throws ApiError on failure
// so callers can tell the user why the download didn't happen, rather than
// have it fail silently.
export async function downloadAttachment(id: number, fileName: string): Promise<void> {
  const res = await fetch(`/api/v1/attachments/${id}`, {
    headers: { Authorization: `Bearer ${tokenStore.access ?? ""}` },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** A short, user-facing reason a download failed. */
export function downloadErrorMessage(err: unknown, fileName: string): string {
  if (err instanceof ApiError && err.status === 404) {
    return `${fileName} is no longer available on the server.`;
  }
  return `Could not download ${fileName}.`;
}
