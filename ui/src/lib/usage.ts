import type { QuotaUsage } from "@/lib/types";

/** formatBytes renders a byte count as B / KB / MB. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** True when nothing is capped, so the whole panel can be hidden. */
export function hasAnyLimit(u: QuotaUsage): boolean {
  return (
    u.storageLimit > 0 ||
    u.todoLimit > 0 ||
    u.projectLimit > 0 ||
    u.noteLimit > 0 ||
    u.contextLimit > 0 ||
    u.tagLimit > 0 ||
    u.recurringLimit > 0
  );
}
