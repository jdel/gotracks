import { useState } from "react";
import { Star, Trash2 } from "lucide-react";
import { DateFields, type ActionDates } from "@/components/DateFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useContexts } from "@/hooks/useContexts";
import { useProjects } from "@/hooks/useProjects";
import { useUpdateTodo } from "@/hooks/useTodos";
import { bare } from "@/lib/composer";
import { changedDates, dayValue } from "@/lib/actionDates";
import { useDateFmt } from "@/lib/datefmt";
import { useT } from "@/lib/i18n";
import type { Todo } from "@/lib/types";
import { cn } from "@/lib/utils";

const fieldLabel = "text-xs font-bold text-ink-2 dark:text-ink-2-dark";
const selectClass =
  "mt-1 w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink dark:border-line-2-dark dark:bg-card-dark dark:text-ink-dark";

/**
 * Everything about one action, editable.
 *
 * The same component on both platforms: expanded inside the card on the web,
 * full screen from a long press on a phone. It is also what the tickler shows,
 * so an action is edited identically wherever it is met — there are no
 * tickler-specific controls and no separate "defer" operation, only the two
 * dates.
 *
 * Each field saves on its own rather than behind a Save button: the row
 * underneath is live, and a half-applied edit that is lost by tapping away is
 * worse than one that lands as you go.
 */
export function ActionEditor({
  todo,
  onClose,
  onDelete,
}: {
  todo: Todo;
  onClose: () => void;
  /** Deleting is the caller's business — it owns the undo toast and the row. */
  onDelete: () => void;
}) {
  const t = useT();
  const fmt = useDateFmt();
  const update = useUpdateTodo();
  const { data: contexts } = useContexts();
  const { data: projects } = useProjects();

  const [description, setDescription] = useState(todo.description);
  const [notes, setNotes] = useState(todo.notes);
  const [tags, setTags] = useState(todo.tags.join(", "));
  const [dates, setDates] = useState<ActionDates>({
    due: dayValue(todo.due, fmt.dayKey),
    showFrom: dayValue(todo.showFrom, fmt.dayKey),
  });

  function saveDates(next: ActionDates) {
    setDates(next);
    update.mutate({ id: todo.id, ...changedDates(dates, next) });
  }

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-line-3 pt-3 dark:border-line-dark">
      <label className={fieldLabel}>
        {t("todo.actionDescription")}
        <Input
          className="mt-1"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            const trimmed = description.trim();
            // Plain text: "@" and "#" are the composer's business, and
            // re-parsing here would turn "invoice #7741" into a project.
            if (trimmed && trimmed !== todo.description) {
              update.mutate({ id: todo.id, description: trimmed });
            } else if (!trimmed) {
              setDescription(todo.description);
            }
          }}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className={fieldLabel}>
          {t("todo.context")}
          <select
            className={selectClass}
            value={todo.contextId}
            onChange={(e) => update.mutate({ id: todo.id, contextId: Number(e.target.value) })}
          >
            {contexts?.map((c) => (
              <option key={c.id} value={c.id}>
                {bare(c.name, "@")}
              </option>
            ))}
          </select>
        </label>

        <label className={fieldLabel}>
          {t("todo.project")}
          <select
            className={selectClass}
            value={todo.projectId ?? ""}
            onChange={(e) =>
              update.mutate({
                id: todo.id,
                projectId: e.target.value ? Number(e.target.value) : null,
              })
            }
          >
            <option value="">{t("todo.noProject")}</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {bare(p.name, "#")}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DateFields value={dates} onChange={saveDates} idPrefix={`todo-${todo.id}`} />

      <label className={fieldLabel}>
        {t("quickadd.tags")}
        <Input
          className="mt-1"
          value={tags}
          placeholder={t("quickadd.tagsPlaceholder")}
          onChange={(e) => setTags(e.target.value)}
          onBlur={() => {
            const next = tags
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            if (next.join(",") !== todo.tags.join(",")) {
              update.mutate({ id: todo.id, tags: next });
            }
          }}
        />
      </label>

      <label className={fieldLabel}>
        {t("todo.notes")}
        <textarea
          rows={3}
          className={cn(selectClass, "resize-y")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== todo.notes) update.mutate({ id: todo.id, notes });
          }}
        />
      </label>

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => update.mutate({ id: todo.id, starred: !todo.starred })}
        >
          <Star className={cn("size-3.5", todo.starred && "fill-done text-done")} />
          {todo.starred ? t("todo.removeStar") : t("todo.star")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-danger"
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          <Trash2 className="size-3.5" />
          {t("todo.delete")}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}
