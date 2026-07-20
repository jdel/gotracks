import { useState, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Trash2, ClipboardCheck } from "lucide-react";
import {
  useCreateNote,
  useDeleteNote,
  useNotes,
  useProject,
  useReviewProject,
} from "@/hooks/useProjects";
import { useTodos } from "@/hooks/useTodos";
import { TodoItem } from "@/components/TodoItem";
import { QuickAdd } from "@/components/QuickAdd";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n";

export function ProjectDetailPage() {
  const t = useT();
  const [confirmingNote, setConfirmingNote] = useState<number | null>(null);
  const { id } = useParams();
  const projectId = Number(id);
  const { data: project, isLoading } = useProject(projectId);
  const { data: todos } = useTodos({ projectId });
  const { data: notes } = useNotes(projectId);
  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();
  const review = useReviewProject();
  const [noteBody, setNoteBody] = useState("");

  function onAddNote(e: FormEvent) {
    e.preventDefault();
    const body = noteBody.trim();
    if (!body) return;
    createNote.mutate({ body, projectId });
    setNoteBody("");
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (!project) return <p className="text-sm text-destructive">{t("projectDetail.notFound")}</p>;

  const open = todos?.filter((t) => t.state !== "completed") ?? [];
  const done = todos?.filter((t) => t.state === "completed") ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link to="/projects" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> {t("nav.projects")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          {project.description && (
            <p className="text-sm text-muted-foreground">{project.description}</p>
          )}
          {project.lastReviewed && (
            <p className="text-xs text-muted-foreground">
              {t("projectDetail.reviewed", { date: new Date(project.lastReviewed).toLocaleDateString() })}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => review.mutate(project.id)}>
          <ClipboardCheck /> {t("projectDetail.markReviewed")}
        </Button>
      </div>

      {/* Already scoped to this project, so "#" is not a token here. */}
      <QuickAdd defaultProjectId={projectId} sigils={["@", "!"]} />

      <section>
        <h2 className="mb-2 text-sm font-semibold">{t("projectDetail.actionsCount", { count: open.length })}</h2>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("projectDetail.noOpen")}</p>
        ) : (
          <ul className="space-y-2">
            {open.map((t) => (
              <TodoItem key={t.id} todo={t} />
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t("projectDetail.completedCount", { count: done.length })}</h2>
          <ul className="space-y-2">
            {done.map((t) => (
              <TodoItem key={t.id} todo={t} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">{t("nav.notes")}</h2>
        <form onSubmit={onAddNote} className="mb-2 flex gap-2">
          <Input placeholder={t("notes.addSimple")} value={noteBody} onChange={(e) => setNoteBody(e.target.value)} />
          <Button type="submit" disabled={createNote.isPending}>
            {t("common.add")}
          </Button>
        </form>
        <ul className="space-y-2">
          {notes?.map((n) => (
            <li key={n.id}>
              <Card className="flex items-start justify-between gap-3 p-3">
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{n.body}</p>
                <IconButton
                  variant="ghost"
                  label={t("notes.delete")}
                  onClick={() => setConfirmingNote(n.id)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </IconButton>
              </Card>
            </li>
          ))}
        </ul>
      </section>
      <ConfirmDialog
        open={confirmingNote !== null}
        onOpenChange={(open) => !open && setConfirmingNote(null)}
        title={t("notes.deleteTitle")}
        description={t("notes.detailDeleteDesc")}
        busy={deleteNote.isPending}
        onConfirm={() => {
          if (confirmingNote !== null) deleteNote.mutate(confirmingNote);
          setConfirmingNote(null);
        }}
      />
    </div>
  );
}
