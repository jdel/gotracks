import { useState } from "react";
import { type ActionDates } from "@/components/DateFields";
import { DateEditor } from "@/components/DateEditor";
import { useUpdateTodo } from "@/hooks/useTodos";
import { changedDates, dayValue } from "@/lib/actionDates";
import { useDateFmt } from "@/lib/datefmt";
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
 * Changes are collected and go in on Apply, or when focus leaves — picking a
 * due date is usually half a thought whose other half is the show-from, and
 * saving on the first tap would move the action out of the list, taking this
 * panel with it, before the second one happened.
 */
export function DeferPanel({ todo }: { todo: Todo }) {
  const fmt = useDateFmt();
  const update = useUpdateTodo();
  const [dates, setDates] = useState<ActionDates>({
    due: dayValue(todo.due, fmt.dayKey),
    showFrom: dayValue(todo.showFrom, fmt.dayKey),
  });

  return (
    <DateEditor
      value={dates}
      onSave={(next) => {
        // Only what moved: an empty string clears a date, so sending both
        // would wipe whichever one the user did not touch.
        update.mutate({ id: todo.id, ...changedDates(dates, next) });
        setDates(next);
      }}
      idPrefix={`defer-${todo.id}`}
    />
  );
}
