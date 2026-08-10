import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Plus, Trash2, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useCreateProject, useDeleteProject, useProjects, useUpdateProject } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/SearchInput";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/initials";
import { Screen, HeaderBlock, Segmented, Fab, Sheet, SkeletonList, EmptyState, Meter } from "@/components/primitives";
import { rowActions } from "@/components/primitive-styles";
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
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>("active");
  const { data: projects, isLoading } = useProjects(filter === "all" ? undefined : filter);
  const update = useUpdateProject();
  const del = useDeleteProject();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
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
  const activeCount = (projects ?? []).filter((p) => p.state === "active").length;
  const openActions = (projects ?? []).reduce((sum, p) => sum + p.openCount, 0);

  return (
    <Screen
      header={
        <HeaderBlock
          title={t("nav.projects")}
          avatar={initials(user?.email)}
          metrics={[
            { value: activeCount, label: t("projects.metricActive") },
            { value: openActions, label: t("projects.metricOpen"), tone: "done" },
          ]}
        />
      }
      fab={<Fab label={t("projects.addTitle")} onClick={() => setAdding(true)} />}
    >
      {/* Desktop create bar under the banner; mobile uses the FAB sheet. */}
      <div className="mt-3.5 hidden rounded-card bg-card p-2.5 shadow-card md:block dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none">
        <ProjectAddForm onAdded={() => {}} />
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-4 md:mt-4">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("projects.searchPlaceholder")}
          ariaLabel={t("projects.searchAria")}
          className="w-full min-w-[180px] sm:w-auto sm:max-w-[300px] sm:flex-1"
        />
        <Segmented
          className="ml-auto"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f.value, label: t(f.labelKey) }))}
        />
      </div>

      {error && <p className="pb-3 text-sm font-medium text-danger">{error}</p>}

      {isLoading ? (
        <SkeletonList />
      ) : projects?.length === 0 ? (
        <EmptyState message={t("projects.none")} />
      ) : visible.length === 0 ? (
        <EmptyState message={t("projects.noMatch")} />
      ) : (
        <ul className="flex flex-col gap-[9px] md:grid md:grid-cols-3 md:gap-3">
          {visible.map((p) => (
            <li
              key={p.id}
              className="group relative flex flex-col gap-2 rounded-card bg-card p-3 shadow-card dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none"
            >
              {/* This wrapper is a flex item and so its own formatting
                  context, which contains the float and keeps it away from the
                  stats line below. */}
              <div className="min-w-0">
                {/* Only the icons float, exactly as on an action card: the
                    open count used to ride along and made the float nearly
                    twice as wide, which left a narrow card's first line with
                    almost nowhere to start. */}
                <div className={cn(rowActions, "float-right ml-2.5")}>
                    <IconButton
                      variant="ghost"
                      className="size-7"
                      label={p.state === "hidden" ? t("projects.makeActive") : t("projects.moveSomeday")}
                      onClick={() =>
                        update.mutate({ id: p.id, state: p.state === "hidden" ? "active" : "hidden" })
                      }
                    >
                      {p.state === "hidden" ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                    </IconButton>
                    <IconButton
                      variant="ghost"
                      className="size-7"
                      label={p.state === "completed" ? t("projects.reopen") : t("projects.markComplete")}
                      onClick={() =>
                        update.mutate({ id: p.id, state: p.state === "completed" ? "active" : "completed" })
                      }
                    >
                      <CheckCircle2 className={cn("size-3.5", p.state === "completed" && "text-done")} />
                    </IconButton>
                    <IconButton
                      variant="ghost"
                      className="size-7"
                      label={t("projects.deleteLabel", { name: p.name })}
                      onClick={() => setConfirming(p)}
                    >
                      <Trash2 className="size-3.5 text-danger" />
                    </IconButton>
                </div>
                <Link to={`/projects/${p.id}`} className="inline">
                  <span
                    className={cn(
                      "text-sm leading-[1.3] font-bold break-words text-ink dark:text-ink-dark",
                      p.state === "completed" && "text-ink-4 line-through dark:text-ink-4-dark",
                      p.state === "hidden" && "text-ink-4 italic dark:text-ink-4-dark",
                    )}
                  >
                    {p.name}
                  </span>
                </Link>
              </div>

              {/* Progress, only once the project holds something to progress
                  through: an empty project's meter would read as 0% done
                  rather than "nothing filed yet". */}
              <div className="flex flex-col gap-1">
                {p.totalCount > 0 && <Meter value={p.doneCount} max={p.totalCount} height={3} />}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="mono text-[10px] text-ink-4">
                    {t("projects.open", { count: p.openCount })}
                  </span>
                  {p.totalCount > 0 && (
                    <span className="mono text-[10px] text-ink-4">
                      {t("projects.doneOf", { done: p.doneCount, total: p.totalCount })}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title={t("projects.addTitle")}>
        <ProjectAddForm onAdded={() => setAdding(false)} />
      </Sheet>

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
    </Screen>
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
          <label className="mt-2 flex items-center gap-2 text-sm font-medium">
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
