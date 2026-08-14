import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { ActionInput } from "@/components/ActionInput";
import { DatePickerField } from "@/components/DatePickerField";
import { ContextProjectFields, IdentityPills } from "@/components/IdentityFields";
import { fieldLabel } from "@/components/primitive-styles";
import { Button, Input } from "@/components/primitives";
import { IconButton } from "@/components/IconButton";
import { useCreateRecurring, useUpdateRecurring, type RecurringInput } from "@/hooks/useRecurring";
import { useFocusFirstField } from "@/hooks/useFocusFirstField";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useIdentity } from "@/hooks/useIdentity";
import { useTags } from "@/hooks/useProjects";
import { apiMessage } from "@/lib/api";
import { lastUsed } from "@/lib/lastUsed";
import { useT } from "@/lib/i18n";
import { weekdayShort } from "@/lib/recurrence";
import { ALL_SIGILS } from "@/lib/composer";
import type { Context, Project, RecurrencePeriod, RecurringTodo } from "@/lib/types";

const WEEKDAY_INDEXES = [0, 1, 2, 3, 4, 5, 6];

/** YYYY-MM-DD from whatever the server sent, or "" when there is no date. */
function dayValue(value: string | undefined): string {
  return value ? value.slice(0, 10) : "";
}

/**
 * One form for adding a recurring pattern and for editing one.
 *
 * They used to be two — an add bar with the composer and a centred edit dialog
 * with a plain text field — and the edit half had fallen behind: it could not
 * change the context or the project at all, and its schedule controls were a
 * second copy of the same eighty lines. Parity is now structural rather than
 * something to keep an eye on: there is no second form to fall behind.
 *
 * The identity half (description, context, project) is shared with the action
 * form. The bottom half is not, and should not be: an action has two dates, a
 * pattern has a repeating rule, a window and a lead time from which it derives
 * those dates when it spawns an action.
 *
 * Like the action editor, editing writes nothing until Save and dismissal
 * discards; unlike it, editing keeps a description field, because a pattern's
 * row has no in-place title editing to defer to.
 */
export function RecurringForm({
  pattern,
  contexts,
  projects,
  onDone,
}: {
  /** The pattern being edited. Omitted to create a new one. */
  pattern?: RecurringTodo;
  contexts: Context[];
  projects: Project[];
  /** Creating: after it is added. Editing: after Save, or on dismissal. */
  onDone?: () => void;
}) {
  const t = useT();
  const fields = useRef<HTMLDivElement>(null);
  const create = useCreateRecurring();
  const update = useUpdateRecurring();
  const editing = pattern !== undefined;

  const [text, setText] = useState(pattern?.description ?? "");
  const [pickedContext, setPickedContext] = useState<number | undefined>(pattern?.contextId);
  const [pickedProject, setPickedProject] = useState<number | null | undefined>(
    editing ? pattern.projectId ?? null : undefined,
  );
  // Named in a picker rather than chosen from it: held as a name, because the
  // server is what creates it when this is saved.
  const [newContext, setNewContext] = useState<string>();
  const [newProject, setNewProject] = useState<string>();
  const [period, setPeriod] = useState<RecurrencePeriod>(pattern?.period ?? "weekly");
  const [everyN, setEveryN] = useState(pattern?.everyN ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(
    pattern?.weekdays ? pattern.weekdays.split(",").map(Number) : [1],
  );
  const [dayOfMonth, setDayOfMonth] = useState(pattern?.dayOfMonth || 1);
  const [monthOfYear, setMonthOfYear] = useState(pattern?.monthOfYear || 1);
  const [showFromDays, setShowFromDays] = useState(pattern?.showFromDays ?? 0);
  const [tags, setTags] = useState(pattern ? pattern.tags.join(", ") : "");
  const [startFrom, setStartFrom] = useState(dayValue(pattern?.startFrom));
  const [endDate, setEndDate] = useState(dayValue(pattern?.endDate));
  const [error, setError] = useState("");

  const { data: knownTags } = useTags();
  const knownTagList = useMemo(() => knownTags ?? [], [knownTags]);
  const activeContexts = useMemo(() => contexts.filter((c) => c.state === "active"), [contexts]);
  // Editing reads the stored description literally: re-parsing it would give
  // "review #7741 quarterly" a project the first time anybody touched it.
  const identity = useIdentity({
    text,
    contexts: activeContexts,
    projects,
    knownTags: knownTagList,
    sigils: editing ? [] : ALL_SIGILS,
    pickedContext,
    pickedProject,
    pickedContextName: newContext,
    pickedProjectName: newProject,
  });
  const { parsed, effectiveContextId, effectiveProjectId } = identity;

  // Tags typed as "!tag" plus any from the field, de-duplicated — the same
  // rule the action form uses, so a tag means the same thing in both.
  const allTags = useMemo(
    () =>
      Array.from(
        new Set(
          [...parsed.tags, ...tags.split(",").map((s) => s.trim())]
            .filter(Boolean)
            .map((s) => s.toLowerCase()),
        ),
      ),
    [parsed.tags, tags],
  );

  function toggleWeekday(d: number) {
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  }

  /** The schedule half, identical whichever way the form is being used. */
  function schedule(): RecurringInput {
    return {
      period,
      everyN,
      weekdays: period === "weekly" ? weekdays.join(",") : undefined,
      dayOfMonth: period === "monthly" || period === "yearly" ? dayOfMonth : undefined,
      monthOfYear: period === "yearly" ? monthOfYear : undefined,
      showFromDays,
      tags: allTags,
      // "" clears either end of the window, which is the same convention the
      // action dates use; undefined would leave it alone.
      startFrom: editing ? startFrom : startFrom || undefined,
      endDate: editing ? endDate : endDate || undefined,
    };
  }

  function submit() {
    const description = parsed.description.trim();
    if (!description) return;
    if (!effectiveContextId && !identity.newContextName) {
      setError(t("recurring.errorContext"));
      return;
    }
    // The window has to be a window. The server refuses this too — a rule that
    // can never occur is not worth storing — but showing it here means the
    // dates never snap back after a round-trip.
    if (startFrom && endDate && endDate < startFrom) {
      setError(t("recurring.errorWindow"));
      return;
    }
    setError("");

    if (editing) {
      update.mutate(
        {
          id: pattern.id,
          description,
          contextId: effectiveContextId,
          projectId: effectiveProjectId ?? undefined,
          // Naming one while editing works exactly as it does while adding:
          // the server creates it and files the pattern under it in the same
          // request. Editing only ever sent ids before, so a name chosen in
          // the picker was quietly dropped.
          contextName: identity.newContextName,
          projectName: identity.newProjectName,
          // A nil projectId means "leave unchanged" on the wire, so detaching
          // needs saying out loud. A project named but not yet made reads as
          // null too, and the server drops the name when this is set — so it
          // is only a detach when there is no name waiting to be created.
          clearProject: effectiveProjectId === null && !identity.newProjectName,
          ...schedule(),
        },
        {
          onSuccess: () => onDone?.(),
          onError: (err) => setError(apiMessage(err, t("recurring.errorCreate"))),
        },
      );
      return;
    }

    create.mutate(
      {
        contextId: effectiveContextId,
        projectId: effectiveProjectId ?? undefined,
        contextName: identity.newContextName,
        projectName: identity.newProjectName,
        description,
        ...schedule(),
      },
      {
        onSuccess: (created) => {
          lastUsed.remember(created.contextId);
          setText("");
          setTags("");
          setPickedProject(undefined);
          onDone?.();
        },
        onError: (err) => setError(apiMessage(err, t("recurring.errorCreate"))),
      },
    );
  }

  const isDesktop = useIsDesktop();
  useFocusFirstField(fields, editing && isDesktop);

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    // Editing remains explicit-save only. The form element exists so iOS sees
    // one stable previous/next field group, not to add another dismissal path.
    if (!editing) submit();
  }

  function onPanelKeyDown(e: KeyboardEvent<HTMLElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && editing) {
      e.preventDefault();
      onDone?.();
    }
  }

  return (
    <form className="space-y-3" onSubmit={onFormSubmit} onKeyDown={onPanelKeyDown}>
      <ActionInput
        value={text}
        onChange={setText}
        onSubmit={submit}
        contexts={activeContexts}
        projects={projects}
        tags={[]}
        sigils={editing ? [] : ["@", "#"]}
        placeholder={t("recurring.placeholder")}
      />

      {/* Where the actions it spawns will land. */}
      {!editing && <IdentityPills identity={identity} tags={allTags} />}

      <div className="grid gap-3" ref={fields}>
        <ContextProjectFields
          identity={identity}
          contexts={activeContexts}
          projects={projects}
          // Choosing one that exists and naming a new one are the same
          // decision, so each clears the other.
          onContextChange={(id) => {
            setPickedContext(id);
            setNewContext(undefined);
          }}
          onProjectChange={(id) => {
            setPickedProject(id);
            setNewProject(undefined);
          }}
          onContextCreate={(name) => {
            setNewContext(name);
            setPickedContext(undefined);
          }}
          onProjectCreate={(name) => {
            setNewProject(name);
            setPickedProject(undefined);
          }}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={fieldLabel}>
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

          <label className={fieldLabel}>
            {t("recurring.every")}
            <Input
              type="number"
              min={1}
              className="mt-1"
              value={everyN}
              onChange={(e) => setEveryN(Math.max(1, Number(e.target.value)))}
            />
          </label>

          <label className={fieldLabel}>
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
                variant={weekdays.includes(i) ? "primary" : "ghost"}
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
              <label className={fieldLabel}>
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
            <label className={fieldLabel}>
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

        <label className={fieldLabel}>
          {t("quickadd.tags")}
          <Input
            className="mt-1"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={t("quickadd.tagsPlaceholder")}
          />
        </label>

        {/* The window the pattern runs in. The server has always stored both;
            nothing rendered them, so a pattern could not be given an end.
            Last in the form, and it stays last: iOS moves between fields with
            the arrows above its keyboard, and landing on a date input opens
            the wheel. There is no ordinary text field after these that the
            user has to pass through a wheel to reach. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-end gap-2">
            <label className={`min-w-0 flex-1 ${fieldLabel}`}>
              {t("recurring.startFrom")}
              <DatePickerField
                className="mt-1"
                value={startFrom}
                label={t("recurring.startFrom")}
                onChange={setStartFrom}
              />
            </label>
            {startFrom && (
              <IconButton
                className="mb-0.5 size-8 shrink-0"
                label={t("recurring.clearStartFrom")}
                onClick={() => setStartFrom("")}
              >
                <X className="size-3.5 text-ink-4" />
              </IconButton>
            )}
          </div>
          <div className="flex items-end gap-2">
            <label className={`min-w-0 flex-1 ${fieldLabel}`}>
              {t("recurring.endDate")}
              <DatePickerField
                className="mt-1"
                // Deliberately no `min`: constraint validation blocks the add
                // form's submit before any of this component's code runs, and
                // native constraint handling would refuse an inverted window
                // differently from the explicit, translated check below.
                value={endDate}
                label={t("recurring.endDate")}
                onChange={setEndDate}
              />
            </label>
            {endDate && (
              <IconButton
                className="mb-0.5 size-8 shrink-0"
                label={t("recurring.clearEndDate")}
                onClick={() => setEndDate("")}
              >
                <X className="size-3.5 text-ink-4" />
              </IconButton>
            )}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center">
        <Button
          type={editing ? "button" : "submit"}
          onClick={editing ? submit : undefined}
          className="ml-auto"
          disabled={create.isPending || update.isPending}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          title={t("common.saveShortcut")}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
