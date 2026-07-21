import { useState } from "react";
import {
  Check,
  Star,
  Trash2,
  RotateCcw,
  CalendarClock,
  Repeat,
  Paperclip,
  GripVertical,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AttachmentPanel } from "@/components/AttachmentPanel";
import { useContexts } from "@/hooks/useContexts";
import { useProjects } from "@/hooks/useProjects";
import { useAllAttachments, usePreferences } from "@/hooks/useSettings";
import { bare } from "@/lib/composer";
import { api } from "@/lib/api";
import type { Attachment, Todo } from "@/lib/types";
import {
  useCompleteTodo,
  useDeleteTodo,
  useReactivateTodo,
  useUpdateTodo,
} from "@/hooks/useTodos";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { useT, useTn } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";

// dueClass colour-codes urgency the way Tracks does:
// red = today/overdue, orange = within a week, green = later.
function dueClass(due: string): string {
  const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "text-destructive";
  if (days <= 7) return "text-orange-500";
  return "text-emerald-600 dark:text-emerald-500";
}

/**
 * Inline editor for an action's description.
 *
 * Plain text, no "@"/"#" parsing: the context and project already have their
 * own controls, and re-tokenising on save would turn a description like
 * "call about invoice #7741" into a project named 7741 and eat the reference.
 * Save/Cancel are buttons as well as keys because the mobile layout is a first
 * class citizen here and a phone keyboard has no Escape.
 */
function DescriptionEditor({
  todo,
  busy,
  onCancel,
  onSave,
}: {
  todo: Todo;
  busy: boolean;
  onCancel: () => void;
  onSave: (description: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState(todo.description);
  const trimmed = text.trim();

  return (
    <div className="space-y-2">
      <Input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && trimmed) onSave(trimmed);
        }}
        aria-label={t("todo.actionDescription")}
        className="h-8"
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={!trimmed || busy} onClick={() => onSave(trimmed)}>
          {t("common.save")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

export interface TodoItemProps {
  todo: Todo;
  showContext?: string;
  /** Drag handle props supplied by the sortable wrapper, when reordering is enabled. */
  dragHandle?: React.HTMLAttributes<HTMLButtonElement>;
}

export function TodoItem({ todo, showContext, dragHandle }: TodoItemProps) {
  const qc = useQueryClient();
  const t = useT();
  const tn = useTn();
  const fmt = useDateFmt();
  const complete = useCompleteTodo();
  const reactivate = useReactivateTodo();
  const del = useDeleteTodo();
  const update = useUpdateTodo();
  const { data: prefs } = usePreferences();
  // Shared across every rendered TodoItem: React Query dedupes it into one
  // request, so this costs nothing extra beyond the first item on the page.
  const { data: allAttachments } = useAllAttachments();
  const hasAttachments = allAttachments?.some((a) => a.todoId === todo.id) ?? false;
  const [showFiles, setShowFiles] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  // Set right after marking an action done, when it had attachments and
  // auto-delete is off — offers to clean them up instead of doing it silently.
  const [attachmentPrompt, setAttachmentPrompt] = useState<Attachment[] | null>(null);
  const [deletingAttachments, setDeletingAttachments] = useState(false);
  const done = todo.state === "completed";

  // Marking done always proceeds; the only question is whether to also ask
  // about attachments. Auto-delete (a user preference) skips the prompt
  // entirely — the server already removed them as part of completing.
  async function handleComplete() {
    let attachments: Attachment[] = [];
    if (!prefs?.autoDeleteAttachments) {
      attachments = await api
        .get<Attachment[]>(`/todos/${todo.id}/attachments`)
        .catch(() => []);
    }
    complete.mutate(todo.id);
    if (attachments.length > 0) {
      setAttachmentPrompt(attachments);
    }
  }

  // Both lists are already cached by React Query, so this costs no extra request.
  const { data: contexts } = useContexts();
  const { data: projects } = useProjects();
  const contextName =
    showContext ?? contexts?.find((c) => c.id === todo.contextId)?.name;
  const projectName = projects?.find((p) => p.id === todo.projectId)?.name;

  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-3">
      {dragHandle && (
        <button
          type="button"
          className="mt-1 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
          title={t("todo.dragToReorder")}
          {...dragHandle}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <IconButton
        variant="outline"
        className={cn("mt-0.5 size-6 shrink-0 rounded-full", done && "bg-primary text-primary-foreground")}
        label={done ? t("todo.reopen") : t("todo.complete")}
        onClick={() => (done ? reactivate.mutate(todo.id) : void handleComplete())}
      >
        {done ? <RotateCcw className="size-3" /> : <Check className="size-3" />}
      </IconButton>

      <div className="min-w-0 flex-1">
        {editing ? (
          <DescriptionEditor
            todo={todo}
            busy={update.isPending}
            onCancel={() => setEditing(false)}
            onSave={(description) => {
              // Text only. The context and project are their own controls, so
              // an "@" or "#" written into a description stays description.
              update.mutate({ id: todo.id, description });
              setEditing(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title={t("todo.edit")}
            className="w-full rounded text-left hover:bg-accent/40"
          >
            <p className={cn("break-words text-sm", done && "text-muted-foreground line-through")}>
              {todo.description}
            </p>
          </button>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {contextName && (
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-700 dark:text-sky-300">
              @{bare(contextName, "@")}
            </span>
          )}
          {projectName && (
            <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-700 dark:text-violet-300">
              #{bare(projectName, "#")}
            </span>
          )}
          {todo.due && (
            <span className={cn("font-medium", dueClass(todo.due))}>{t("todo.due", { date: fmt.day(todo.due) })}</span>
          )}
          {todo.showFrom && todo.state === "deferred" && (
            <span className="flex items-center gap-1">
              <CalendarClock className="size-3" /> {fmt.day(todo.showFrom)}
            </span>
          )}
          {todo.recurringTodoId && (
            <span className="flex items-center gap-1" title={t("todo.recurringAction")}>
              <Repeat className="size-3" />
            </span>
          )}
          {todo.tags.map((tag) => (
            <span key={tag} className="rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 gap-0.5">
        <IconButton
          variant="ghost"
          className="size-8"
          label={
            showFiles
              ? t("todo.hideAttachments")
              : hasAttachments
                ? t("todo.showAttachmentsSome")
                : t("todo.showAttachments")
          }
          onClick={() => setShowFiles((v) => !v)}
        >
          {/* Blue says "this action has files", which stays true while the
              panel is open — so it outranks the open-state tint rather than
              being replaced by it. */}
          <Paperclip
            className={cn(
              "size-4",
              hasAttachments
                ? "text-sky-600 dark:text-sky-400"
                : showFiles && "text-foreground",
            )}
          />
        </IconButton>
        <IconButton
          variant="ghost"
          className="size-8"
          label={todo.starred ? t("todo.removeStar") : t("todo.star")}
          onClick={() => update.mutate({ id: todo.id, starred: !todo.starred })}
        >
          <Star className={cn("size-4", todo.starred && "fill-yellow-400 text-yellow-500")} />
        </IconButton>
        <IconButton
          variant="ghost"
          className="size-8"
          label={t("todo.delete")}
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="size-4 text-destructive" />
        </IconButton>
      </div>
      </div>

      {showFiles && <AttachmentPanel todoId={todo.id} />}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("todo.deleteTitle")}
        description={
          <>
            <strong>{todo.description}</strong> {t("todo.deleteDescBody")}
          </>
        }
        busy={del.isPending}
        onConfirm={() => {
          del.mutate(todo.id);
          setConfirming(false);
        }}
      />

      <ConfirmDialog
        open={attachmentPrompt !== null}
        onOpenChange={(open) => !open && setAttachmentPrompt(null)}
        title={t("todo.attachmentsPromptTitle")}
        description={
          <>
            <strong>{todo.description}</strong> {t("todo.attPromptHad")}{" "}
            {tn(attachmentPrompt?.length ?? 0, "todo.attachmentCount")}.{" "}
            {tn(attachmentPrompt?.length ?? 0, "todo.attPromptAsk")}
          </>
        }
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.keep")}
        busy={deletingAttachments}
        onConfirm={async () => {
          if (attachmentPrompt) {
            setDeletingAttachments(true);
            await Promise.all(attachmentPrompt.map((a) => api.del(`/attachments/${a.id}`)));
            await qc.invalidateQueries({ queryKey: ["attachments"] });
            setDeletingAttachments(false);
          }
          setAttachmentPrompt(null);
        }}
      />
    </li>
  );
}
