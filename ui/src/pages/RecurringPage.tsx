import { useMemo, useState } from "react";
import { Plus, Trash2, Repeat, Pause, Play, Pencil } from "lucide-react";
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
import { useUndo } from "@/lib/undo";
import { useT, useTn, type TFunc, type TnFunc } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";
import { lastUsed } from "@/lib/lastUsed";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import type { Context, Project, RecurrencePeriod, RecurringTodo } from "@/lib/types";
import { SearchInput } from "@/components/SearchInput";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/initials";
import { Screen, HeaderBlock, Fab, Sheet, SkeletonList, EmptyState } from "@/components/primitives";
import { rowActions } from "@/components/primitive-styles";
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
              "rounded-full px-2 py-[3px] text-[10px] font-bold text-brand dark:text-brand-ink-dark",
              parsed.contextIsNew
                ? "border border-dashed border-brand dark:border-brand-ink-dark"
                : "bg-brand-soft dark:bg-brand-pill-dark",
            )}
          >
            @{bare(contextLabel, "@")}
            {parsed.contextIsNew && ` · ${t("quickadd.new")}`}
          </span>
        )}
        {projectLabel && (
          <span
            className={cn(
              "rounded-full px-2 py-[3px] text-[10px] font-bold text-done-text dark:text-done-dark",
              parsed.projectIsNew
                ? "border border-dashed border-done dark:border-done-dark"
                : "bg-done-soft dark:bg-done-fill-dark",
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

/** Edit dialog for an existing recurrence: its description and schedule. The
 *  context/project stay as they are — the server patches only what is sent. */
function RecurringEditDialog({
  pattern,
  onOpenChange,
}: {
  pattern: RecurringTodo | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const update = useUpdateRecurring();
  const [description, setDescription] = useState("");
  const [period, setPeriod] = useState<RecurrencePeriod>("weekly");
  const [everyN, setEveryN] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [monthOfYear, setMonthOfYear] = useState(1);
  const [showFromDays, setShowFromDays] = useState(0);
  const [error, setError] = useState("");
  const [loadedId, setLoadedId] = useState<number | null>(null);

  // Prefill from the pattern when the dialog opens for a new one.
  if (pattern && pattern.id !== loadedId) {
    setLoadedId(pattern.id);
    setDescription(pattern.description);
    setPeriod(pattern.period);
    setEveryN(pattern.everyN);
    setWeekdays(pattern.weekdays ? pattern.weekdays.split(",").map(Number) : []);
    setDayOfMonth(pattern.dayOfMonth || 1);
    setMonthOfYear(pattern.monthOfYear || 1);
    setShowFromDays(pattern.showFromDays);
    setError("");
  }

  function toggleWeekday(d: number) {
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  }

  function save() {
    if (!pattern) return;
    if (!description.trim()) {
      setError(t("recurring.errorCreate"));
      return;
    }
    update.mutate(
      {
        id: pattern.id,
        description: description.trim(),
        period,
        everyN,
        weekdays: period === "weekly" ? weekdays.join(",") : undefined,
        dayOfMonth: period === "monthly" || period === "yearly" ? dayOfMonth : undefined,
        monthOfYear: period === "yearly" ? monthOfYear : undefined,
        showFromDays,
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) => setError(apiMessage(err, t("recurring.errorCreate"))),
      },
    );
  }

  return (
    <Dialog open={pattern !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("recurring.editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="text-xs text-muted-foreground">
            {t("recurring.description")}
            <Input
              autoFocus
              className="mt-1"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

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

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={save} disabled={update.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RecurringPage() {
  const t = useT();
  const { user } = useAuth();
  const fmt = useDateFmt();
  const tn = useTn();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RecurringTodo | null>(null);
  const { data: patterns, isLoading } = useRecurring();
  const { data: contexts } = useContexts();
  const { data: projects } = useProjects("active");
  const update = useUpdateRecurring();
  const del = useDeleteRecurring();
  const { pendingKey, schedule } = useUndo();
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  // A pattern pending deletion leaves the list at once; the toast's Undo puts it
  // back, and only the toast expiring makes the delete real.
  const visible = (patterns ?? []).filter(
    (p) => p.description.toLowerCase().includes(needle) && pendingKey !== `recurring:${p.id}`,
  );

  return (
    <Screen
      header={<HeaderBlock title={t("nav.recurring")} avatar={initials(user?.email)} />}
      fab={<Fab label={t("recurring.addTitle")} onClick={() => setAdding(true)} />}
    >
      <div className="mt-3.5 hidden md:block">
        <RecurringAddForm contexts={contexts ?? []} projects={projects ?? []} onAdded={() => {}} />
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-4 md:mt-4">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("recurring.searchPlaceholder")}
          ariaLabel={t("recurring.searchAria")}
          className="w-full min-w-[180px] sm:w-auto sm:max-w-[300px] sm:flex-1"
        />
      </div>

      {isLoading ? (
        <SkeletonList />
      ) : patterns?.length === 0 ? (
        <EmptyState message={t("recurring.none")} />
      ) : visible.length === 0 ? (
        <EmptyState message={t("recurring.noMatch")} />
      ) : (
      <ul className="flex flex-col gap-[9px]">
        {visible.map((p) => (
          <li
            key={p.id}
            className="group relative flex items-start gap-2.5 rounded-card bg-card p-3 shadow-card dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none"
          >
              <Repeat className="mt-0.5 size-4 shrink-0 text-ink-4" />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-semibold text-ink dark:text-ink-dark",
                    p.state === "completed" && "text-ink-4 line-through dark:text-ink-4-dark",
                  )}
                >
                  {p.description}
                </p>
                <p className="text-xs font-medium text-ink-3 dark:text-ink-4-dark">
                  {describe(t, tn, p)}
                  {p.lastSpawnedAt && (
                    <>
                      {" · "}
                      <span className="mono">{t("recurring.last", { date: fmt.date(p.lastSpawnedAt) })}</span>
                    </>
                  )}
                </p>
              </div>
              <div className={rowActions}>
                <IconButton
                  variant="ghost"
                  className="size-7"
                  label={t("recurring.editLabel")}
                  onClick={() => setEditing(p)}
                >
                  <Pencil className="size-3.5" />
                </IconButton>
                <IconButton
                  variant="ghost"
                  className="size-7"
                  label={p.state === "completed" ? t("recurring.resume") : t("recurring.pause")}
                  onClick={() =>
                    update.mutate({ id: p.id, state: p.state === "completed" ? "active" : "completed" })
                  }
                >
                  {p.state === "completed" ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                </IconButton>
                <IconButton
                  variant="ghost"
                  className="size-7"
                  label={t("recurring.deleteLabel", { description: p.description })}
                  onClick={() =>
                    schedule(`recurring:${p.id}`, t("recurring.deleted"), () => del.mutate(p.id))
                  }
                >
                  <Trash2 className="size-3.5 text-danger" />
                </IconButton>
              </div>
          </li>
        ))}
      </ul>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title={t("recurring.addTitle")}>
        <RecurringAddForm
          contexts={contexts ?? []}
          projects={projects ?? []}
          onAdded={() => setAdding(false)}
        />
      </Sheet>

      <RecurringEditDialog pattern={editing} onOpenChange={(open) => !open && setEditing(null)} />
    </Screen>
  );
}
