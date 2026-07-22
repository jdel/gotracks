import { cn } from "@/lib/utils";
import type { QuotaUsage } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { formatBytes } from "@/lib/usage";

/** One labelled bar with "used of limit". */
export function UsageRow({
  label,
  used,
  limit,
  format = (n: number) => String(n),
}: {
  label: string;
  used: number;
  limit: number;
  format?: (n: number) => string;
}) {
  const t = useT();
  const unlimited = limit <= 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {unlimited ? format(used) : t("usage.ofLimit", { used: format(used), limit: format(limit) })}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            // Amber past 75%, red at the limit: the useful signal is "about to
            // become a problem", not the exact number.
            className={cn(
              "h-full rounded-full transition-all",
              pct >= 100 ? "bg-destructive" : pct >= 75 ? "bg-amber-500" : "bg-primary",
            )}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** The full set of bars for one account. Shared by settings and the admin
 *  panel, so the two cannot drift apart. */
export function UsageBars({ usage }: { usage: QuotaUsage }) {
  const t = useT();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <UsageRow
        label={t("usage.attachments")}
        used={usage.storageBytes}
        limit={usage.storageLimit}
        format={formatBytes}
      />
      <UsageRow label={t("usage.actions")} used={usage.todos} limit={usage.todoLimit} />
      <UsageRow label={t("usage.projects")} used={usage.projects} limit={usage.projectLimit} />
      <UsageRow label={t("usage.notes")} used={usage.notes} limit={usage.noteLimit} />
      <UsageRow label={t("usage.contexts")} used={usage.contexts} limit={usage.contextLimit} />
      <UsageRow label={t("usage.tags")} used={usage.tags} limit={usage.tagLimit} />
      <UsageRow label={t("usage.recurring")} used={usage.recurring} limit={usage.recurringLimit} />
    </div>
  );
}
