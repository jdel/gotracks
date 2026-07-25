import { useQuery } from "@tanstack/react-query";
import { api, tokenStore } from "@/lib/api";
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
  const res = await fetch(`/api/v1/admin/audit/export?${query}`, {
    headers: { Authorization: `Bearer ${tokenStore.access ?? ""}` },
  });
  if (!res.ok) throw new Error("export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gotracks-audit-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
