import { useState, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router";
import { Download, Trash2 } from "lucide-react";
import {
  useCreateNote,
  useDeleteNote,
  useNotes,
  useProject,
  useReviewProject,
  useUpdateProject,
} from "@/hooks/useProjects";
import { useTodos } from "@/hooks/useTodos";
import { useAllAttachments } from "@/hooks/useSettings";
import { downloadAttachment, downloadErrorMessage } from "@/lib/attachments";
import { formatBytes } from "@/lib/usage";
import { TodoItem } from "@/components/TodoItem";
import { QuickAdd } from "@/components/QuickAdd";
import { QuickAddSheet } from "@/components/QuickAddSheet";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import {
  Screen,
  HeaderBlock,
  Fab,
  GroupHeader,
  List,
  Button,
  type Metric,
} from "@/components/primitives";
import { rowActions, inlineEdit, inputClass } from "@/components/primitive-styles";
import { useT } from "@/lib/i18n";
import { useUndo } from "@/lib/undo";
import { useDateFmt } from "@/lib/datefmt";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/lib/types";

export function ProjectDetailPage() {
  const t = useT();
  const fmt = useDateFmt();
  const navigate = useNavigate();
  const { id } = useParams();
  const projectId = Number(id);
  const { data: project, isLoading } = useProject(projectId);
  const { data: todos } = useTodos({ projectId });
  const { data: notes } = useNotes(projectId);
  const { data: allAttachments } = useAllAttachments();
  const { pendingKey, schedule } = useUndo();
  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();
  const review = useReviewProject();
  const updateProject = useUpdateProject();
  const [noteBody, setNoteBody] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function onDownload(a: Attachment) {
    setDownloadError(null);
    try {
      await downloadAttachment(a.id, a.fileName);
    } catch (err) {
      setDownloadError(downloadErrorMessage(err, a.fileName));
    }
  }

  function saveTitle() {
    const name = titleDraft.trim();
    setEditingTitle(false);
    if (project && name && name !== project.name) {
      updateProject.mutate({ id: project.id, name });
    }
  }

  function onAddNote(e: FormEvent) {
    e.preventDefault();
    const body = noteBody.trim();
    if (!body) return;
    createNote.mutate({ body, projectId });
    setNoteBody("");
  }

  if (isLoading) {
    return <p className="p-6 text-sm font-medium text-ink-3">{t("common.loading")}</p>;
  }
  if (!project) {
    return <p className="p-6 text-sm font-medium text-danger">{t("projectDetail.notFound")}</p>;
  }

  const open = todos?.filter((x) => x.state !== "completed") ?? [];
  const done = todos?.filter((x) => x.state === "completed") ?? [];

  // A note pending deletion leaves the panel at once; Undo puts it back.
  const visibleNotes = (notes ?? []).filter((n) => pendingKey !== `note:${n.id}`);

  const todoIds = new Set((todos ?? []).map((x) => x.id));
  const projectAttachments = (allAttachments ?? []).filter((a) => todoIds.has(a.todoId));

  const metrics: Metric[] = [
    { value: open.length, label: t("projectDetail.mOpen") },
    { value: done.length, label: t("projectDetail.mDone"), tone: "done" },
  ];
  if (project.lastReviewed) {
    metrics.push({ label: t("projectDetail.reviewed", { date: fmt.date(project.lastReviewed) }) });
  }

  const title = editingTitle ? (
    <Input
      autoFocus
      value={titleDraft}
      onChange={(e) => setTitleDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") saveTitle();
        if (e.key === "Escape") setEditingTitle(false);
      }}
      onBlur={saveTitle}
      aria-label={t("projectDetail.renameLabel")}
      className={cn(
        inlineEdit,
        "max-w-sm text-[23px] leading-tight font-extrabold tracking-[-0.04em] text-white md:text-3xl",
      )}
    />
  ) : (
    <button
      type="button"
      onClick={() => {
        setEditingTitle(true);
        setTitleDraft(project.name);
      }}
      title={t("projectDetail.renameLabel")}
      className="text-left"
    >
      {project.name}
    </button>
  );

  return (
    <Screen
      header={
        <HeaderBlock
          back={t("nav.projects")}
          onBack={() => navigate("/projects")}
          title={title}
          metrics={metrics}
          action={
            <button
              type="button"
              onClick={() => review.mutate(project.id)}
              className="rounded-control bg-white/15 px-3 py-2 text-xs font-bold text-white hover:bg-white/25"
            >
              {t("projectDetail.markReviewed")}
            </button>
          }
        />
      }
      fab={<Fab label={t("home.addAction")} onClick={() => setAdding(true)} />}
    >
      {/* Desktop quick-add bar, pre-scoped to this project ("#" is not a token). */}
      <div className="mt-3.5 hidden rounded-card bg-card p-2.5 shadow-card md:block dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none">
        <QuickAdd compact defaultProjectId={projectId} sigils={["@", "!"]} />
      </div>

      <div className="mt-4 flex flex-col gap-5 md:grid md:grid-cols-[1.6fr_1fr]">
        {/* min-w-0 on both columns: a grid item's automatic minimum is its
            content, so one long unbreakable filename would otherwise widen the
            column and blow the page out. */}
        <div className="flex min-w-0 flex-col gap-[9px]">
          <GroupHeader label={t("projectDetail.actions")} count={open.length} />
          {open.length === 0 ? (
            <p className="text-sm font-medium text-ink-3 dark:text-ink-4-dark">
              {t("projectDetail.noOpen")}
            </p>
          ) : (
            <List>
              {open.map((todo) => (
                <TodoItem key={todo.id} todo={todo} />
              ))}
            </List>
          )}

          {done.length > 0 && (
            <div className="mt-2 flex flex-col gap-[9px]">
              <button type="button" onClick={() => setShowCompleted((v) => !v)}>
                <GroupHeader label={t("projectDetail.completed")} count={done.length} muted />
              </button>
              {showCompleted && (
                <List>
                  {done.map((todo) => (
                    <TodoItem key={todo.id} todo={todo} />
                  ))}
                </List>
              )}
            </div>
          )}
        </div>

        {/* Notes and attachments are cards, the same as the actions beside
            them — a boxed list inside a panel read as a different kind of
            thing, when they are the same kind of thing. */}
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-[9px]">
            <GroupHeader label={t("nav.notes")} count={visibleNotes.length} />

            <form onSubmit={onAddNote} className="flex gap-2">
              <input
                placeholder={t("notes.addSimple")}
                aria-label={t("notes.addSimple")}
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                className={inputClass}
              />
              <Button type="submit" disabled={createNote.isPending} className="flex-none">
                {t("common.add")}
              </Button>
            </form>

            {visibleNotes.length === 0 ? (
              <p className="text-sm font-medium text-ink-3 dark:text-ink-4-dark">
                {t("notes.none")}
              </p>
            ) : (
              <List>
                {/* The delete action floats and the body is inline content, so
                    a long note wraps underneath it rather than beside it. */}
                {visibleNotes.map((n) => (
                  <li
                    key={n.id}
                    className="group relative rounded-card bg-card p-3.5 text-sm font-medium break-words whitespace-pre-wrap text-ink shadow-card dark:border dark:border-line-dark dark:bg-card-dark dark:text-ink-dark dark:shadow-none"
                  >
                    <div className={cn(rowActions, "float-right ml-2.5")}>
                      <IconButton
                        variant="ghost"
                        className="size-7"
                        label={t("notes.delete")}
                        onClick={() =>
                          schedule(`note:${n.id}`, t("notes.deleted"), () => deleteNote.mutate(n.id))
                        }
                      >
                        <Trash2 className="size-3.5 text-danger" />
                      </IconButton>
                    </div>
                    {n.body}
                  </li>
                ))}
              </List>
            )}
          </div>

          {/* Files hang off actions, not projects, so this is the project's
              actions' attachments gathered in one place. Downloading is enough
              here; managing them stays on the attachments screen. */}
          <div className="flex flex-col gap-[9px]">
            <GroupHeader label={t("nav.attachments")} count={projectAttachments.length} />
            {projectAttachments.length === 0 ? (
              <p className="text-sm font-medium text-ink-3 dark:text-ink-4-dark">
                {t("attachments.none")}
              </p>
            ) : (
              <List>
                {projectAttachments.map((a) => (
                  <li
                    key={a.id}
                    className="group relative rounded-card bg-card p-3 shadow-card dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none"
                  >
                    <div className={cn(rowActions, "float-right ml-2.5")}>
                      <IconButton
                        variant="ghost"
                        className="size-7"
                        label={t("attachments.download", { name: a.fileName })}
                        onClick={() => void onDownload(a)}
                      >
                        <Download className="size-3.5" />
                      </IconButton>
                    </div>
                    {/* break-all, not break-words: a filename is often one long
                        token with no space to break at. The title carries the
                        whole name for a hover, as on the attachments screen. */}
                    <p
                      className="text-sm leading-[1.3] font-bold break-all text-ink dark:text-ink-dark"
                      title={a.fileName}
                    >
                      {a.fileName}
                    </p>
                    <p
                      className="text-xs font-medium break-words text-ink-2 dark:text-ink-2-dark"
                      title={a.todoDescription}
                    >
                      {a.todoDescription}
                    </p>
                    <p className="mono text-[10px] text-ink-4">
                      {formatBytes(a.size)} · {fmt.date(a.createdAt)}
                    </p>
                  </li>
                ))}
              </List>
            )}
            {downloadError && <p className="text-sm font-medium text-danger">{downloadError}</p>}
          </div>
        </div>
      </div>

      <QuickAddSheet
        open={adding}
        onClose={() => setAdding(false)}
        defaultProjectId={projectId}
      />
    </Screen>
  );
}
