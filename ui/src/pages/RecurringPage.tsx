import { useMemo, useState } from "react";
import { Plus, Trash2, Repeat, Pause, Play } from "lucide-react";
import {
  useCreateRecurring,
  useDeleteRecurring,
  useRecurring,
  useUpdateRecurring,
} from "@/hooks/useRecurring";
import { useContexts } from "@/hooks/useContexts";
import { useProjects } from "@/hooks/useProjects";
import { ActionInput } from "@/components/ActionInput";
import { bare, parseAction, type Sigil } from "@/lib/composer";
import { apiMessage } from "@/lib/api";
import { useT, useTn, type TFunc, type TnFunc } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";
import { lastUsed } from "@/lib/lastUsed";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import type { Context, Project, RecurrencePeriod, RecurringTodo } from "@/lib/types";
import { SearchInput } from "@/components/SearchInput";
import { PageWithAdd } from "@/components/PageWithAdd";
import { cn } from "@/lib/utils";



// weekdayShort returns the short label for a weekday index (Sunday = 0).
function weekdayShort(t: TFunc, d: number): string {
  return t(`weekday.short.${d}` as Parameters<TFunc>[0]);
}

// describe renders a pattern as a human sentence, translated, e.g.
// "Every 2 weeks on Mon, Fri".
function describe(t: TFunc, tn: TnFunc, r: RecurringTodo): string {
  switch (r.period) {
    case "daily":
      return tn(r.everyN, "recurring.desc.daily");
    case "weekly": {
      const names = r.weekdays
        .split(",")
        .map((d) => weekdayShort(t, Number(d)))
        .filter(Boolean)
        .join(", ");
      const days = names ? ` ${t("recurring.on", { days: names })}` : "";
      return tn(r.everyN, "recurring.desc.weekly", { days });
    }
    case "monthly":
      return tn(r.everyN, "recurring.desc.monthly", { day: r.dayOfMonth || 1 });
    case "yearly":
      return tn(r.everyN, "recurring.desc.yearly", { month: r.monthOfYear || 1, day: r.dayOfMonth || 1 });
    default:
      return r.period;
  }
}

const WEEKDAY_INDEXES = [0, 1, 2, 3, 4, 5, 6];

/** The recurring-pattern add form: the composer field plus period, interval,
 *  weekday/day-of-month controls. Permanent on desktop, full screen on a phone
 *  where onAdded closes the sheet after a successful create. */
function RecurringAddForm({
  contexts,
  projects,
  onAdded,
}: {
  contexts: Context[];
  projects: Project[];
  onAdded: () => void;
}) {
  const t = useT();
  const create = useCreateRecurring();

  const [text, setText] = useState("");
  const [period, setPeriod] = useState<RecurrencePeriod>("weekly");
  const [everyN, setEveryN] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [monthOfYear, setMonthOfYear] = useState(1);
  const [showFromDays, setShowFromDays] = useState(0);
  const [error, setError] = useState("");

  const activeContexts = useMemo(
    () => contexts.filter((c) => c.state === "active"),
    [contexts],
  );
  const parseOpts = useMemo(() => ({ sigils: ["@", "#"] as Sigil[] }), []);
  const parsed = useMemo(
    () => parseAction(text, activeContexts, projects, [], parseOpts),
    [text, activeContexts, projects, parseOpts],
  );

  const rememberedContext = activeContexts.some((c) => c.id === lastUsed.contextId)
    ? lastUsed.contextId
    : undefined;
  const effectiveContextId = parsed.contextIsNew
    ? undefined
    : parsed.contextId ?? rememberedContext ?? activeContexts[0]?.id;
  const effectiveProjectId = parsed.projectIsNew ? undefined : parsed.projectId;
  const contextLabel =
    parsed.contextName ?? activeContexts.find((c) => c.id === effectiveContextId)?.name;
  const projectLabel =
    parsed.projectName ?? projects.find((p) => p.id === effectiveProjectId)?.name;

  function toggleWeekday(d: number) {
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  }

  function submit() {
    if (!parsed.description) return;
    if (!effectiveContextId && !parsed.contextIsNew) {
      setError(t("recurring.errorContext"));
      return;
    }
    setError("");
    create.mutate(
      {
        contextId: effectiveContextId,
        projectId: effectiveProjectId,
        contextName: parsed.contextIsNew ? parsed.contextName : undefined,
        projectName: parsed.projectIsNew ? parsed.projectName : undefined,
        description: parsed.description,
        period,
        everyN,
        weekdays: period === "weekly" ? weekdays.join(",") : undefined,
        dayOfMonth: period === "monthly" || period === "yearly" ? dayOfMonth : undefined,
        monthOfYear: period === "yearly" ? monthOfYear : undefined,
        showFromDays,
      },
      {
        onSuccess: () => {
          setText("");
          onAdded();
        },
        onError: (err) => setError(apiMessage(err, t("recurring.errorCreate"))),
      },
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-3 rounded-lg border p-3"
    >
      <div className="flex">
        <ActionInput
          value={text}
          onChange={setText}
          onSubmit={submit}
          contexts={activeContexts}
          projects={projects}
          tags={[]}
          sigils={["@", "#"]}
          placeholder={t("recurring.placeholder")}
        />
      </div>

      {/* Where the spawned actions will land. */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {contextLabel && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-sky-700 dark:text-sky-300",
              parsed.contextIsNew ? "border border-dashed border-sky-500" : "bg-sky-500/15",
            )}
          >
            @{bare(contextLabel, "@")}
            {parsed.contextIsNew && ` · ${t("quickadd.new")}`}
          </span>
        )}
        {projectLabel && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-violet-700 dark:text-violet-300",
              parsed.projectIsNew ? "border border-dashed border-violet-500" : "bg-violet-500/15",
            )}
          >
            #{bare(projectLabel, "#")}
            {parsed.projectIsNew && ` · ${t("quickadd.new")}`}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          {t("recurring.repeats")}
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={period}
            onChange={(e) => setPeriod(e.target.value as RecurrencePeriod)}
          >
            <option value="daily">{t("recurring.daily")}</option>
            <option value="weekly">{t("recurring.weekly")}</option>
            <option value="monthly">{t("recurring.monthly")}</option>
            <option value="yearly">{t("recurring.yearly")}</option>
          </select>
        </label>

        <label className="text-xs text-muted-foreground">
          {t("recurring.every")}
          <Input
            type="number"
            min={1}
            className="mt-1"
            value={everyN}
            onChange={(e) => setEveryN(Math.max(1, Number(e.target.value)))}
          />
        </label>

        <label className="text-xs text-muted-foreground">
          {t("recurring.leadDays")}
          <Input
            type="number"
            min={0}
            className="mt-1"
            value={showFromDays}
            onChange={(e) => setShowFromDays(Math.max(0, Number(e.target.value)))}
          />
        </label>
      </div>

      {period === "weekly" && (
        <div className="flex flex-wrap gap-1">
          {WEEKDAY_INDEXES.map((i) => (
            <Button
              key={i}
              type="button"
              size="sm"
              variant={weekdays.includes(i) ? "default" : "outline"}
              onClick={() => toggleWeekday(i)}
            >
              {weekdayShort(t, i)}
            </Button>
          ))}
        </div>
      )}

      {(period === "monthly" || period === "yearly") && (
        <div className="grid gap-3 sm:grid-cols-2">
          {period === "yearly" && (
            <label className="text-xs text-muted-foreground">
              {t("recurring.month")}
              <Input
                type="number"
                min={1}
                max={12}
                className="mt-1"
                value={monthOfYear}
                onChange={(e) => setMonthOfYear(Number(e.target.value))}
              />
            </label>
          )}
          <label className="text-xs text-muted-foreground">
            {t("recurring.dayOfMonth")}
            <Input
              type="number"
              min={1}
              max={31}
              className="mt-1"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={create.isPending}>
        <Plus /> {t("recurring.addPattern")}
      </Button>
    </form>
  );
}

export function RecurringPage() {
  const t = useT();
  const fmt = useDateFmt();
  const tn = useTn();
  const [confirming, setConfirming] = useState<{ id: number; description: string } | null>(null);
  const { data: patterns, isLoading } = useRecurring();
  const { data: contexts } = useContexts();
  const { data: projects } = useProjects("active");
  const update = useUpdateRecurring();
  const del = useDeleteRecurring();
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const visible = (patterns ?? []).filter((p) => p.description.toLowerCase().includes(needle));

  return (
    <PageWithAdd
      title={t("nav.recurring")}
      subtitle={t("recurring.subtitle")}
      addLabel={t("recurring.addTitle")}
      renderForm={(onAdded) => (
        <RecurringAddForm contexts={contexts ?? []} projects={projects ?? []} onAdded={onAdded} />
      )}
    >
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={t("recurring.searchPlaceholder")}
        ariaLabel={t("recurring.searchAria")}
      />

      {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}

      <ul className="space-y-2">
        {visible.map((p) => (
          <li key={p.id}>
            <Card className="flex items-start gap-3 p-3">
              <Repeat className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm", p.state === "completed" && "text-muted-foreground line-through")}>
                  {p.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  {describe(t, tn, p)}
                  {p.lastSpawnedAt &&
                    ` · ${t("recurring.last", { date: fmt.date(p.lastSpawnedAt) })}`}
                </p>
              </div>
              <IconButton
                variant="ghost"
                label={p.state === "completed" ? t("recurring.resume") : t("recurring.pause")}
                onClick={() =>
                  update.mutate({ id: p.id, state: p.state === "completed" ? "active" : "completed" })
                }
              >
                {p.state === "completed" ? <Play className="size-4" /> : <Pause className="size-4" />}
              </IconButton>
              <IconButton
                variant="ghost"
                label={t("recurring.deleteLabel", { description: p.description })}
                onClick={() => setConfirming(p)}
              >
                <Trash2 className="size-4 text-destructive" />
              </IconButton>
            </Card>
          </li>
        ))}
      </ul>

      {patterns?.length === 0 && !isLoading && (
        <p className="text-center text-sm text-muted-foreground">{t("recurring.none")}</p>
      )}
      {patterns && patterns.length > 0 && visible.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">{t("recurring.noMatch")}</p>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t("recurring.deleteTitle")}
        description={
          <>
            <strong>{confirming?.description}</strong> {t("recurring.deleteDescBody")}
          </>
        }
        busy={del.isPending}
        onConfirm={() => {
          if (confirming) del.mutate(confirming.id);
          setConfirming(null);
        }}
      />
    </PageWithAdd>
  );
}
