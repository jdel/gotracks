import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import {
  DUE_PRESETS,
  SHOW_FROM_PRESETS,
  addDays,
  clampShowFrom,
  shiftShowFrom,
  today,
} from "@/lib/actionDates";
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
  // What the two inputs are showing while they are being typed into. A date
  // input fires a change per component as it is filled — "2026" then
  // "2026-09" — and the year alone is a complete, wildly wrong date. Committing
  // those would save "2026-01-01" and, worse, could move the action out of the
  // list being looked at before the day had even been picked. So the inputs
  // keep their own value and only commit when they are left.
  const [draft, setDraft] = useState<ActionDates | null>(null);
  const shown = draft ?? value;

  function setDue(due: string) {
    setDraft(null);
    // The show-from travels with the due date, then the clamp has the last word.
    const moved = shiftShowFrom(value.due, due, value.showFrom);
    onChange({ due, showFrom: clampShowFrom(due, moved) });
  }

  function setShowFrom(showFrom: string) {
    setDraft(null);
    onChange({ due: value.due, showFrom: clampShowFrom(value.due, showFrom) });
  }

  const dueId = `${idPrefix}-due`;
  const showFromId = `${idPrefix}-show-from`;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-end gap-2">
          <label htmlFor={dueId} className="flex-1 text-xs font-bold text-ink-2 dark:text-ink-2-dark">
            {t("dates.due")}
            <Input
              id={dueId}
              type="date"
              className="mt-1"
              value={shown.due}
              onChange={(e) => setDraft({ ...shown, due: e.target.value })}
              onBlur={(e) => setDue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setDue((e.target as HTMLInputElement).value);
              }}
            />
          </label>
          {shown.due && (
            <IconButton
              variant="ghost"
              className="mb-0.5 size-8"
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
            className="flex-1 text-xs font-bold text-ink-2 dark:text-ink-2-dark"
          >
            {t("dates.showFrom")}
            <Input
              id={showFromId}
              type="date"
              className="mt-1"
              max={shown.due || undefined}
              value={shown.showFrom}
              onChange={(e) => setDraft({ ...shown, showFrom: e.target.value })}
              onBlur={(e) => setShowFrom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setShowFrom((e.target as HTMLInputElement).value);
              }}
            />
          </label>
          {shown.showFrom && (
            <IconButton
              variant="ghost"
              className="mb-0.5 size-8"
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
              disabled={!shown.due}
              onClick={() => setShowFrom(addDays(shown.due, -p.days))}
            />
          ))}
          {!shown.due && (
            <span className="text-xs font-medium text-ink-4 dark:text-ink-4-dark">
              {t("dates.needsDue")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
