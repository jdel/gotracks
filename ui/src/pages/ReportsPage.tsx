import { useState } from "react";
import { RefreshCw, Shield, ShieldCheck, ArrowUp, ArrowDown } from "lucide-react";
import {
  useInstanceSettings,
  useRunUsageReport,
  useUpdateInstanceSettings,
  useUsageReport,
} from "@/hooks/useSettings";
import { formatBytes } from "@/lib/usage";
import { Pagination } from "@/components/Pagination";
import { nextTriState, type TriState } from "@/lib/adminFilter";
import { TimezonePicker } from "@/components/TimezonePicker";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/initials";
import { Button, HeaderBlock, Input, Panel, Screen } from "@/components/primitives";
import { inputClass } from "@/components/primitive-styles";
import { SearchInput } from "@/components/SearchInput";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { UsageReport, UsageSnapshot } from "@/lib/types";
import { useT, type TFunc } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";

type Limits = UsageReport["limits"];

type Column = {
  key: string;
  labelKey: Parameters<TFunc>[0];
  percent: (a: UsageSnapshot) => number;
  raw: (a: UsageSnapshot) => string;
  limit: (l: Limits) => string;
};

// Hoisted to module scope so it is a stable component type across renders
// (react-hooks/static-components); the render-scoped values it used to close
// over are passed as props.
function SortHeader({
  label,
  column,
  sort,
  desc,
  onSort,
}: {
  label: string;
  column: string;
  sort: string;
  desc: boolean;
  onSort: (key: string) => void;
}) {
  const active = sort === column;
  return (
    <th className={cn("mono-label py-3 text-right", active && "text-brand dark:text-brand-ink-dark")}>
      <button type="button" onClick={() => onSort(column)} className="inline-flex items-center gap-0.5">
        {label}
        {active && (desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );
}

const COLUMNS: Column[] = [
  {
    key: "storage",
    labelKey: "reports.colStorage",
    percent: (a) => a.storagePercent,
    raw: (a) => formatBytes(a.storageBytes),
    limit: (l) => formatBytes(l.StorageBytes),
  },
  {
    key: "todos",
    labelKey: "reports.colTodos",
    percent: (a) => a.todoPercent,
    raw: (a) => String(a.todos),
    limit: (l) => String(l.Todos),
  },
  {
    key: "projects",
    labelKey: "reports.colProjects",
    percent: (a) => a.projectPercent,
    raw: (a) => String(a.projects),
    limit: (l) => String(l.Projects),
  },
  {
    key: "notes",
    labelKey: "reports.colNotes",
    percent: (a) => a.notePercent,
    raw: (a) => String(a.notes),
    limit: (l) => String(l.Notes),
  },
  {
    key: "contexts",
    labelKey: "reports.colContexts",
    percent: (a) => a.contextPercent,
    raw: (a) => String(a.contexts),
    limit: (l) => String(l.Contexts),
  },
  {
    key: "tags",
    labelKey: "reports.colTags",
    percent: (a) => a.tagPercent,
    raw: (a) => String(a.tags),
    limit: (l) => String(l.Tags),
  },
  {
    key: "recurring",
    labelKey: "reports.colRecurring",
    percent: (a) => a.recurringPercent,
    raw: (a) => String(a.recurring),
    limit: (l) => String(l.Recurring),
  },
];


/** Minutes since UTC midnight -> "HH:MM" for a <input type="time">. */
function minuteToClock(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" from an <input type="time"> -> minutes since UTC midnight. */
function clockToMinute(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

/** A percentage cell. "used / quota" is on hover, via the app's fast (300ms)
 *  tooltip rather than the browser's native title delay (~1s+). */
function PercentCell({ percent, raw, limit, t }: { percent: number; raw: string; limit: string; t: TFunc }) {
  if (percent < 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <td className="mono cursor-default py-2.5 text-right text-[13px] text-ink-4">—</td>
        </TooltipTrigger>
        <TooltipContent>{t("reports.noLimit", { raw })}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <td
          className={cn(
            "mono cursor-default py-2.5 text-right text-[13px]",
            percent >= 90 ? "font-bold text-danger" : "text-ink-2 dark:text-ink-2-dark",
          )}
        >
          {percent}%
        </td>
      </TooltipTrigger>
      <TooltipContent>
        {raw} / {limit}
      </TooltipContent>
    </Tooltip>
  );
}

export function ReportsPage() {
  const t = useT();
  const { user } = useAuth();
  const fmt = useDateFmt();
  const [search, setSearch] = useState("");
  const [admin, setAdmin] = useState<TriState>("all");
  const [twoFactor, setTwoFactor] = useState<TriState>("all");
  const [sort, setSort] = useState("worst");
  const [desc, setDesc] = useState(true);
  const [page, setPage] = useState(1);

  const { data: report, isLoading } = useUsageReport({
    q: search,
    admin,
    twoFactor,
    sort,
    dir: desc ? "desc" : "asc",
    page,
  });
  const { data: settings } = useInstanceSettings();
  const update = useUpdateInstanceSettings();
  const run = useRunUsageReport();

  const atMinute = settings?.usageReportAtMinute ?? 0;

  function toggleSort(key: string) {
    if (sort === key) {
      setDesc((d) => !d);
    } else {
      setSort(key);
      setDesc(true);
    }
    setPage(1);
  }

  return (
    <Screen
      header={
        <HeaderBlock
          title={t("nav.reports")}
          avatar={initials(user?.email)} avatarLabel={t("nav.settings")}
          metrics={[
            { value: report?.total ?? 0, label: t("admin.metricAccounts") },
            {
              label: report?.generatedAt
                ? t("reports.built", { date: fmt.dateTime(report.generatedAt) })
                : t("reports.never"),
            },
          ]}
        />
      }
    >
      <Panel className="mt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="report-at" className="text-[11px] font-bold text-ink-3 dark:text-ink-4-dark">{t("reports.dailyRebuild")}</label>
              <div className="flex items-center gap-2">
                <Input
                  id="report-at"
                  type="time"
                  className={cn(inputClass, "w-32")}
                  value={minuteToClock(atMinute)}
                  onChange={(e) =>
                    update.mutate({ usageReportAtMinute: clockToMinute(e.target.value) })
                  }
                />
                <TimezonePicker value={settings?.usageReportTimeZone || "UTC"} onChange={(zone) => update.mutate({ usageReportTimeZone: zone })} ariaLabel="Report time zone" />
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
              <RefreshCw className={cn(run.isPending && "animate-spin")} />
              {run.isPending ? t("reports.rebuilding") : t("reports.rebuildNow")}
            </Button>
          </div>

          {/* Same filters as the user list. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              className="sm:min-w-48 sm:flex-1"
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder={t("reports.searchEmail")}
              ariaLabel={t("reports.searchAria")}
            />
            <div className="flex gap-2">
              <Button
                variant={admin === "all" ? "ghost" : "primary"}
                size="sm"
                className="flex-1 sm:flex-none"
                onClick={() => {
                  setAdmin(nextTriState(admin));
                  setPage(1);
                }}
              >
                <Shield /> {t("reports.adminFilter", { state: t(`filter.${admin === "all" ? "all" : admin}` as Parameters<TFunc>[0]) })}
              </Button>
              <Button
                variant={twoFactor === "all" ? "ghost" : "primary"}
                size="sm"
                className="flex-1 sm:flex-none"
                onClick={() => {
                  setTwoFactor(nextTriState(twoFactor));
                  setPage(1);
                }}
              >
                <ShieldCheck /> {t("reports.twoFactorFilter", { state: t(`filter.${twoFactor === "all" ? "all" : twoFactor}` as Parameters<TFunc>[0]) })}
              </Button>
            </div>
          </div>

          {isLoading && !report && <p className="text-sm font-medium text-ink-3">{t("common.loading")}</p>}

          {report && report.accounts.length === 0 && (
            <p className="text-sm font-medium text-ink-3">
              {report.total === 0 && !search ? t("reports.noData") : t("reports.noMatch")}
            </p>
          )}

          {report && report.accounts.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line dark:border-line-dark">
                      <th className={cn("mono-label py-3 text-left", sort === "email" && "text-brand dark:text-brand-ink-dark")}>
                        <button type="button" onClick={() => toggleSort("email")} className="inline-flex items-center gap-0.5">
                          {t("reports.account")}
                          {sort === "email" &&
                            (desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                        </button>
                      </th>
                      <SortHeader label={t("reports.worst")} column="worst" sort={sort} desc={desc} onSort={toggleSort} />
                      {COLUMNS.map((c) => (
                        <SortHeader key={c.key} label={t(c.labelKey)} column={c.key} sort={sort} desc={desc} onSort={toggleSort} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.accounts.map((a) => (
                      <tr key={a.userId} className="border-b border-line-3 last:border-0 dark:border-line-dark">
                        <td className="max-w-56 truncate py-2.5 text-[13px] font-medium text-ink dark:text-ink-dark" title={a.email}>
                          {a.email}
                        </td>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <td
                              className={cn(
                                "mono cursor-default py-2.5 text-right text-[13px] font-bold",
                                a.worstPercent >= 90 ? "text-danger" : "text-ink-4",
                              )}
                            >
                              {a.worstPercent < 0 ? "—" : `${a.worstPercent}%`}
                            </td>
                          </TooltipTrigger>
                          <TooltipContent>{t("reports.worstHint")}</TooltipContent>
                        </Tooltip>
                        {COLUMNS.map((c) => (
                          <PercentCell
                            key={c.key}
                            percent={c.percent(a)}
                            raw={c.raw(a)}
                            limit={c.limit(report.limits)}
                            t={t}
                          />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={report.page} pageSize={report.pageSize} total={report.total} onPage={setPage} />
            </>
          )}
      </Panel>
    </Screen>
  );
}
