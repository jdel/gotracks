import { useQuery } from "@tanstack/react-query";
import { api, tokenStore } from "@/lib/api";
import { datedName, saveBlob } from "@/lib/download";
import type { AuditFilter, AuditPage } from "@/lib/types";

/** The filter as query parameters, dropping anything empty. */
export function auditQuery(filter: AuditFilter, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filter, ...extra })) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

export function useAuditLog(filter: AuditFilter, page: number, pageSize: number) {
  const query = auditQuery(filter, { page: String(page), pageSize: String(pageSize) });
  return useQuery({
    queryKey: ["audit", query],
    queryFn: () => api.get<AuditPage>(`/admin/audit?${query}`),
    // A page of the log is a snapshot of a moving table; showing the previous
    // one while the next arrives beats blanking the screen on every filter
    // change.
    placeholderData: (previous) => previous,
  });
}

/** The vocabulary the filter offers, so it can never drift from the server. */
export function useAuditActions() {
  return useQuery({
    queryKey: ["audit", "actions"],
    queryFn: () => api.get<string[]>("/admin/audit/actions"),
    enabled: !!tokenStore.access,
    staleTime: Infinity,
  });
}

/**
 * Downloads everything matching the current filter, not the visible page: an
 * export that silently stopped at one page would be worse than none.
 */
export async function downloadAuditExport(
  filter: AuditFilter,
  format: "json" | "csv",
): Promise<void> {
  const query = auditQuery(filter, { format });
  saveBlob(await api.blob(`/admin/audit/export?${query}`), `${datedName("gotracks-audit")}.${format}`);
}
