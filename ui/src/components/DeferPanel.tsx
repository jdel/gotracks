import { useId, useRef, useState } from "react";
import { DateFields, type ActionDates } from "@/components/DateFields";
import { Button } from "@/components/primitives";
import { useUpdateTodo } from "@/hooks/useTodos";
import { changedDates, dayValue } from "@/lib/actionDates";
import { useDateFmt } from "@/lib/datefmt";
import { useT } from "@/lib/i18n";
import { useFocusFirstField } from "@/hooks/useFocusFirstField";
import type { Todo } from "@/lib/types";

/**
 * The two dates on their own, one gesture away — a swipe on a phone, a button
 * on a web row.
 *
 * It has no rules of its own: the same fields as the editor, writing through
 * the same request. "Deferring" an action that is already overdue is pushing
 * its due date, which carries the show-from along and drops the action back
 * into the tickler; nothing here special-cases that.
 *
 * Like the editor, nothing is written until Save — picking a due date is
 * usually half a thought whose other half is the show-from — and dismissing
 * the panel discards the edit.
 */
export function DeferPanel({ todo, onSaved }: { todo: Todo; onSaved: () => void }) {
  const t = useT();
  const fmt = useDateFmt();
  const update = useUpdateTodo();
  const uid = useId();
  const fields = useRef<HTMLDivElement>(null);
  const stored: ActionDates = {
    due: dayValue(todo.due, fmt.dayKey),
    showFrom: dayValue(todo.showFrom, fmt.dayKey),
  };
  const [dates, setDates] = useState<ActionDates>(stored);
  const changed = changedDates(stored, dates);
  const dirty = Object.keys(changed).length > 0;

  useFocusFirstField(fields);

  function save() {
    if (!dirty) return;
    update.mutate({ id: todo.id, ...changed });
    onSaved();
  }

  return (
    <div
      ref={fields}
      // Same keys as the editor: Ctrl/Cmd+Enter saves, Escape leaves.
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onSaved();
        }
      }}
    >
      <DateFields value={dates} onChange={setDates} idPrefix={uid} />
      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={!dirty}
          onClick={save}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          title={t("common.saveShortcut")}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
