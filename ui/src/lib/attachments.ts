import { api, ApiError } from "@/lib/api";
import { saveBlob } from "@/lib/download";

// Goes through the shared authed transport, so an expired access token is
// refreshed and the download retried rather than failed, and a refusal arrives
// as an ApiError carrying the server's wording.
export async function downloadAttachment(id: number, fileName: string): Promise<void> {
  saveBlob(await api.blob(`/attachments/${id}`), fileName);
}

/** A short, user-facing reason a download failed. */
export function downloadErrorMessage(err: unknown, fileName: string): string {
  if (err instanceof ApiError && err.status === 404) {
    return `${fileName} is no longer available on the server.`;
  }
  return `Could not download ${fileName}.`;
}
