import type { QuotaUsage } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { formatBytes } from "@/lib/usage";
import { Meter } from "@/components/primitives";

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
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-ink dark:text-ink-dark">{label}</span>
        <span className="mono text-xs text-ink-4">
          {unlimited ? format(used) : t("usage.ofLimit", { used: format(used), limit: format(limit) })}
        </span>
      </div>
      {/* Meter fills brand and turns danger at 90% — the useful signal is
          "about to become a problem", not the exact number. */}
      {!unlimited && <Meter value={pct} max={100} height={6} />}
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
