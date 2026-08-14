import { X } from "lucide-react";
import { DatePickerField } from "@/components/DatePickerField";
import { IconButton } from "@/components/IconButton";
import {
  DUE_PRESETS,
  SHOW_FROM_PRESETS,
  addDays,
  clampShowFrom,
  shiftShowFrom,
  today,
} from "@/lib/actionDates";
import { usePreferences } from "@/hooks/useSettings";
import { useDateFmt } from "@/lib/datefmt";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface ActionDates {
  /** YYYY-MM-DD, or "" for no date. */
  due: string;
  showFrom: string;
}

/** A quick-set pill. Small and dense: several sit on one line on a phone. */
function Preset({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
        disabled
          ? "cursor-not-allowed border-line text-ink-4 dark:border-line-dark dark:text-ink-4-dark"
          : "border-line bg-card text-ink-2 hover:border-brand hover:text-brand dark:border-line-2-dark dark:bg-card-dark dark:text-ink-2-dark dark:hover:text-brand-ink-dark",
      )}
    >
      {label}
    </button>
  );
}

/**
 * The Due and Show from pair, with their quick-sets — used by the action
 * editor, the quick-defer sheet and the composer, so the two dates behave
 * identically wherever they are edited.
 *
 * Due's quick-sets are absolute, counted from today. Show from's are relative
 * to Due ("a week before"), which is why they need a due date to exist and are
 * disabled without one: anchoring them to today instead would quietly turn
 * "1 week before" into "in 1 week".
 *
 * Two rules are enforced here rather than left to the server, so the fields
 * show what will be stored instead of snapping to it after a round-trip:
 * moving Due carries Show from with it, keeping the gap; and Show from is
 * never later than Due.
 */
export function DateFields({
  value,
  onChange,
  idPrefix,
}: {
  value: ActionDates;
  onChange: (next: ActionDates) => void;
  /** Distinguishes the inputs when more than one set is on the page. */
  idPrefix: string;
}) {
  const t = useT();
  const fmt = useDateFmt();
  const { data: prefs } = usePreferences();
  // The user's lead time: how many days before its due date an action first
  // appears. Zero — the default — means it appears on the due date itself.
  const leadDays = prefs?.showFromDays ?? 0;
  function setDue(due: string) {
    // Clearing the due date clears the show-from with it. The show-from was
    // derived from the due date or moved along with it, so leaving it behind
    // parks the action in the tickler with nothing on screen explaining why —
    // and it survived, whatever the documentation claimed. An action can still
    // be parked on its own: set a show-from without a due date.
    if (!due) {
      onChange({ due: "", showFrom: "" });
      return;
    }
    // An action with a due date always has a show-from. If it has none yet, the
    // server would derive one from the user's lead time on save — so derive the
    // same date here and show it, rather than filling the field in behind the
    // user's back after the round-trip. If it already has one, that one travels
    // with the due date instead and is never recomputed.
    const moved = value.showFrom
      ? shiftShowFrom(value.due, due, value.showFrom)
      : addDays(due, -leadDays);
    onChange({ due, showFrom: clampShowFrom(due, moved || "") });
  }

  function setShowFrom(showFrom: string) {
    onChange({ due: value.due, showFrom: clampShowFrom(value.due, showFrom) });
  }

  const dueId = `${idPrefix}-due`;
  const showFromId = `${idPrefix}-show-from`;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-end gap-2">
          {/* min-w-0 keeps the field inside the row beside its clear button. */}
          <label
            htmlFor={dueId}
            className="min-w-0 flex-1 text-xs font-bold text-ink-2 dark:text-ink-2-dark"
          >
            {t("dates.due")}
            <DatePickerField
              id={dueId}
              className="mt-1"
              value={value.due}
              label={t("dates.due")}
              onChange={setDue}
            />
          </label>
          {value.due && (
            <IconButton
              className="mb-0.5 size-8 shrink-0"
              label={t("dates.clearDue")}
              onClick={() => setDue("")}
            >
              <X className="size-3.5 text-ink-4" />
            </IconButton>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {DUE_PRESETS.map((p) => (
            <Preset
              key={p.key}
              label={t(`dates.${p.key}`)}
              onClick={() => setDue(addDays(today(fmt.dayKey), p.days))}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-end gap-2">
          <label
            htmlFor={showFromId}
            className="min-w-0 flex-1 text-xs font-bold text-ink-2 dark:text-ink-2-dark"
          >
            {t("dates.showFrom")}
            <DatePickerField
              id={showFromId}
              className="mt-1"
              max={value.due || undefined}
              // A show-from is how long before its deadline an action appears,
              // so there has to be a deadline for it to be before. Without one
              // it is disabled, like its quick-sets already were — but only for
              // setting: a value stored before this rule existed can still be
              // cleared with the button beside it, or an action would be stuck
              // in the tickler with no way out of it from here.
              disabled={!value.due}
              value={value.showFrom}
              label={t("dates.showFrom")}
              onChange={setShowFrom}
            />
          </label>
          {value.showFrom && (
            <IconButton
              className="mb-0.5 size-8 shrink-0"
              label={t("dates.clearShowFrom")}
              onClick={() => setShowFrom("")}
            >
              <X className="size-3.5 text-ink-4" />
            </IconButton>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {SHOW_FROM_PRESETS.map((p) => (
            <Preset
              key={p.key}
              label={t(`dates.${p.key}`)}
              disabled={!value.due}
              onClick={() => setShowFrom(addDays(value.due, -p.days))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
