import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { ActionInput } from "@/components/ActionInput";
import { ContextProjectFields, IdentityPills } from "@/components/IdentityFields";
import { fieldLabel } from "@/components/primitive-styles";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { useCreateRecurring, useUpdateRecurring, type RecurringInput } from "@/hooks/useRecurring";
import { useFocusFirstField } from "@/hooks/useFocusFirstField";
import { useIdentity } from "@/hooks/useIdentity";
import { apiMessage } from "@/lib/api";
import { lastUsed } from "@/lib/lastUsed";
import { useT } from "@/lib/i18n";
import { weekdayShort } from "@/lib/recurrence";
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
  const [period, setPeriod] = useState<RecurrencePeriod>(pattern?.period ?? "weekly");
  const [everyN, setEveryN] = useState(pattern?.everyN ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(
    pattern?.weekdays ? pattern.weekdays.split(",").map(Number) : [1],
  );
  const [dayOfMonth, setDayOfMonth] = useState(pattern?.dayOfMonth || 1);
  const [monthOfYear, setMonthOfYear] = useState(pattern?.monthOfYear || 1);
  const [showFromDays, setShowFromDays] = useState(pattern?.showFromDays ?? 0);
  const [startFrom, setStartFrom] = useState(dayValue(pattern?.startFrom));
  const [endDate, setEndDate] = useState(dayValue(pattern?.endDate));
  const [error, setError] = useState("");

  const activeContexts = useMemo(() => contexts.filter((c) => c.state === "active"), [contexts]);
  // Editing reads the stored description literally: re-parsing it would give
  // "review #7741 quarterly" a project the first time anybody touched it.
  const identity = useIdentity({
    text,
    contexts: activeContexts,
    projects,
    sigils: editing ? [] : ["@", "#"],
    pickedContext,
    pickedProject,
  });
  const { parsed, effectiveContextId, effectiveProjectId } = identity;

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
      startFrom: startFrom || undefined,
      // "" clears the end date, which is the same convention the action dates
      // use; undefined would leave it alone.
      endDate: editing ? endDate : endDate || undefined,
    };
  }

  function submit() {
    const description = parsed.description.trim();
    if (!description) return;
    if (!effectiveContextId && !parsed.contextIsNew) {
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
          // A nil projectId means "leave unchanged" on the wire, so detaching
          // needs saying out loud.
          clearProject: effectiveProjectId === null,
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
        contextName: parsed.contextIsNew ? parsed.contextName : undefined,
        projectName: parsed.projectIsNew ? parsed.projectName : undefined,
        description,
        ...schedule(),
      },
      {
        onSuccess: (created) => {
          lastUsed.remember(created.contextId);
          setText("");
          setPickedProject(undefined);
          onDone?.();
        },
        onError: (err) => setError(apiMessage(err, t("recurring.errorCreate"))),
      },
    );
  }

  useFocusFirstField(fields, editing);

  // Same contract as the action form: adding is a real form, so Enter in the
  // description captures the pattern; editing is not, so no stray submit can
  // dismiss the panel under the user's hands. Ctrl/Cmd+Enter saves from
  // anywhere, Escape leaves an edit without saving.
  const Shell = editing ? "div" : "form";
  const shellProps = editing
    ? {}
    : {
        onSubmit: (e: FormEvent) => {
          e.preventDefault();
          submit();
        },
      };

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
    <Shell {...shellProps} className="space-y-3" onKeyDown={onPanelKeyDown}>
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
      {!editing && <IdentityPills identity={identity} />}

      <div className="grid gap-3" ref={fields}>
        <ContextProjectFields
          identity={identity}
          contexts={activeContexts}
          projects={projects}
          onContextChange={setPickedContext}
          onProjectChange={setPickedProject}
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

        {/* The window the pattern runs in. The server has always stored both;
            nothing rendered them, so a pattern could not be given an end. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={fieldLabel}>
            {t("recurring.startFrom")}
            <Input
              type="date"
              className="mt-1"
              value={startFrom}
              onChange={(e) => setStartFrom(e.target.value)}
            />
          </label>
          <div className="flex items-end gap-2">
            <label className={`flex-1 ${fieldLabel}`}>
              {t("recurring.endDate")}
              <Input
                type="date"
                className="mt-1"
                // Deliberately no `min`: constraint validation blocks the add
                // form's submit before any of this component's code runs, and
                // the editor is not a form, so the two halves would refuse an
                // inverted window in two different ways — one with a browser
                // bubble in the browser's language, one with the message below.
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
            {endDate && (
              <IconButton
                variant="ghost"
                className="mb-0.5 size-8"
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
          title={t("common.saveShortcut")}
        >
          {t("common.save")}
        </Button>
      </div>
    </Shell>
  );
}
