import { useStats } from "@/hooks/useSettings";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/initials";
import { Screen, HeaderBlock, Panel } from "@/components/primitives";
import { cn } from "@/lib/utils";

/** StatTile is a hero number: a magnitude that needs no plot. */
function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card bg-card p-4 shadow-card dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none">
      <p className="text-xs font-medium text-ink-3 dark:text-ink-4-dark">{label}</p>
      <p className="mono mt-1 text-[30px] leading-none font-extrabold text-ink dark:text-ink-dark">
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] font-medium text-ink-4">{hint}</p>}
    </div>
  );
}

/** MonthlyBars plots completions over the last 12 months (one series, so no legend).
 *  Older history is a muted violet, the recent months brand, the current (last)
 *  month done; empty months are a line. */
function MonthlyBars({ data }: { data: { month: string; count: number }[] }) {
  const t = useT();
  const max = Math.max(...data.map((d) => d.count), 1);
  const lastIndex = data.length - 1;
  // The last four months read as "recent"; anything older is muted history.
  const recentFrom = lastIndex - 3;

  return (
    <div>
      <div className="flex h-40 items-end gap-[2px]" role="presentation">
        {data.map((d, i) => {
          const pct = (d.count / max) * 100;
          const current = d.count > 0 && i === lastIndex;
          const recent = i >= recentFrom;
          return (
            <div key={d.month} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="mono text-[9px] text-ink-4">{current ? d.count : ""}</span>
              <div
                className={cn(
                  "w-full rounded-t",
                  d.count === 0
                    ? "bg-line dark:bg-line-dark"
                    : current
                      ? "bg-done"
                      : recent
                        ? "bg-brand dark:bg-brand-dark"
                        : "bg-history dark:bg-history-dark",
                )}
                style={{ height: `${Math.max(pct, d.count > 0 ? 4 : 1)}%` }}
                title={`${d.month}: ${d.count}`}
              />
              <span className="mono w-full truncate text-center text-[9px] text-ink-4">
                {d.month.slice(5)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Same numbers for screen readers and exact values. */}
      <table className="sr-only">
        <caption>{t("stats.perMonthCaption")}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.month}>
              <th scope="row">{d.month}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** ContextBars ranks open actions per context as horizontal bars. */
function ContextBars({ data }: { data: { contextId: number; name: string; open: number }[] }) {
  const max = Math.max(...data.map((d) => d.open), 1);
  return (
    <ul className="flex flex-col gap-2">
      {data.map((d) => (
        <li key={d.contextId} className="grid grid-cols-[minmax(0,7rem)_1fr_2rem] items-center gap-2">
          <span className="truncate text-xs font-medium text-ink-2 dark:text-ink-2-dark">{d.name}</span>
          <div className="h-2 w-full overflow-hidden rounded-full bg-line dark:bg-line-dark">
            <div
              className="h-full rounded-full bg-brand dark:bg-brand-dark"
              style={{ width: `${Math.max((d.open / max) * 100, d.open > 0 ? 2 : 0)}%` }}
              title={`${d.name}: ${d.open}`}
            />
          </div>
          <span className="mono text-right text-xs text-ink-4">{d.open}</span>
        </li>
      ))}
    </ul>
  );
}

export function StatsPage() {
  const t = useT();
  const { user } = useAuth();
  const { data: stats, isLoading } = useStats();

  if (isLoading || !stats) {
    return <p className="p-6 text-sm font-medium text-ink-3">{t("actions.loading")}</p>;
  }

  const hasData = stats.totalActions > 0;

  return (
    <Screen header={<HeaderBlock title={t("stats.title")} avatar={initials(user?.email)} avatarLabel={t("nav.settings")} />}>
      {!hasData ? (
        <p className="mt-4 text-sm font-medium text-ink-3 dark:text-ink-4-dark">{t("stats.noData")}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-[9px] md:grid-cols-4 md:gap-3">
            <StatTile label={t("stats.total")} value={String(stats.totalActions)} />
            <StatTile
              label={t("stats.completed")}
              value={String(stats.completed)}
              hint={t("stats.activeDeferred", { active: stats.active, deferred: stats.deferred })}
            />
            <StatTile label={t("stats.completionRate")} value={`${stats.completionRate.toFixed(0)}%`} />
            <StatTile label={t("stats.avgDays")} value={stats.avgCompletionDays.toFixed(1)} hint={t("stats.days")} />
            <StatTile label={t("stats.last30")} value={String(stats.completedLast30)} />
            <StatTile label={t("stats.oldest")} value={String(stats.oldestOpenDays)} hint={t("stats.days")} />
          </div>

          <div className="flex flex-col gap-4 md:grid md:grid-cols-[1.4fr_1fr]">
            <Panel title={t("stats.perMonth")}>
              <MonthlyBars data={stats.perMonth} />
            </Panel>

            {stats.perContext.length > 0 && (
              <Panel title={t("stats.perContext")}>
                <ContextBars data={stats.perContext} />
              </Panel>
            )}
          </div>

          <p className="text-xs font-medium text-ink-4">
            {t("stats.projectsSummary", {
              active: stats.projectsActive,
              completed: stats.projectsCompleted,
              hidden: stats.projectsHidden,
            })}
          </p>
        </div>
      )}
    </Screen>
  );
}
