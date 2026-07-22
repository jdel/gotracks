import { useState } from "react";
import { Gauge } from "lucide-react";
import { useMyUsage, useStats } from "@/hooks/useSettings";
import { useT } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { UsageBars } from "@/components/UsageBars";
import { hasAnyLimit } from "@/lib/usage";

// Single validated series colour. #3b82f6 sits inside the OKLCH lightness band
// for BOTH modes (light 0.43–0.77, dark 0.48–0.67) and clears 3:1 contrast on
// both surfaces, so one value serves light and dark without an automatic flip.
const SERIES = "#3b82f6";

/** StatTile is a hero number: a magnitude that needs no plot. */
function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** MonthlyBars plots completions over the last 12 months (one series, so no legend). */
function MonthlyBars({ data }: { data: { month: string; count: number }[] }) {
  const t = useT();
  const max = Math.max(...data.map((d) => d.count), 1);
  const peak = data.reduce((a, b) => (b.count > a.count ? b : a), data[0]);

  return (
    <div>
      <div className="flex h-40 items-end gap-[2px]" role="presentation">
        {data.map((d) => {
          const pct = (d.count / max) * 100;
          const isPeak = d.count > 0 && d.month === peak.month;
          return (
            <div key={d.month} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              {/* Selective direct label: only the peak, never every bar. */}
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {isPeak ? d.count : ""}
              </span>
              <div
                className="w-full rounded-t"
                style={{
                  height: `${Math.max(pct, d.count > 0 ? 4 : 1)}%`,
                  backgroundColor: d.count > 0 ? SERIES : "var(--color-border)",
                }}
                title={`${d.month}: ${d.count}`}
              />
              <span className="w-full truncate text-center text-[10px] text-muted-foreground">
                {d.month.slice(5)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Table view: the same numbers, available to screen readers and to anyone
          who needs exact values rather than bar lengths. */}
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
    <ul className="space-y-2">
      {data.map((d) => (
        <li key={d.contextId} className="grid grid-cols-[minmax(0,7rem)_1fr_2rem] items-center gap-2">
          <span className="truncate text-xs text-muted-foreground">{d.name}</span>
          <div className="h-4 w-full">
            <div
              className="h-full rounded-r"
              style={{
                width: `${Math.max((d.open / max) * 100, d.open > 0 ? 2 : 0)}%`,
                backgroundColor: SERIES,
              }}
              title={`${d.name}: ${d.open}`}
            />
          </div>
          <span className="text-right text-xs tabular-nums text-muted-foreground">{d.open}</span>
        </li>
      ))}
    </ul>
  );
}

export function StatsPage() {
  const t = useT();
  const { data: stats, isLoading } = useStats();
  const { data: usage } = useMyUsage();
  const [showUsage, setShowUsage] = useState(false);

  if (isLoading || !stats) {
    return <p className="text-sm text-muted-foreground">{t("actions.loading")}</p>;
  }

  const hasData = stats.totalActions > 0;
  // Only when something is actually capped: a self-hosted instance with no
  // limits set would otherwise open a panel of blanks.
  const showUsageButton = usage && hasAnyLimit(usage);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("stats.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("stats.subtitle")}</p>
        </div>
        {showUsageButton && (
          <IconButton variant="outline" label={t("stats.usage")} onClick={() => setShowUsage(true)}>
            <Gauge className="size-4" />
          </IconButton>
        )}
      </div>

      {showUsageButton && (
        <Dialog open={showUsage} onOpenChange={setShowUsage}>
          <DialogContent className="sm:max-w-2xl">
            <div className="mx-auto w-full max-w-2xl">
              <DialogHeader>
                <DialogTitle>{t("stats.usage")}</DialogTitle>
              </DialogHeader>
              <div className="mt-6">
                <UsageBars usage={usage} />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {!hasData && <p className="text-sm text-muted-foreground">{t("stats.noData")}</p>}

      {hasData && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label={t("stats.total")} value={String(stats.totalActions)} />
            <StatTile
              label={t("stats.completed")}
              value={String(stats.completed)}
              hint={t("stats.activeDeferred", { active: stats.active, deferred: stats.deferred })}
            />
            <StatTile
              label={t("stats.completionRate")}
              value={`${stats.completionRate.toFixed(0)}%`}
            />
            <StatTile
              label={t("stats.avgDays")}
              value={stats.avgCompletionDays.toFixed(1)}
              hint={t("stats.days")}
            />
            <StatTile label={t("stats.last30")} value={String(stats.completedLast30)} />
            <StatTile
              label={t("stats.oldest")}
              value={String(stats.oldestOpenDays)}
              hint={t("stats.days")}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("stats.perMonth")}</CardTitle>
            </CardHeader>
            <CardContent>
              <MonthlyBars data={stats.perMonth} />
            </CardContent>
          </Card>

          {stats.perContext.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("stats.perContext")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ContextBars data={stats.perContext} />
              </CardContent>
            </Card>
          )}

          <div className="text-xs text-muted-foreground">
            {t("stats.projectsSummary", {
              active: stats.projectsActive,
              completed: stats.projectsCompleted,
              hidden: stats.projectsHidden,
            })}
          </div>
        </>
      )}
    </div>
  );
}
