import { useState } from "react";
import { DateFields, type ActionDates } from "@/components/DateFields";
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
 * Each change saves immediately but the panel stays open, so the pair can be
 * set in either order — closing on the first tap would put Show from out of
 * reach of anyone who started with Due.
 */
export function DeferPanel({ todo }: { todo: Todo }) {
  const fmt = useDateFmt();
  const update = useUpdateTodo();
  const [dates, setDates] = useState<ActionDates>({
    due: dayValue(todo.due, fmt.dayKey),
    showFrom: dayValue(todo.showFrom, fmt.dayKey),
  });

  return (
    <DateFields
      value={dates}
      onChange={(next) => {
        // Only what moved: an empty string clears a date, so sending both
        // would wipe whichever one the user did not touch.
        update.mutate({ id: todo.id, ...changedDates(dates, next) });
        setDates(next);
      }}
      idPrefix={`defer-${todo.id}`}
    />
  );
}
