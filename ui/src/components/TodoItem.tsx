import { useRef, useState } from "react";
import {
  Check,
  Star,
  Trash2,
  CalendarClock,
  Pencil,
  Repeat,
  Paperclip,
  GripVertical,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AttachmentPanel } from "@/components/AttachmentPanel";
import { ActionEditor } from "@/components/ActionEditor";
import { DeferPanel } from "@/components/DeferPanel";
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
import { Chip, DueChip, Sheet } from "@/components/primitives";
import { rowActions, inlineEdit } from "@/components/primitive-styles";
import { SwipeRow } from "@/components/SwipeRow";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useUndo } from "@/lib/undo";
import { LEAVE_MS, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useT, useTn } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";

// An action is overdue once its due date falls before today — asked in the
// account's time zone, not the browser's, so the red chip does not depend on
// where the machine happens to be. dayKey is a sortable YYYY-MM-DD, so the
// string comparison is a day comparison.
function isOverdue(due: string, dayKey: (iso: string) => string): boolean {
  return dayKey(due) < dayKey(new Date().toISOString());
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
  onCancel,
  onSave,
}: {
  todo: Todo;
  onCancel: () => void;
  onSave: (description: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState(todo.description);
  // Enter or clicking away commits; Escape abandons. No buttons. The ref makes
  // the edit finish exactly once, so the blur that follows an Enter/Escape does
  // not fire a second time (and Escape's blur never saves the discarded text).
  const finished = useRef(false);

  function finish(save: boolean) {
    if (finished.current) return;
    finished.current = true;
    const trimmed = text.trim();
    if (save && trimmed && trimmed !== todo.description) onSave(trimmed);
    else onCancel();
  }

  return (
    <Input
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") finish(false);
        if (e.key === "Enter") finish(true);
      }}
      onBlur={() => finish(true)}
      aria-label={t("todo.actionDescription")}
      className={cn(inlineEdit, "text-sm leading-[1.3] font-semibold text-ink dark:text-ink-dark")}
    />
  );
}

export interface TodoItemProps {
  todo: Todo;
  showContext?: string;
  /** Suppress the @context chip — used in the context-grouped view where the
   *  group header already names the context, so repeating it is noise. */
  hideContext?: boolean;
  /** True while this row is lifted during a drag — rotates + elevates it. */
  lifted?: boolean;
  /** Drag handle props supplied by the sortable wrapper, when reordering is enabled. */
  dragHandle?: React.HTMLAttributes<HTMLButtonElement>;
}

export function TodoItem({ todo, showContext, hideContext, lifted, dragHandle }: TodoItemProps) {
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
  const { pendingKey, schedule, cancel } = useUndo();
  const deleteKey = `todo:${todo.id}`;
  const completeKey = `complete:${todo.id}`;
  const pendingComplete = pendingKey === completeKey;
  // True for the few hundred ms the row spends animating out after the undo
  // window closes.
  const [leaving, setLeaving] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [editing, setEditing] = useState(false);
  // The full editor: expanded in the card on the web, a full-screen sheet from
  // a long press on a phone. Same component either way.
  const [editorOpen, setEditorOpen] = useState(false);
  // The quick-defer surface: swipe left on a phone, the Defer button on the web.
  const [deferOpen, setDeferOpen] = useState(false);
  // Set right after marking an action done, when it had attachments and
  // auto-delete is off — offers to clean them up instead of doing it silently.
  const [attachmentPrompt, setAttachmentPrompt] = useState<Attachment[] | null>(null);
  const [deletingAttachments, setDeletingAttachments] = useState(false);
  const done = todo.state === "completed";
  // While the undo window is open the row already reads as done, so the
  // checkbox and the strike-through follow the pending state too.
  const shownDone = done || pendingComplete;

  // Completing is deferred the same way deleting is: the row strikes through at
  // once, a 5s toast offers Undo, and un-checking the box does the same thing.
  // Only when the window closes does the row animate out and the change land.
  async function commitComplete() {
    // The only question is whether to also ask about attachments. Auto-delete
    // (a user preference) skips the prompt entirely — the server already
    // removed them as part of completing.
    let attachments: Attachment[] = [];
    if (!prefs?.autoDeleteAttachments) {
      attachments = await api
        .get<Attachment[]>(`/todos/${todo.id}/attachments`)
        .catch(() => []);
    }
    if (!prefersReducedMotion()) {
      setLeaving(true);
      await new Promise((r) => setTimeout(r, LEAVE_MS));
    }
    complete.mutate(todo.id);
    if (attachments.length > 0) {
      setAttachmentPrompt(attachments);
    }
  }

  function toggleDone() {
    // Un-checking inside the undo window is an undo, not a re-open: nothing has
    // been written yet, so there is nothing to reactivate.
    if (pendingComplete) cancel(completeKey);
    else if (done) reactivate.mutate(todo.id);
    else schedule(completeKey, t("todo.completed"), () => void commitComplete());
  }

  // Both lists are already cached by React Query, so this costs no extra request.
  const { data: contexts } = useContexts();
  const { data: projects } = useProjects();
  const contextName =
    showContext ?? contexts?.find((c) => c.id === todo.contextId)?.name;
  const projectName = projects?.find((p) => p.id === todo.projectId)?.name;

  // Optimistic delete: while pending, the row hides immediately; the toast's
  // Undo brings it back, and the real delete only runs when the toast expires.
  if (pendingKey === deleteKey) return null;

  return (
    <SwipeRow
      lifted={lifted}
      leaving={leaving}
      // Swipe left defers rather than deletes: deleting an action with one
      // horizontal drag on a list scrolled by thumb is too easy to do by
      // accident. Delete lives in the editor, behind a long press and a tap.
      onSwipeLeft={() => setDeferOpen(true)}
      onSwipeRight={() => update.mutate({ id: todo.id, starred: !todo.starred })}
      onLongPress={() => setEditorOpen(true)}
    >
      {/* items-start, so the handle, the checkbox and the row actions stay on
          the first line of a title that wraps instead of drifting to its
          middle. */}
      <div className="flex items-start gap-2.5">
      {dragHandle && (
        <button
          type="button"
          data-drag-handle
          aria-label={t("todo.dragToReorder")}
          className="flex size-6 flex-none cursor-grab items-center justify-center text-check active:cursor-grabbing dark:text-check-dark"
          {...dragHandle}
        >
          <GripVertical className="size-3.5" />
        </button>
      )}
      <button
        type="button"
        aria-label={shownDone ? t("todo.reopen") : t("todo.complete")}
        onClick={toggleDone}
        className={cn(
          // mt-0.5 centres the 20px box against the 24px drag handle beside it
          // and against the first line of the title, which the leading pushes
          // a couple of pixels down from the top of the row.
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-[7px] border-[1.5px] transition-colors",
          shownDone
            ? "border-done bg-done text-white"
            : "border-check bg-card dark:border-check-dark dark:bg-card-dark",
        )}
      >
        {shownDone && <Check className="size-3" strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        {/* Row actions. Defer, edit, star and delete are desktop-only: on a
            phone they are the swipe and long-press gestures, so the icons would
            be a second, redundant affordance. The paperclip is the exception —
            no gesture reaches attachments, so it shows on both.
            Floated rather than a flex sibling: the title's first line runs
            beside these, and its later lines run underneath them instead of
            being squeezed into a permanently narrower column. */}
        <div className={cn(rowActions, "float-right ml-2.5 flex")}>
        <IconButton
          variant="ghost"
          className="size-7"
          label={
            showFiles
              ? t("todo.hideAttachments")
              : hasAttachments
                ? t("todo.showAttachmentsSome")
                : t("todo.showAttachments")
          }
          onClick={() => setShowFiles((v) => !v)}
        >
          {/* State lives in the icon: brand tint means this action has files,
              which stays true while the panel is open. */}
          <Paperclip
            className={cn(
              "size-3.5",
              hasAttachments
                ? "text-done dark:text-done-dark"
                : showFiles
                  ? "text-foreground"
                  : "text-ink-4",
            )}
          />
        </IconButton>
        <IconButton
          variant="ghost"
          className="hidden size-7 md:inline-flex"
          label={t("todo.defer")}
          onClick={() => setDeferOpen((v) => !v)}
        >
          <CalendarClock
            className={cn("size-3.5", deferOpen ? "text-foreground" : "text-ink-4")}
          />
        </IconButton>
        <IconButton
          variant="ghost"
          className="hidden size-7 md:inline-flex"
          label={t("todo.editAction")}
          onClick={() => setEditorOpen((v) => !v)}
        >
          <Pencil className={cn("size-3.5", editorOpen ? "text-foreground" : "text-ink-4")} />
        </IconButton>
        <IconButton
          variant="ghost"
          className="hidden size-7 md:inline-flex"
          label={todo.starred ? t("todo.removeStar") : t("todo.star")}
          onClick={() => update.mutate({ id: todo.id, starred: !todo.starred })}
        >
          <Star className={cn("size-3.5", todo.starred ? "fill-done text-done" : "text-ink-4")} />
        </IconButton>
        <IconButton
          variant="ghost"
          className="hidden size-7 md:inline-flex"
          label={t("todo.delete")}
          onClick={() => schedule(deleteKey, t("todo.deleted"), () => del.mutate(todo.id))}
        >
          <Trash2 className="size-3.5 text-danger" />
        </IconButton>
        </div>
        {editing ? (
          <DescriptionEditor
            todo={todo}
            onCancel={() => setEditing(false)}
            onSave={(description) => {
              // Text only. The context and project are their own controls, so
              // an "@" or "#" written into a description stays description.
              update.mutate({ id: todo.id, description });
              setEditing(false);
            }}
          />
        ) : (
          /* Titles wrap — two lines is normal, three allowed; never truncate.
             A span rather than a <button>: a button is an atomic inline box, so
             its text cannot split around the floated actions — the whole box
             drops below them instead. A real inline element breaks mid-line, so
             the first line stops at the icons and the rest runs under them.
             The button's keyboard behaviour is restored by hand. */
          <span
            role="button"
            tabIndex={0}
            onClick={() => setEditing(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setEditing(true);
              }
            }}
            title={t("todo.edit")}
            className={cn(
              "cursor-text rounded text-sm leading-[1.3] break-words transition-colors",
              shownDone
                ? "font-medium text-ink-4 line-through dark:text-ink-4-dark"
                : "font-semibold text-ink dark:text-ink-dark",
            )}
          >
            {todo.description}
          </span>
        )}
        {/* Chip order is fixed: @context (unless grouped) → #project → !tags →
            deferred/recurring meta → due date last. */}
        {(contextName || projectName || todo.tags.length > 0 || todo.due || todo.showFrom || todo.recurringTodoId) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 overflow-hidden">
          {contextName && !hideContext && <Chip tone="brand">@{bare(contextName, "@")}</Chip>}
          {projectName && <Chip tone="done">#{bare(projectName, "#")}</Chip>}
          {todo.tags.map((tag) => (
            <Chip key={tag} tone="neutral">
              !{tag}
            </Chip>
          ))}
          {todo.showFrom && todo.state === "deferred" && (
            <span className="mono flex items-center gap-1 text-[10px] text-ink-4">
              <CalendarClock className="size-3" /> {fmt.day(todo.showFrom)}
            </span>
          )}
          {todo.recurringTodoId && (
            <span className="flex items-center text-ink-4" title={t("todo.recurringAction")}>
              <Repeat className="size-3" />
            </span>
          )}
          {todo.due && <DueChip overdue={isOverdue(todo.due, fmt.dayKey)} label={fmt.day(todo.due)} />}
        </div>
        )}
      </div>

      </div>

      {/* Inline on a desktop, where there is room beside the list; a sheet on a
          phone, where an inline panel would push the rest of the list off the
          screen and leave the file names in a 200px-wide column. */}
      {showFiles && (
        <div className="hidden md:block">
          <AttachmentPanel todoId={todo.id} />
        </div>
      )}
      <div className="md:hidden">
        <Sheet
          open={showFiles}
          onClose={() => setShowFiles(false)}
          title={t("todo.attachmentsFor", { description: todo.description })}
        >
          <AttachmentPanel todoId={todo.id} />
        </Sheet>
      </div>

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

      {/* One editor, two presentations. On the web it expands inside the card so
          the list around it stays readable; on a phone a long press opens it as
          a sheet, which is the only way to reach it there. */}
      <div className="hidden md:block">
        {editorOpen && (
          <ActionEditor todo={todo} onClose={() => setEditorOpen(false)} />
        )}
        {deferOpen && (
          <div className="mt-3 border-t border-line-3 pt-3 dark:border-line-dark">
            <DeferPanel todo={todo} onSaved={() => setDeferOpen(false)} />
          </div>
        )}
      </div>

      <div className="md:hidden">
        <Sheet
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          title={todo.description}
          // Star and delete ride on the title row rather than sitting in the
          // editor's footer: they act on the action as a whole, not on any
          // field, and as icons they cost nothing next to the title.
          actions={
            <>
              <IconButton
                variant="ghost"
                className="size-8"
                label={todo.starred ? t("todo.removeStar") : t("todo.star")}
                onClick={() => update.mutate({ id: todo.id, starred: !todo.starred })}
              >
                <Star
                  className={cn("size-4", todo.starred ? "fill-done text-done" : "text-ink-4")}
                />
              </IconButton>
              <IconButton
                variant="ghost"
                className="size-8"
                label={t("todo.delete")}
                onClick={() => {
                  setEditorOpen(false);
                  schedule(deleteKey, t("todo.deleted"), () => del.mutate(todo.id));
                }}
              >
                <Trash2 className="size-4 text-danger" />
              </IconButton>
            </>
          }
        >
          <ActionEditor todo={todo} onClose={() => setEditorOpen(false)} />
        </Sheet>
        <Sheet open={deferOpen} onClose={() => setDeferOpen(false)} title={t("todo.defer")}>
          <DeferPanel todo={todo} onSaved={() => setDeferOpen(false)} />
        </Sheet>
      </div>
    </SwipeRow>
  );
}
