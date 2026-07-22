import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2, CheckCircle2, FolderOpen, Eye, EyeOff } from "lucide-react";
import { useCreateProject, useDeleteProject, useProjects, useUpdateProject } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/SearchInput";
import { PageWithAdd } from "@/components/PageWithAdd";
import { ApiError, apiMessage } from "@/lib/api";
import { useT, useTn, type TFunc, type TnFunc } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Filter = "active" | "hidden" | "completed" | "all";

const FILTERS: { value: Filter; labelKey: "projects.filterActive" | "projects.filterSomeday" | "projects.filterCompleted" | "projects.filterAll" }[] = [
  { value: "active", labelKey: "projects.filterActive" },
  { value: "hidden", labelKey: "projects.filterSomeday" },
  { value: "completed", labelKey: "projects.filterCompleted" },
  { value: "all", labelKey: "projects.filterAll" },
];

/** The add-project form: one field, shared by the desktop bar and the mobile
 *  add sheet (which onAdded closes). */
function ProjectAddForm({ onAdded }: { onAdded: () => void }) {
  const t = useT();
  const create = useCreateProject();
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function onAdd(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError("");
    create.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          setName("");
          onAdded();
        },
        onError: (err) => setError(apiMessage(err, t("projects.errorAdd"))),
      },
    );
  }

  return (
    <form onSubmit={onAdd} className="space-y-2">
      <div className="flex gap-2">
        <Input placeholder={t("projects.new")} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={create.isPending}>
          <Plus /> <span className="hidden sm:inline">{t("common.add")}</span>
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

export function ProjectsPage() {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("active");
  const { data: projects, isLoading } = useProjects(filter === "all" ? undefined : filter);
  const update = useUpdateProject();
  const del = useDeleteProject();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<{ id: number; name: string } | null>(null);
  // Set only when the project actually holds notes and the server has refused
  // to say what happens to them without being asked.
  const [notesPrompt, setNotesPrompt] = useState<{ id: number; name: string; notes: number } | null>(
    null,
  );

  // First attempt never decides for the notes: an empty project (or one with
  // no notes) just goes, and one with notes comes back with the count so the
  // second dialog can ask what to do with them.
  function onDeleteProject(id: number, projectName: string) {
    setError("");
    del.mutate(
      { id },
      {
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            setNotesPrompt({ id, name: projectName, notes: Number(err.details.notes ?? 0) });
            return;
          }
          setError(apiMessage(err, t("projects.errorDelete")));
        },
      },
    );
  }

  function onResolveNotes(deleteNotes: boolean) {
    if (!notesPrompt) return;
    const { id } = notesPrompt;
    setNotesPrompt(null);
    del.mutate(
      { id, deleteNotes },
      {
        onError: (err) =>
          setError(apiMessage(err, t("projects.errorDelete"))),
      },
    );
  }

  const needle = query.trim().toLowerCase();
  const visible = (projects ?? []).filter((p) => p.name.toLowerCase().includes(needle));

  return (
    <PageWithAdd
      title={t("nav.projects")}
      subtitle={t("projects.subtitle")}
      addLabel={t("projects.addTitle")}
      renderForm={(onAdded) => <ProjectAddForm onAdded={onAdded} />}
    >
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={t("projects.searchPlaceholder")}
        ariaLabel={t("projects.searchAria")}
      />

      {/* "Someday" is the GTD name for a hidden project: kept for later, out of
          the active list and out of the #project autocomplete. */}
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            variant={filter === f.value ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f.value)}
          >
            {t(f.labelKey)}
          </Button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}

      <ul className="space-y-2">
        {visible.map((p) => (
          <li key={p.id}>
            <Card className="flex items-center gap-3 p-3">
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              <Link to={`/projects/${p.id}`} className="min-w-0 flex-1">
                <span
                  className={cn(
                    "text-sm",
                    p.state === "completed" && "text-muted-foreground line-through",
                    p.state === "hidden" && "text-muted-foreground italic"
                  )}
                >
                  {p.name}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">{t("projects.open", { count: p.openCount })}</span>
              </Link>
              <div className="flex shrink-0 items-center gap-0.5">
                <IconButton
                  variant="ghost"
                  className="size-7"
                  label={p.state === "hidden" ? t("projects.makeActive") : t("projects.moveSomeday")}
                  onClick={() =>
                    update.mutate({ id: p.id, state: p.state === "hidden" ? "active" : "hidden" })
                  }
                >
                  {p.state === "hidden" ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </IconButton>
                <IconButton
                  variant="ghost"
                  className="size-7"
                  label={p.state === "completed" ? t("projects.reopen") : t("projects.markComplete")}
                  onClick={() =>
                    update.mutate({ id: p.id, state: p.state === "completed" ? "active" : "completed" })
                  }
                >
                  <CheckCircle2 className={cn("size-4", p.state === "completed" && "text-emerald-600")} />
                </IconButton>
                <IconButton
                  variant="ghost"
                  className="size-7"
                  label={t("projects.deleteLabel", { name: p.name })}
                  onClick={() => setConfirming(p)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </IconButton>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {projects?.length === 0 && !isLoading && (
        <p className="text-center text-sm text-muted-foreground">{t("projects.none")}</p>
      )}
      {projects && projects.length > 0 && visible.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">{t("projects.noMatch")}</p>
      )}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t("projects.deleteTitle")}
        description={
          <>
            <strong>{confirming?.name}</strong> {t("projects.deleteDescBody")}
          </>
        }
        busy={del.isPending}
        onConfirm={() => {
          if (confirming) onDeleteProject(confirming.id, confirming.name);
          setConfirming(null);
        }}
      />

      <NotesPrompt
        prompt={notesPrompt}
        busy={del.isPending}
        onCancel={() => setNotesPrompt(null)}
        onResolve={onResolveNotes}
        t={t}
        tn={useTn()}
      />
    </PageWithAdd>
  );
}

/**
 * A project's notes are GTD reference material, independent of its action
 * list — deleting the project does not obviously mean deleting them too, so
 * this asks explicitly rather than picking a default silently.
 */
function NotesPrompt({
  prompt,
  busy,
  onCancel,
  onResolve,
  t,
  tn,
}: {
  prompt: { id: number; name: string; notes: number } | null;
  busy: boolean;
  onCancel: () => void;
  onResolve: (deleteNotes: boolean) => void;
  t: TFunc;
  tn: TnFunc;
}) {
  const [deleteNotesToo, setDeleteNotesToo] = useState(false);

  return (
    <ConfirmDialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
          setDeleteNotesToo(false);
        }
      }}
      title={t("projects.notesPromptTitle", { name: prompt?.name ?? "" })}
      description={
        <>
          {t("projects.notesPromptHas")}{" "}
          <strong>{tn(prompt?.notes ?? 0, "projects.noteCount")}</strong>.
          <label className="mt-2 flex items-center gap-2 text-sm font-normal">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={deleteNotesToo}
              onChange={(e) => setDeleteNotesToo(e.target.checked)}
            />
            {tn(prompt?.notes ?? 0, "projects.alsoDelete")}
          </label>
        </>
      }
      confirmLabel={t("projects.deleteProject")}
      busy={busy}
      onConfirm={() => {
        onResolve(deleteNotesToo);
        setDeleteNotesToo(false);
      }}
    />
  );
}
